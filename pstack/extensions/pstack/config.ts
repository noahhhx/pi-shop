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

/**
 * Load `confirmExternalActions` from the pstack config. Only an explicit
 * boolean `false` disables the external-action confirmation guard; a missing,
 * malformed, or otherwise-typed config keeps the guard enabled.
 */
export function confirmExternalActionsEnabled(configFile: string): boolean {
	let config: Record<string, unknown> | null = null;
	try {
		config = JSON.parse(readFileSync(configFile, "utf-8")) as Record<
			string,
			unknown
		>;
	} catch {
		return true;
	}
	return config?.confirmExternalActions !== false;
}
