// The pstack master switch. The vendored `pstack/` tree in this repo is
// inert by design: it is listed in no pi discovery surface and in no `pi`
// manifest. This extension is the sole writer of the links that make it
// reachable: one symlink per skill under ~/.pi/agent/skills/, plus the
// pstack extension (which brings Poteto Mode injection and the agent role
// pack) under ~/.pi/agent/extensions/. With the links absent, nothing from
// pstack reaches the agent — no skill descriptions, no mode injection, no
// roles, no commands.
//
// State lives at $PI_CODING_AGENT_DIR/pstack/toggle.json. Default is off.
//
// Symlink targets point at the staging location ~/.pi/agent/pstack-available
// (created by install.sh / home-manager from this repo's `pstack/` tree)
// when it exists, so a rebuild swaps the staging link and the toggle's
// links keep resolving; otherwise they point at the vendored tree relative
// to this module (git checkout, nix store, or `pi install`ed package).

import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";

interface ToggleState {
	enabled: boolean;
	/** Skill names this extension linked; unlink only ever these. */
	skills: string[];
	/** Whether this extension linked the pstack extension. */
	extension: boolean;
}

function expandHome(raw: string): string {
	return raw.replace(/^~(?=\/|$)/, homedir());
}

function agentDir(): string {
	const raw = process.env.PI_CODING_AGENT_DIR?.trim();
	return raw ? expandHome(raw) : path.join(homedir(), ".pi", "agent");
}

// <this repo>/extensions/pstack-toggle/src/index.ts → <this repo>
function moduleRoot(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function isPstackTree(root: string): boolean {
	return (
		fs.existsSync(path.join(root, "skills", "poteto-mode", "SKILL.md")) &&
		fs.existsSync(path.join(root, "agents")) &&
		fs.existsSync(path.join(root, "extensions", "pstack"))
	);
}

// Where to link from: the staging location (survives rebuilds) when present,
// otherwise the vendored tree next to this module.
function resolveSource(): { root: string; source: "staging" | "vendored" } | null {
	const candidates = [
		{ root: path.join(agentDir(), "pstack-available"), source: "staging" as const },
		{ root: path.join(moduleRoot(), "pstack"), source: "vendored" as const },
	];
	return candidates.find((c) => isPstackTree(c.root)) ?? null;
}

function skillNames(root: string): string[] {
	const dir = path.join(root, "skills");
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((e) => (e.isDirectory() || e.isSymbolicLink()) && fs.existsSync(path.join(dir, e.name, "SKILL.md")))
		.map((e) => e.name)
		.sort();
}

function roleNames(root: string): string[] {
	const dir = path.join(root, "agents");
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isFile() && e.name.endsWith(".md"))
		.map((e) => {
			const content = fs.readFileSync(path.join(dir, e.name), "utf8");
			return content.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? e.name.replace(/\.md$/, "");
		})
		.sort();
}

function statePath(): string {
	return path.join(agentDir(), "pstack", "toggle.json");
}

function readState(): ToggleState | null {
	try {
		const state = JSON.parse(fs.readFileSync(statePath(), "utf8")) as ToggleState;
		return typeof state.enabled === "boolean" ? state : null;
	} catch {
		return null;
	}
}

