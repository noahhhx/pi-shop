// `set_tasks`: the session task list upstream pstack skills drive (Cursor
// ships the tool built in; pi does not). Each call replaces the whole list,
// so a playbook's steps go in with one call and progress is a re-send with
// updated statuses. State lives in the tool result's details, so it follows
// the session branch on resume and /tree navigation.
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

export const TASKS_TOOL = "set_tasks";
const WIDGET = "pstack-tasks";

const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

interface TaskItem {
  content: string;
  status: Status;
}

interface TasksDetails {
  tasks: TaskItem[];
  error?: string;
}

const Params = Type.Object({
  tasks: Type.Array(
    Type.Object({
      content: Type.String({ description: "The step, in the words you will report it in" }),
      status: StringEnum(STATUSES, { description: "pending, in_progress, completed, or cancelled" }),
    }),
    { description: "The complete list, in order. Replaces the previous list." },
  ),
});

const MARK: Record<Status, string> = {
  pending: "[ ]",
  in_progress: "[>]",
  completed: "[x]",
  cancelled: "[-]",
};

function summary(tasks: TaskItem[]): string {
  const done = tasks.filter((t) => t.status === "completed" || t.status === "cancelled").length;
  return `${done}/${tasks.length} done`;
}

function plain(tasks: TaskItem[]): string {
  if (tasks.length === 0) return "Task list cleared.";
  return [summary(tasks), ...tasks.map((t, i) => `${MARK[t.status]} ${i + 1}. ${t.content}`)].join("\n");
}

function styled(tasks: TaskItem[], theme: Theme): string[] {
  return tasks.map((t, i) => {
    const n = `${i + 1}.`;
    switch (t.status) {
      case "completed":
        return `${theme.fg("success", "✓")} ${theme.fg("dim", `${n} ${t.content}`)}`;
      case "cancelled":
        return `${theme.fg("dim", "–")} ${theme.fg("dim", theme.strikethrough(`${n} ${t.content}`))}`;
      case "in_progress":
        return `${theme.fg("accent", "▶")} ${theme.fg("text", `${n} ${t.content}`)}`;
      default:
        return `${theme.fg("dim", "○")} ${theme.fg("muted", `${n} ${t.content}`)}`;
    }
  });
}

export function registerTasks(pi: ExtensionAPI) {
  let tasks: TaskItem[] = [];

  const showWidget = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const open = tasks.some((t) => t.status === "pending" || t.status === "in_progress");
    if (!open) {
      ctx.ui.setWidget(WIDGET, undefined);
      return;
    }
    ctx.ui.setWidget(WIDGET, (_tui, theme) =>
      new Text([theme.fg("muted", `Tasks ${summary(tasks)}`), ...styled(tasks, theme)].join("\n"), 0, 0),
    );
  };

  const reconstruct = (ctx: ExtensionContext) => {
    tasks = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== TASKS_TOOL) continue;
      const details = msg.details as TasksDetails | undefined;
      if (details && !details.error) tasks = details.tasks;
    }
    showWidget(ctx);
  };

  pi.on("session_start", (_event, ctx) => reconstruct(ctx));
  pi.on("session_tree", (_event, ctx) => reconstruct(ctx));

  pi.registerTool({
    name: TASKS_TOOL,
    label: "Tasks",
    description:
      "Set the session task list. Send the complete ordered list every time; it replaces the previous one. Keep exactly one item in_progress while working, mark items completed as soon as they are done, and mark dropped items cancelled instead of deleting them. An empty list clears it.",
    promptSnippet: "Track multi-step work as a task list (send the full list each call)",
    promptGuidelines: [
      "Use set_tasks to plan multi-step work before starting it, then re-send the full list with updated statuses as each step starts and finishes.",
    ],
    parameters: Params,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const next = params.tasks.map((t) => ({ content: t.content.trim(), status: t.status }));
      const empty = next.findIndex((t) => !t.content);
      if (empty !== -1) {
        const error = `item ${empty + 1} has no content`;
        return {
          content: [{ type: "text", text: `Error: ${error}; the task list is unchanged.` }],
          details: { tasks, error } as TasksDetails,
        };
      }
      tasks = next;
      showWidget(ctx);
      return {
        content: [{ type: "text", text: plain(tasks) }],
        details: { tasks } as TasksDetails,
      };
    },

    renderCall(args, theme) {
      const count = Array.isArray(args.tasks) ? args.tasks.length : 0;
      return new Text(
        theme.fg("toolTitle", theme.bold("set_tasks ")) + theme.fg("muted", `${count} item${count === 1 ? "" : "s"}`),
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as TasksDetails | undefined;
      if (!details) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }
      if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      if (details.tasks.length === 0) return new Text(theme.fg("dim", "Task list cleared"), 0, 0);
      const lines = styled(details.tasks, theme);
      const shown = expanded ? lines : lines.slice(0, 8);
      if (shown.length < lines.length) shown.push(theme.fg("dim", `… ${lines.length - shown.length} more`));
      return new Text([theme.fg("muted", summary(details.tasks)), ...shown].join("\n"), 0, 0);
    },
  });

  pi.registerCommand("tasks", {
    description: "Show the session task list on the current branch",
    handler: async (_args, ctx) => {
      ctx.ui.notify(tasks.length ? plain(tasks) : "No tasks on this branch.", "info");
    },
  });
}
