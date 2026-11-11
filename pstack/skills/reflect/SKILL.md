---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/skill:reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

The active transcript is `$PI_SESSION_FILE`. Use it directly when present. To choose an earlier transcript for this working directory, use the `recall` tool and read only a path it returns. Never glob Pi's global session directory. That crosses project boundaries and reads private chats from unrelated projects. If no session file resolves, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

Three parallel `subagent` calls in one message, each with `agent: "poteto-agent"` and a prompt that forbids file writes. Reviewers may use MCPs available to their Pi child process to look up the tickets, chat threads, and observability traces the transcript references. The parent applies edits.

If an exact model ID fails to resolve, use the category and say so. Pick each subagent's `thinking` level for the job, per the Subagents section of the **poteto-mode** skill.

| Lens | `model` | Prompt template |
|---|---|---|
| Judgment | `task:review` (or omit to inherit the parent) | `references/judgment-reviewer.md` |
| Tooling | `task:review` (or omit to inherit the parent) | `references/tooling-reviewer.md` |
| Divergent | `task:review` (or omit to inherit the parent) | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `subagent` result.

## 3. Synthesize

One `subagent` call with `agent: "poteto-agent"` and `model: task:review` (or omit to inherit the parent). It may use MCPs available to its Pi child process to spot-verify citations. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a skill in place inside a staged package tree, such as the pstack tree that `~/.pi/agent/skills/` links into, because a reinstall or sync overwrites it. Before approval, show its destination, `.pi/skills/<skill>/` in the project. After approval, copy the skill folder there and edit the copy. Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the Pi Agent Skills standard and run its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to the Pi Agent Skills standard and run its description-optimization loop.
- `new skill via Pi skill authoring: <kebab-name>`: hand creation to the Pi Agent Skills standard. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