function writeState(state: ToggleState): void {
	fs.mkdirSync(path.dirname(statePath()), { recursive: true });
	fs.writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

function lstat(linkPath: string): fs.Stats | null {
	try {
		return fs.lstatSync(linkPath);
	} catch {
		return null;
	}
}

// Where a symlink points, without requiring the target to still exist.
function linkTarget(linkPath: string): string {
	try {
		return path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
	} catch {
		return "";
	}
}

// Both candidate roots, in every spelling a link we created could carry
// (literal path and, when it exists, its realpath).
function ourRoots(): string[] {
	const roots = [
		path.join(agentDir(), "pstack-available"),
		path.join(moduleRoot(), "pstack"),
	];
	const seen = new Set<string>();
	for (const root of roots) {
		seen.add(path.resolve(root));
		try {
			seen.add(fs.realpathSync(root));
		} catch {
			// gone (e.g. a GC'd store path); the literal spelling still matches
		}
	}
	return [...seen];
}

function isOurLink(linkPath: string): boolean {
	const stat = lstat(linkPath);
	if (!stat?.isSymbolicLink()) return false;
	const target = linkTarget(linkPath);
	return ourRoots().some((root) => target === root || target.startsWith(root + path.sep));
}

function linkSkillsDir(): string {
	return path.join(agentDir(), "skills");
}

// (Re)create one symlink; refuse to clobber anything that is not one of ours.
// checkLink validates first so a refusal never leaves partial changes behind.
function checkLink(target: string, linkPath: string, ours: boolean): string | undefined {
	const stat = lstat(linkPath);
	if (!stat) return undefined;
	if (!stat.isSymbolicLink()) return `refusing to replace non-symlink: ${linkPath}`;
	if (linkTarget(linkPath) === path.resolve(target) || ours) return undefined;
	return `refusing to replace foreign symlink: ${linkPath}`;
}

function ensureLink(target: string, linkPath: string, ours: boolean): string | undefined {
	const problem = checkLink(target, linkPath, ours);
	if (problem) return problem;
	const stat = lstat(linkPath);
	if (stat && linkTarget(linkPath) === path.resolve(target)) return undefined;
	if (stat) fs.unlinkSync(linkPath);
	fs.mkdirSync(path.dirname(linkPath), { recursive: true });
	fs.symlinkSync(target, linkPath, "dir");
	return undefined;
}

interface Inventory {
	enabled: boolean;
	source: { root: string; source: "staging" | "vendored" } | null;
	skills: string[];
	skillsLinked: number;
	extensionLinked: boolean;
	roles: string[];
	problems: string[];
}

function inventory(): Inventory {
	const state = readState();
	const source = resolveSource();
	const skills = source ? skillNames(source.root) : [];
	const skillsLinked = skills.filter((name) => isOurLink(path.join(linkSkillsDir(), name))).length;
	const extensionLinked = isOurLink(path.join(agentDir(), "extensions", "pstack"));
	const problems: string[] = [];
	if (!source) problems.push(`pstack tree not found (looked in ~/.pi/agent/pstack-available and ${path.join(moduleRoot(), "pstack")})`);
	if (state?.enabled && skillsLinked < skills.length)
		problems.push(`state is on but only ${skillsLinked}/${skills.length} skill links exist`);
	if (state?.enabled && !extensionLinked) problems.push("state is on but the pstack extension link is missing");
	if (!state?.enabled && (skillsLinked > 0 || extensionLinked))
		problems.push("state is off but links exist");
	return {
		enabled: state?.enabled ?? false,
		source,
		skills,
		skillsLinked,
		extensionLinked,
		roles: source ? roleNames(source.root) : [],
		problems,
	};
}

function apply(enabled: boolean): string[] {
	if (enabled) {
		const source = resolveSource();
		if (!source) return ["pstack tree not found; enable requires the staging link or a checkout"];
		const names = skillNames(source.root);
		const previous = readState();
		const links = [
			...names.map((name) => ({
				target: path.join(source.root, "skills", name),
				linkPath: path.join(linkSkillsDir(), name),
				ours: previous?.skills?.includes(name) ?? false,
			})),
			{
				target: path.join(source.root, "extensions", "pstack"),
				linkPath: path.join(agentDir(), "extensions", "pstack"),
				ours: previous?.extension ?? false,
			},
		];
		// Dry-run every link first: a refusal aborts before anything changes.
		const problems = links
			.map((l) => checkLink(l.target, l.linkPath, l.ours))
			.filter((p): p is string => p !== undefined);
		if (problems.length) return problems;
		for (const l of links) {
			const problem = ensureLink(l.target, l.linkPath, l.ours);
			if (problem) return [problem];
		}
		writeState({ enabled: true, skills: names, extension: true });
		return [];
	}
	// Disable: remove exactly the links we created. Skill names come from the
	// recorded state, plus any of ours found in place (covers a lost state file).
	const names = new Set(readState()?.skills ?? []);
	try {
		for (const entry of fs.readdirSync(linkSkillsDir(), { withFileTypes: true })) {
			if (isOurLink(path.join(linkSkillsDir(), entry.name))) names.add(entry.name);
		}
	} catch {
		// no skills dir; nothing scanned, the recorded names still apply
	}
	const problems: string[] = [];
	for (const name of names) {
		const linkPath = path.join(linkSkillsDir(), name);
		const stat = lstat(linkPath);
		if (!stat) continue;
		if (!stat.isSymbolicLink() || !isOurLink(linkPath)) {
			problems.push(`leaving foreign entry in place: ${linkPath}`);
			continue;
		}
		fs.unlinkSync(linkPath);
	}
	const extensionPath = path.join(agentDir(), "extensions", "pstack");
	if (lstat(extensionPath)) {
		if (isOurLink(extensionPath)) fs.unlinkSync(extensionPath);
		else problems.push(`leaving foreign entry in place: ${extensionPath}`);
	}
	writeState({ enabled: false, skills: [], extension: false });
	return problems;
}

function statusLines(inv: Inventory): string[] {
	const lines = [
		`State: ${inv.enabled ? "on" : "off"} (${inv.skillsLinked}/${inv.skills.length} skills linked, extension ${inv.extensionLinked ? "linked" : "absent"})`,
	];
	if (inv.source)
		lines.push(
			`Controls: ${inv.skills.length} skills · ${inv.roles.length} roles (${inv.roles.join(", ")}) · poteto-mode · the pstack extension`,
			`Source: ${inv.source.root} (${inv.source.source})`,
		);
	for (const problem of inv.problems) lines.push(`! ${problem}`);
	return lines;
}

async function showToggleUi(ctx: ExtensionCommandContext): Promise<void> {
	const choice = await ctx.ui.custom<"on" | "off" | null>(
			(tui, theme, _keybindings, done) => {
				const inv = inventory();
				const container = new Container();
				container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
				container.addChild(new Text(theme.fg("accent", theme.bold("pstack — master switch"))));
				for (const line of statusLines(inv))
					container.addChild(new Text(theme.fg(inv.problems.length ? "warning" : "muted", line)));
				const items: SelectItem[] = [
					{
						value: "on",
						label: "on",
						description: "link every pstack skill + the pstack extension, then reload",
					},
					{
						value: "off",
						label: "off",
						description: "remove exactly the links this switch created, then reload",
					},
				];
				const selectList = new SelectList(items, items.length, {
					selectedPrefix: (text) => theme.fg("accent", text),
					selectedText: (text) => theme.fg("accent", text),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("dim", text),
					noMatch: (text) => theme.fg("warning", text),
				});
				selectList.onSelect = (item) => done(item.value);
				selectList.onCancel = () => done(null);
				container.addChild(selectList);
				container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter apply • esc cancel")));
				container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
				return {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						selectList.handleInput(data);
						tui.requestRender();
					},
				};
			},
		{ overlay: true },
	);
	if (choice) await run(choice === "on", ctx);
}

// Apply + reload. Reload replaces the extension runtime, so it is terminal:
// nothing after it may use state from this module instance.
async function run(enabled: boolean, ctx: ExtensionCommandContext): Promise<void> {
	const problems = apply(enabled);
	if (problems.length) {
		ctx.ui.notify(`pstack ${enabled ? "enable" : "disable"} failed:\n${problems.join("\n")}`, "error");
		return;
	}
	ctx.ui.notify(
		`pstack ${enabled ? "enabled" : "disabled"}${enabled ? "" : " — nothing from pstack reaches the agent"}`,
		"success",
	);
	await ctx.reload();
}

export default function pstackToggle(pi: ExtensionAPI): void {
	pi.registerCommand("pstack", {
		description:
			"Master switch for the vendored pstack stack: /pstack (overlay), /pstack on, /pstack off, /pstack status",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on" || arg === "off") {
				await run(arg === "on", ctx);
				return;
			}
			if (arg === "status" || arg === "") {
				if (arg === "" && ctx.mode === "tui") {
					await showToggleUi(ctx);
					return;
				}
				ctx.ui.notify(`pstack:\n${statusLines(inventory()).join("\n")}`, "info");
			}
		},
	});
}
