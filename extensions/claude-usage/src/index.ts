// Claude plan usage in pi: the session and weekly limits Claude Code's
// /usage shows, as a footer status and a /usage command.
//
// Reads Claude Code's OAuth token from $CLAUDE_CONFIG_DIR/.credentials.json
// (default ~/.claude) and queries the endpoint Claude Code itself uses. The
// token is only read: Claude Code (which pi-claude-cli drives) owns refresh.
//
// The endpoint is rate limited per account, and every pi process (subagents
// included) loads this extension. So results and 429 backoff are shared via a
// cache file, and a failed fetch keeps showing the last good numbers.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const STATUS_KEY = "claude-usage";
const MIN_REFRESH_MS = 5 * 60_000; // automatic refreshes
const MIN_FORCE_MS = 30_000; // /usage
const BACKOFF_BASE_MS = 5 * 60_000; // first 429; doubles per consecutive 429
const BACKOFF_MAX_MS = 60 * 60_000;

interface Row {
	kind: string;
	label: string;
	percent: number;
	severity: string;
	resetsAt?: Date;
}

// rows/rowsAt: last good result. error: last attempt failed (rows may be stale).
// backoffUntil/strikes: 429 backoff, shared across processes via the cache file.
interface Usage {
	at: number;
	rows?: Row[];
	rowsAt?: number;
	error?: string;
	backoffUntil?: number;
	strikes?: number;
}

const cachePath = () =>
	join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "pi-claude-usage.json");

async function loadCache(): Promise<Usage | undefined> {
	try {
		const u = JSON.parse(await readFile(cachePath(), "utf8")) as Usage;
		for (const r of u.rows ?? []) if (r.resetsAt) r.resetsAt = new Date(r.resetsAt);
		return typeof u.at === "number" ? u : undefined;
	} catch {
		return undefined;
	}
}

async function saveCache(u: Usage): Promise<void> {
	try {
		const p = cachePath();
		await mkdir(join(p, ".."), { recursive: true });
		const tmp = `${p}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(u));
		await rename(tmp, p);
	} catch {
		// cache is best effort
	}
}

// Limit kind -> long label (/usage) and short label (footer). Kinds not
// listed show in /usage under their raw name and stay out of the footer.
const KINDS: Record<string, { label: (model?: string) => string; short?: string }> = {
	session: { label: () => "Current session", short: "5h" },
	weekly_all: { label: () => "Current week (all models)", short: "wk" },
	weekly_scoped: { label: (m) => `Current week (${m ?? "scoped"})` },
	monthly_spend: { label: () => "Monthly spend", short: "spend" },
};

const credentialsPath = () =>
	join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), ".credentials.json");

async function readToken(): Promise<string> {
	let oauth: { accessToken?: string; expiresAt?: number } | undefined;
	try {
		oauth = JSON.parse(await readFile(credentialsPath(), "utf8")).claudeAiOauth;
	} catch {
		throw new Error(`no Claude Code login at ${credentialsPath()}; run \`claude\` and log in`);
	}
	if (!oauth?.accessToken) throw new Error("Claude Code has no OAuth login; run `claude` and log in");
	if (oauth.expiresAt && oauth.expiresAt < Date.now())
		throw new Error("Claude Code token expired; run `claude` once to refresh it");
	return oauth.accessToken;
}

interface Money {
	amount_minor: number;
	exponent: number;
	currency: string;
}

const money = (m: Money) =>
	new Intl.NumberFormat([], {
		style: "currency",
		currency: m.currency,
		minimumFractionDigits: m.exponent,
		maximumFractionDigits: m.exponent,
	}).format(m.amount_minor / 10 ** m.exponent);

// Enterprise plans have no limits, only monthly spend against a cap.
function spendRow(spend: any): Row | undefined {
	if (!spend?.enabled) return undefined;
	const amounts = [spend.used, spend.limit].filter((m) => m?.currency).map(money);
	return {
		kind: "monthly_spend",
		label: KINDS.monthly_spend.label() + (amounts.length ? ` (${amounts.join(" / ")})` : ""),
		percent: Number(spend.percent) || 0,
		severity: String(spend.severity ?? "normal"),
	};
}

function parseRows(body: unknown): Row[] {
	const { limits, spend } = (body ?? {}) as { limits?: unknown; spend?: unknown };
	if (!Array.isArray(limits)) throw new Error("unexpected usage response (no limits)");
	if (!limits.length) {
		const row = spendRow(spend);
		return row ? [row] : [];
	}
	return limits.map((l) => {
		const model = l?.scope?.model?.display_name ?? undefined;
		const kind = String(l?.kind);
		return {
			kind,
			label: KINDS[kind]?.label(model) ?? kind,
			percent: Number(l?.percent) || 0,
			severity: String(l?.severity ?? "normal"),
			resetsAt: l?.resets_at ? new Date(l.resets_at) : undefined,
		};
	});
}

