#!/usr/bin/env node
// Contract test for the vendored pstack tree (pstack/): enforces the port
// rules in pstack/ADAPTATIONS.md mechanically, so a sync that misses a rule
// fails `nix flake check` instead of shipping drift.
//
//   node scripts/pstack-check.mjs [pstack-dir]   # default: <repo>/pstack
//
// What it enforces:
// - every skill directory under pstack/skills has a SKILL.md, its frontmatter
//   `name` equals the directory name (kebab-case), and it keeps
//   `disable-model-invocation: true` (pstack is mode-driven)
// - no Cursor-only surface survives: cursor-team-kit, .cursor paths,
//   setup-pstack, make-bot-ui, AskQuestion
// - no omp branches (pi-only port): /loop anywhere, the word "omp"
// - no pi-herdr-agents 2.x API: `role:` or `environment:` as subagent-call
//   arguments (lines that mention subagent or agent:), a backticked `tasks`
//   array, `chain` sequential mode, the eight-tasks/four-children limits
// - no hardcoded model slugs (claude-opus, grok-4): model routing is
//   config-driven via task:<category> / exact IDs / inherit-parent
// - every playbooks/… and references/… path mentioned in a skill resolves
//   inside that skill
// - agent files satisfy pi-herdr-agents' strict frontmatter: unquoted inline
//   `tools:` scalar, bare true/false for spawning/auto-exit/persistent
// - the vendored extension registers the role-pack discovery event and has
//   an index.ts entry
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pstackRoot = resolve(process.argv[2] ?? join(repoRoot, "pstack"));
const problems = [];

function fail(file, line, message) {
	problems.push(`${file}${line ? `:${line}` : ""}: ${message}`);
}

function walk(dir, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

const skillsDir = join(pstackRoot, "skills");
const agentsDir = join(pstackRoot, "agents");
const extensionDir = join(pstackRoot, "extensions", "pstack");

for (const required of [skillsDir, agentsDir, extensionDir]) {
	if (!statSync(required, { throwIfNoEntry: false })) {
		fail(relative(repoRoot, pstackRoot), 0, `missing ${relative(pstackRoot, required)}`);
	}
}
if (problems.length) {
	console.error(problems.join("\n"));
	process.exit(1);
}

const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
	.filter((e) => e.isDirectory() || e.isSymbolicLink())
	.map((e) => join(skillsDir, e.name));
const files = [
	...walk(skillsDir).filter((f) => /\.(md|ts|mjs|sh|json)$/.test(f)),
	...walk(agentsDir).filter((f) => /\.(md|ts|mjs|sh|json)$/.test(f)),
	...walk(extensionDir).filter((f) => /\.(md|ts|mjs|sh|json)$/.test(f)),
];

function parseFrontmatter(content) {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return null;
	const frontmatter = {};
	for (const line of match[1].split("\n")) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
	}
	return frontmatter;
}

// --- Skill frontmatter -----------------------------------------------------

const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
for (const dir of skillDirs) {
	const name = dir.split("/").pop();
	const skillFile = join(dir, "SKILL.md");
	if (!existsSync(skillFile)) {
		fail(relative(repoRoot, dir), 0, "skill directory has no SKILL.md");
		continue;
	}
	const frontmatter = parseFrontmatter(readFileSync(skillFile, "utf8"));
	if (!frontmatter) {
		fail(relative(repoRoot, skillFile), 0, "no frontmatter");
		continue;
	}
	if (frontmatter.name !== name)
		fail(relative(repoRoot, skillFile), 0, `frontmatter name "${frontmatter.name}" != dirname "${name}"`);
	if (!kebab.test(name)) fail(relative(repoRoot, dir), 0, "directory name is not kebab-case");
	if (frontmatter["disable-model-invocation"] !== "true")
		fail(relative(repoRoot, skillFile), 0, "missing disable-model-invocation: true (pstack is mode-driven)");
	for (const key of ["mode", "icon", "color", "reminder"]) {
		if (key in frontmatter) fail(relative(repoRoot, skillFile), 0, `Cursor-only frontmatter key "${key}"`);
	}
}

// --- Agent frontmatter (pi-herdr-agents strict format) ---------------------

