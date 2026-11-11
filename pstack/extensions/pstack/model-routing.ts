import type { PotetoModels } from "./config.js";

export type RouteResult =
	| { action: "keep" }
	| { action: "set"; model: string }
	| { action: "block"; reason: string };

function providerOf(id: string): string | undefined {
	const slash = id.indexOf("/");
	return slash > 0 ? id.slice(0, slash) : undefined;
}

/** Providers a poteto-mode spawn may use: those the configured models name. */
export function allowedProviders(routing: PotetoModels): Set<string> {
	const ids = [routing.default, ...Object.values(routing.tasks)];
	return new Set(ids.map((id) => id && providerOf(id)).filter((p): p is string => !!p));
}

export function describeRouting(routing: PotetoModels): string {
	const pairs = Object.entries(routing.tasks).map(([category, id]) => `task:${category} → ${id}`);
	if (routing.default) pairs.push(`no model → ${routing.default}`);
	return pairs.join(", ");
}

/**
 * Rewrite one `subagent` call's `model` under poteto-mode routing:
 * `task:<category>` resolves to its configured ID, an omitted model takes
 * `default`, and an exact ID (or fallback list) must stay on an allowed
 * provider.
 */
export function routeSubagentModel(model: unknown, routing: PotetoModels): RouteResult {
	const allowed = [...allowedProviders(routing)];
	const hint = `Poteto mode routes subagents only through ${allowed.join(", ")}: ${describeRouting(routing)}.`;
	if (model === undefined || model === null || (typeof model === "string" && !model.trim()))
		return routing.default ? { action: "set", model: routing.default } : { action: "keep" };
	if (typeof model !== "string") return { action: "keep" };
	const value = model.trim();
	if (value.startsWith("task:")) {
		const id = routing.tasks[value.slice("task:".length)];
		return id
			? { action: "set", model: id }
			: { action: "block", reason: `No poteto-mode model for ${value}. ${hint}` };
	}
	const off = value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => !allowed.includes(providerOf(entry) ?? ""));
	return off.length === 0
		? { action: "keep" }
		: { action: "block", reason: `${off.join(", ")} is outside poteto mode's providers. ${hint}` };
}