class RateLimited extends Error {
	readonly retryAfterMs: number;
	constructor(retryAfterMs: number) {
		super("rate limited by the usage endpoint");
		this.retryAfterMs = retryAfterMs;
	}
}

async function fetchRows(): Promise<Row[]> {
	const res = await fetch(ENDPOINT, {
		headers: {
			Authorization: `Bearer ${await readToken()}`,
			"anthropic-beta": "oauth-2025-04-20",
			"User-Agent": "pi-shop-claude-usage",
		},
		signal: AbortSignal.timeout(10_000),
	});
	if (res.status === 401) throw new Error("Claude Code token rejected; run `claude` once to refresh it");
	if (res.status === 429) throw new RateLimited(Number(res.headers.get("retry-after")) * 1000 || 0);
	if (!res.ok) throw new Error(`usage request failed: HTTP ${res.status}`);
	return parseRows(await res.json());
}

// Fetch and merge into the previous state: keep the last good rows on error.
async function fetchUsage(prev: Usage | undefined): Promise<Usage> {
	const at = Date.now();
	const keep = { rows: prev?.rows, rowsAt: prev?.rowsAt };
	try {
		return { at, rows: await fetchRows(), rowsAt: at };
	} catch (e) {
		if (e instanceof RateLimited) {
			const strikes = (prev?.strikes ?? 0) + 1;
			const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (strikes - 1));
			return { at, ...keep, error: e.message, strikes, backoffUntil: at + Math.max(backoff, e.retryAfterMs) };
		}
		return { at, ...keep, error: e instanceof Error ? e.message : String(e) };
	}
}

const ago = (t: number) => {
	const m = Math.round((Date.now() - t) / 60_000);
	return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};

function formatReset(d: Date): string {
	const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	if (d.toDateString() === new Date().toDateString()) return `resets ${time}`;
	return `resets ${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

const bar = (percent: number, width = 24) => {
	const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
};

function report(u: Usage): string {
	const notes: string[] = [];
	if (u.error) notes.push(`last refresh failed: ${u.error}`);
	if (u.backoffUntil && u.backoffUntil > Date.now())
		notes.push(`next try after ${new Date(u.backoffUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
	if (!u.rows) return [`Claude usage: ${u.error ?? "no data"}`, ...notes.slice(1)].join("\n");
	if (!u.rows.length) return ["Claude usage: no limits", ...notes].join("\n");
	const width = Math.max(...u.rows.map((r) => r.label.length));
	const lines = u.rows.map(
		(r) =>
			`${r.label.padEnd(width)}  ${bar(r.percent)} ${String(r.percent).padStart(3)}% used` +
			(r.resetsAt ? `  ${formatReset(r.resetsAt)}` : ""),
	);
	const title = u.error && u.rowsAt ? `Claude usage (as of ${ago(u.rowsAt)})` : "Claude usage";
	return [title, ...lines, ...notes].join("\n");
}

function footer(ctx: ExtensionContext, u: Usage): string {
	const { theme } = ctx.ui;
	if (!u.rows) return theme.fg("dim", "claude usage: ") + theme.fg("warning", "unavailable");
	if (!u.rows.length) return theme.fg("dim", "claude usage: no limits") + (u.error ? theme.fg("dim", " (stale)") : "");
	const stale = !!u.error;
	const color = (s: string) => (s === "normal" ? "dim" : s === "warning" ? "warning" : "error");
	const parts = u.rows
		.filter((r) => KINDS[r.kind]?.short)
		.map((r) => theme.fg(stale ? "dim" : color(r.severity), `${KINDS[r.kind].short} ${r.percent}%`));
	return theme.fg("dim", "claude ") + parts.join(theme.fg("dim", " · ")) + (stale ? theme.fg("dim", " (stale)") : "");
}

export default function claudeUsage(pi: ExtensionAPI) {
	let last: Usage | undefined;
	let inflight: Promise<Usage> | undefined;

	// Another pi process may have fetched (or been rate limited) more recently.
	const update = async (force: boolean): Promise<Usage> => {
		const disk = await loadCache();
		if (disk && (!last || disk.at >= last.at)) last = disk;
		const now = Date.now();
		if (last?.backoffUntil && now < last.backoffUntil) return last;
		if (last && now - last.at < (force ? MIN_FORCE_MS : MIN_REFRESH_MS)) return last;
		const u = await fetchUsage(last);
		await saveCache(u);
		return u;
	};

	const refresh = async (ctx: ExtensionContext, force = false): Promise<Usage> => {
		inflight ??= update(force).finally(() => (inflight = undefined));
		last = await inflight;
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, footer(ctx, last));
		return last;
	};

	pi.on("session_start", (_e, ctx) => void refresh(ctx));
	pi.on("agent_settled", (_e, ctx) => void refresh(ctx));

	pi.registerCommand("usage", {
		description: "Show Claude plan usage (session and weekly limits)",
		handler: async (_args, ctx) => {
			const u = await refresh(ctx, true);
			ctx.ui.notify(report(u), !u.error ? "info" : u.rows?.length ? "warning" : "error");
		},
	});
}