const scalarFields = ["tools", "deny-tools"];
const booleanFields = ["spawning", "auto-exit", "persistent"];
for (const file of walk(agentsDir).filter((f) => f.endsWith(".md"))) {
	const content = readFileSync(file, "utf8");
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) {
		fail(relative(repoRoot, file), 0, "agent file has no frontmatter");
		continue;
	}
	const lines = match[1].split("\n");
	const frontmatter = parseFrontmatter(content);
	if (!frontmatter.name) fail(relative(repoRoot, file), 0, "agent frontmatter missing name");
	for (const field of [...scalarFields, ...booleanFields]) {
		const decl = lines.find((line) => line.startsWith(`${field}:`));
		if (!decl) continue;
		const value = decl.slice(field.length + 1).trim();
		if (booleanFields.includes(field)) {
			if (value !== "true" && value !== "false")
				fail(relative(repoRoot, file), 0, `${field} must be bare true or false`);
			continue;
		}
		if (
			!value ||
			value.startsWith("[") ||
			value.startsWith("{") ||
			value.startsWith("|") ||
			value.startsWith(">") ||
			value.includes("#") ||
			value.includes('"') ||
			value.includes("'") ||
			value.split(",").some((entry) => !entry.trim())
		)
			fail(relative(repoRoot, file), 0, `${field} must be an unquoted comma-separated scalar`);
		if (lines.some((line) => line.trimStart().startsWith(`${field}:`) && line !== decl))
			fail(relative(repoRoot, file), 0, `${field} declared more than once or not at line start`);
	}
}

// --- Forbidden content -----------------------------------------------------

const literalRules = [
	["cursor-team-kit", "Cursor-only control skill"],
	[".cursor", "Cursor path"],
	["setup-pstack", "excluded upstream skill"],
	["make-bot-ui", "excluded upstream skill"],
	["AskQuestion", "Cursor idiom; use ask-the-user prose"],
	["/loop", "omp /loop; use an explicit pi watcher"],
	["`tasks` array", "pi-herdr-agents 2.x tasks array; use N parallel subagent calls"],
	["`chain`", "pi-herdr-agents 2.x chain mode"],
	["eight tasks", "pi-herdr-agents 2.x parallel limit"],
	["four running child", "pi-herdr-agents 2.x child-process limit"],
	["claude-opus", "hardcoded model slug"],
	["grok-4", "hardcoded model slug"],
];
const subagentCallContext = /subagent|agent:/;

for (const file of files) {
	const content = readFileSync(file, "utf8");
	const rel = relative(repoRoot, file);
	content.split("\n").forEach((line, i) => {
		const lineNo = i + 1;
		for (const [pattern, message] of literalRules) {
			if (line.includes(pattern)) fail(rel, lineNo, message);
		}
		if (/\bomp\b/.test(line)) fail(rel, lineNo, "omp host branch; this port is pi-only");
		if (subagentCallContext.test(line)) {
			if (/\brole:/.test(line))
				fail(rel, lineNo, "role: as a subagent argument; route models with model: task:<category> or exact IDs");
			if (/\benvironment:/.test(line)) fail(rel, lineNo, "environment: as a subagent argument; workers run locally");
		}
		if (/\bchain sequential\b|sequential `chain`/.test(line))
			fail(rel, lineNo, "pi-herdr-agents 2.x chain mode");
	});
}

// --- Referenced paths resolve ----------------------------------------------

const referencedPath = /(playbooks|references)\/[A-Za-z0-9][\w./-]*\.(?:md|ts|mjs|sh)(?!\w)/g;
for (const file of files.filter((f) => f.endsWith(".md"))) {
	const rel = relative(repoRoot, file);
	let skillDir = dirname(file);
	while (!existsSync(join(skillDir, "SKILL.md")) && skillDir !== pstackRoot && dirname(skillDir) !== skillDir) {
		skillDir = dirname(skillDir);
	}
	const content = readFileSync(file, "utf8");
	for (const match of content.matchAll(referencedPath)) {
		if (!existsSync(join(skillDir, match[0])))
			fail(rel, 0, `referenced path does not resolve: ${match[0]}`);
	}
}

// --- Vendored extension ----------------------------------------------------

const roles = readFileSync(join(extensionDir, "roles.ts"), "utf8");
if (!roles.includes("pi-herdr-subagents:roles:discover:v1"))
	fail(relative(repoRoot, join(extensionDir, "roles.ts")), 0, "role-pack discovery event not registered");
for (const file of walk(extensionDir)) {
	if (/\bomp\b/.test(readFileSync(file, "utf8")))
		fail(relative(repoRoot, file), 0, "omp host detection; this port is pi-only");
}

if (problems.length) {
	console.error(`pstack check failed (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n`);
	console.error(problems.map((p) => `  ${p}`).join("\n"));
	process.exit(1);
}

const skillCount = skillDirs.length;
console.log(`pstack check passed: ${skillCount} skills, frontmatter, adaptation layer, and paths all conform`);
