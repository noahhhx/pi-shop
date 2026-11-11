// Reports pi's run state to Herdr Core as OSC 7501, the Program Status
// Protocol, so Herdr shows a pi terminal as working, blocked, or done and
// `hc wait` and template readiness have a status to observe.
//
// Wire format (herdr-core status.rs):
//   ESC ] 7501 ; state=<word>[:kind=<kind>]:app=pi[:msg=<base64>] ESC \
//
// Emitted only in pi's interactive TUI inside a Herdr Core terminal
// (HC_TERMINAL_ID set): print, json, and rpc modes own stdout as data.

import type {
	AgentActivityOutcome,
	ExtensionAPI,
	ExtensionContext,
	UIPromptKind,
} from "@earendil-works/pi-coding-agent";

type Run = "idle" | "working" | "done" | "error";

interface Session {
	run: Run;
	/** Outcome of the latest turn; decides where the run settles. */
	outcome: AgentActivityOutcome;
	/** An extension dialog (confirm, select, ...) is waiting for the user. */
	prompt?: { kind: UIPromptKind; title?: string };
}

/** No session: pi is between session_shutdown and session_start. */
type Model = Session | undefined;

const SETTLED: Record<AgentActivityOutcome, Run> = {
	completed: "done",
	aborted: "idle",
	error: "error",
};

const BLOCKED_KIND: Partial<Record<UIPromptKind, string>> = {
	confirm: "permission",
	select: "question",
	input: "question",
	editor: "question",
};

const fresh: Session = { run: "idle", outcome: "completed" };

// pi event -> next model. Every state change goes through this table.
const transitions = {
	session_start: () => fresh,
	session_shutdown: () => undefined,
	agent_start: (m) => m && { ...m, run: "working", outcome: "completed" },
	turn_end: (m, e: { outcome: AgentActivityOutcome }) => m && { ...m, outcome: e.outcome },
	agent_settled: (m) => m && { ...m, run: SETTLED[m.outcome] },
	ui_prompt_start: (m, e: { kind: UIPromptKind; title?: string }) =>
		m && { ...m, prompt: { kind: e.kind, title: e.title } },
	ui_prompt_end: (m) => m && { ...m, prompt: undefined },
} satisfies Record<string, (m: Model, e: never) => Model>;

function fields(m: Model): string[] {
	if (!m) return ["state=clear"];
	// A dialog only blocks a run in progress; one the user opened while idle
	// (a /command overlay) has them at the keyboard already.
	if (m.run !== "working" || !m.prompt) return [`state=${m.run}`, "app=pi"];
	const { kind, title } = m.prompt;
	return [
		"state=blocked",
		...(BLOCKED_KIND[kind] ? [`kind=${BLOCKED_KIND[kind]}`] : []),
		"app=pi",
		...(title ? [`msg=${Buffer.from(title, "utf8").toString("base64")}`] : []),
	];
}

const encode = (m: Model) => `\x1b]7501;${fields(m).join(":")}\x1b\\`;

export default function herdrStatus(pi: ExtensionAPI) {
	if (!process.env.HC_TERMINAL_ID) return;

	let model: Model;
	let sent = "";
	const step = (ctx: ExtensionContext, next: (m: Model) => Model) => {
		if (ctx.mode !== "tui") return;
		model = next(model);
		const seq = encode(model);
		if (seq === sent) return;
		sent = seq;
		// Zero-width OSC straight to stdout, as pi-tui's setTitle does; it
		// moves no cursor, so the differential renderer is undisturbed.
		process.stdout.write(seq);
	};

	const t = transitions;
	pi.on("session_start", (_e, ctx) => step(ctx, t.session_start));
	pi.on("session_shutdown", (_e, ctx) => step(ctx, t.session_shutdown));
	pi.on("agent_start", (_e, ctx) => step(ctx, t.agent_start));
	pi.on("turn_end", (e, ctx) => step(ctx, (m) => t.turn_end(m, e)));
	pi.on("agent_settled", (_e, ctx) => step(ctx, t.agent_settled));
	pi.on("ui_prompt_start", (e, ctx) => step(ctx, (m) => t.ui_prompt_start(m, e)));
	pi.on("ui_prompt_end", (_e, ctx) => step(ctx, t.ui_prompt_end));
}
