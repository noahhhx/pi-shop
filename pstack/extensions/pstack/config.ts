import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function expandHome(raw: string): string {
	return raw.replace(/^~(?=\/|$)/, homedir());
}

/**
 * Resolve the pstack config file for pi.
 * `PI_CODING_AGENT_DIR` → `~/.pi/agent`.
 */
export function resolvePstackConfigFile(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const agentDir = env.PI_CODING_AGENT_DIR?.trim();
	if (agentDir) return join(expandHome(agentDir), "pstack", "config.json");
	return join(homedir(), ".pi", "agent", "pstack", "config.json");
}

function readConfig(configFile: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(configFile, "utf-8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * Poteto-mode subagent model routing from the pstack config's
 * `potetoModels` object: `task:<category>` keys map to exact
 * `provider/model-id` values, and `default` applies when a spawn names no
 * model. Missing, malformed, or empty config returns null, which leaves
 * routing to pi-herdr-agents.
 */
export interface PotetoModels {
	default?: string;
	tasks: Record<string, string>;
}

export function loadPotetoModels(configFile: string): PotetoModels | null {
	const raw = readConfig(configFile)?.potetoModels;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const tasks: Record<string, string> = {};
	let fallback: string | undefined;
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value !== "string" || !value.includes("/")) continue;
		if (key === "default") fallback = value;
		else tasks[key] = value;
	}
	if (!fallback && Object.keys(tasks).length === 0) return null;
	return { default: fallback, tasks };
}

/**
 * Load `confirmExternalActions` from the pstack config. Only an explicit
 * boolean `false` disables the external-action confirmation guard; a missing,
 * malformed, or otherwise-typed config keeps the guard enabled.
 */
export function confirmExternalActionsEnabled(configFile: string): boolean {
	return readConfig(configFile)?.confirmExternalActions !== false;
}
