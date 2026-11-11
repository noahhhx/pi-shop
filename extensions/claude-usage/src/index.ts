// Claude plan usage in pi: the session and weekly limits Claude Code's
// /usage shows, as a footer status and a /usage command.
//
// Reads Claude Code's OAuth token from $CLAUDE_CONFIG_DIR/.credentials.json
// (default ~/.claude) and queries the endpoint Claude Code itself uses. The
// token is only read: Claude Code (which pi-claude-cli drives) owns refresh.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const STATUS_KEY = "claude-usage";
const MIN_REFRESH_MS = 60_000;

interface Row {
	kind: string;
	label: string;
	percent: number;
	severity: string;
	resetsAt?: Date;
}

type Usage = { ok: true; rows: Row[]; at: number } | { ok: false; error: string; at: number };

// Limit kind -> long label (/usage) and short label (footer). Kinds not
// listed show in /usage under their raw name and stay out of the footer.
const KINDS: Record<string, { label: (model?: string) => string; short?: string }> = {
	session: { label: () => "Current session", short: "5h" },
	weekly_all: { label: () => "Current week (all models)", short: "wk" },
	weekly_scoped: { label: (m) => `Current week (${m ?? "scoped"})` },
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

function parseRows(body: unknown): Row[] {
	const limits = (body as { limits?: unknown })?.limits;
	if (!Array.isArray(limits)) throw new Error("unexpected usage response (no limits)");
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

async function fetchUsage(): Promise<Usage> {
	const at = Date.now();
	try {
		const res = await fetch(ENDPOINT, {
			headers: {
				Authorization: `Bearer ${await readToken()}`,
				"anthropic-beta": "oauth-2025-04-20",
				"User-Agent": "pi-shop-claude-usage",
			},
			signal: AbortSignal.timeout(10_000),
		});
		if (res.status === 401) throw new Error("Claude Code token rejected; run `claude` once to refresh it");
		if (!res.ok) throw new Error(`usage request failed: HTTP ${res.status}`);
		return { ok: true, rows: parseRows(await res.json()), at };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e), at };
	}
}

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
	if (!u.ok) return `Claude usage: ${u.error}`;
	const width = Math.max(...u.rows.map((r) => r.label.length));
	const lines = u.rows.map(
		(r) =>
			`${r.label.padEnd(width)}  ${bar(r.percent)} ${String(r.percent).padStart(3)}% used` +
			(r.resetsAt ? `  ${formatReset(r.resetsAt)}` : ""),
	);
	return ["Claude usage", ...lines].join("\n");
}

function footer(ctx: ExtensionContext, u: Usage): string {
	const { theme } = ctx.ui;
	if (!u.ok) return theme.fg("dim", "claude usage: ") + theme.fg("warning", "unavailable");
	const color = (s: string) => (s === "normal" ? "dim" : s === "warning" ? "warning" : "error");
	const parts = u.rows
		.filter((r) => KINDS[r.kind]?.short)
		.map((r) => theme.fg(color(r.severity), `${KINDS[r.kind].short} ${r.percent}%`));
	return theme.fg("dim", "claude ") + parts.join(theme.fg("dim", " · "));
}

export default function claudeUsage(pi: ExtensionAPI) {
	let last: Usage | undefined;
	let inflight: Promise<Usage> | undefined;

	const refresh = async (ctx: ExtensionContext, force = false): Promise<Usage> => {
		if (!force && last && Date.now() - last.at < MIN_REFRESH_MS) return last;
		inflight ??= fetchUsage().finally(() => (inflight = undefined));
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
			ctx.ui.notify(report(u), u.ok ? "info" : "error");
		},
	});
}
