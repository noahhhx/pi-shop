import { realpathSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPstackRoles } from "./roles.js";
import { confirmExternalActionsEnabled, loadPotetoModels, resolvePstackConfigFile } from "./config.js";
import { describeRouting, routeSubagentModel } from "./model-routing.js";
import { registerTasks } from "./tasks.js";

const MODE_ENTRY = "pstack-mode";

// Reached through a symlink (see roles.ts): resolve the real path first.
function packageRoot(): string {
  return path.resolve(path.dirname(realpathSync(fileURLToPath(import.meta.url))), "../..");
}

function knownExternalWrite(command: string): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/\bgit\s+push\b/, "git push"],
    [/\bgh\s+pr\s+(create|edit|merge|close)\b/, "GitHub pull-request mutation"],
    [/\bgt\s+(submit|merge|create)\b/, "Graphite mutation"],
    [/\b(terraform|tofu)\s+(apply|destroy)\b/, "infrastructure mutation"],
    [/\bkubectl\s+(apply|delete|rollout)\b/, "Kubernetes mutation"],
    [/\b(vercel|flyctl|railway)\s+(deploy|promote)\b/, "deployment"],
    [/\brm\s+(-[A-Za-z]*r|--recursive)/, "recursive deletion"],
  ];
  return patterns.find(([pattern]) => pattern.test(command))?.[1];
}

export default function(pi: ExtensionAPI) {
  registerPstackRoles(pi);
  registerTasks(pi);
  const configFile = resolvePstackConfigFile();
  const confirmExternalActions = confirmExternalActionsEnabled(configFile);
  const potetoModels = loadPotetoModels(configFile);

  let potetoMode = false;

  pi.on("session_start", (_event, ctx) => {
    potetoMode = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom") continue;
      if (entry.customType === MODE_ENTRY)
        potetoMode = Boolean((entry.data as { enabled?: boolean }).enabled);
    }
    if (ctx.hasUI)
      ctx.ui.setStatus(
        "pstack-mode",
        potetoMode ? "pstack: poteto mode" : undefined,
      );
  });

  pi.on("input", (event) => {
    if (/^\/skill:poteto-mode(?:\s|$)/.test(event.text)) {
      potetoMode = true;
      pi.appendEntry(MODE_ENTRY, { enabled: true });
    }
    return { action: "continue" } as const;
  });

  pi.on("before_agent_start", (event) => {
    const sections: string[] = [];
    if (potetoMode)
      sections.push(
        `Pstack Poteto Mode is enabled for this session. Follow its persisted workflow: track non-trivial work with the \`set_tasks\` tool (pstack's own; send the full list each call), select and read the matching playbook, delegate bulk reads, implementation, and independent review to subagents by default instead of doing them inline, verify real behavior, and name only principles that changed a decision. The full skill is at ${path.join(packageRoot(), "skills/poteto-mode/SKILL.md")}. The subagent tools are deferred: when \`subagent\` is not in your tool list, call \`tool_search({ query: "subagent" })\` to load them before the first spawn; their absence does not mean delegation is unavailable.`,
      );
    if (potetoMode && potetoModels)
      sections.push(
        `Poteto Mode subagent models are pinned by the pstack config, overriding the task-category shortlists: ${describeRouting(potetoModels)}. Keep using \`model: task:<category>\` as the skills say; it resolves to these. Other providers are refused, so a workflow that wants a second model family (an arena judge, cross-family review) runs without it and says so.`,
      );
    if (!confirmExternalActions)
      sections.push(
        "The pstack external-action confirmation guard is disabled by config. Run recognized external commands (pushes, pull-request updates, merges, deployments) without asking. Still pause for irreversible writes: force-pushes to shared branches, deployments, data deletion, and customer messages.",
      );
    if (sections.length === 0) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${sections.join("\n\n")}` };
  });

  if (potetoModels)
    pi.on("tool_call", (event) => {
      if (!potetoMode || event.toolName !== "subagent") return;
      const input = event.input as { model?: unknown };
      const route = routeSubagentModel(input.model, potetoModels);
      if (route.action === "set") input.model = route.model;
      if (route.action === "block") return { block: true, reason: route.reason };
    });

  if (confirmExternalActions)
    pi.on("tool_call", async (event, ctx) => {
      if (event.toolName !== "bash") return;
      const input = event.input as { command?: string };
      const operation = input.command
        ? knownExternalWrite(input.command)
        : undefined;
      if (!operation) return;
      if (!ctx.hasUI)
        return {
          block: true,
          reason: `${operation} requires explicit user confirmation; non-interactive Pi cannot request it.`,
        };
      const approved = await ctx.ui.confirm(
        "Confirm external or irreversible action",
        `Allow ${operation}?\n\n${input.command}`,
      );
      if (!approved)
        return { block: true, reason: `User declined ${operation}.` };
    });

  pi.registerCommand("poteto-mode", {
    description:
      "Enable or disable sticky pstack Poteto Mode for this Pi session. Usage: /poteto-mode [task] | /poteto-mode off",
    handler: async (args, ctx) => {
      if (/^(off|disable|stop)$/i.test(args.trim())) {
        potetoMode = false;
        pi.appendEntry(MODE_ENTRY, { enabled: false });
        ctx.ui.setStatus("pstack-mode", undefined);
        ctx.ui.notify("Poteto Mode disabled for this session.", "info");
        return;
      }
      potetoMode = true;
      pi.appendEntry(MODE_ENTRY, { enabled: true });
      ctx.ui.setStatus("pstack-mode", "pstack: poteto mode");
      pi.sendUserMessage(
        `/skill:poteto-mode${args.trim() ? ` ${args.trim()}` : ""}`,
      );
    },
  });

}
