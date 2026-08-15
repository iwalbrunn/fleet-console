# Architecture

How the console works internally — and which traps showed up along the way.
For usage see the [README](../README.md), for colors and spacing
[DESIGNSYSTEM.md](../DESIGNSYSTEM.md).

## The basic idea

The console is **not an agent framework**. It builds no prompts, calls no model
API and keeps no conversation state. It starts the `claude` CLI as a child
process and reads its event stream.

```
Browser ──HTTP──▶ Next.js (Node) ──spawn──▶ claude -p --output-format stream-json
   ▲                    │                        │
   └────────SSE─────────┘◀──────stdout (JSONL)───┘
```

The most important consequence: **the login is inherited.** There is no API
key and no separate billing. Runs count against the same quota as interactive
work in the terminal.

Second consequence: the console orchestrates *agents*, not *model calls*. Every
role is a complete Claude Code session with its own context window, working
directory and process. Frameworks like CrewAI or LangGraph sit one layer below
that and therefore solve a different problem.

## Two ways to involve a role

|  | Agent tool | Role run |
|---|---|---|
| Who decides | the model | the console |
| Process | inside the orchestrator's context | its own process |
| Trigger | text in the system prompt | a button |
| Reliable | no | yes |
| Accounting | attributed via `parent_tool_use_id` | measured directly |

The first path was the only one for a long time, and it is the sore point:
whether a role gets involved is up to the model. A round could end without any
review — the console notices and says so (`Runde beendet, ohne eine einzige
Rolle zu beauftragen`), but noticing is not preventing.

The role run is the answer to that. `src/lib/sessions.ts` → `runPipeline()`.

## The event stream

`handleEvent()` processes four event types:

- **`system`** (`subtype: init`) — carries the `session_id`. It is the key for
  `--resume` and therefore for resuming interrupted sessions.
- **`assistant`** — usage (tokens), text blocks, `tool_use` blocks. If the call
  is named `Agent` or `Task`, the role node is derived from `subagent_type` and
  the `tool_use_id` is remembered.
- **`user`** — contains `tool_result`. The remembered `tool_use_id` routes the
  result to the right node.
- **`result`** — end of the round.

### `parent_tool_use_id`

When roles are selected, the session runs with `--forward-subagent-text`.
Subagent events then arrive in the same stream, marked with
`parent_tool_use_id`. Only with that is it visible *what* a role does while it
works — before, the time between delegation and reply was a black box in which
the graph could only show "running".

The same marker allows token attribution: every `usage` with a
`parent_tool_use_id` belongs to the role, every one without belongs to the
orchestrator.

## Traps

Ordered by how much damage they did.

### Do not sum cache tokens

`cache_read_input_tokens` reports the same context again on **every** request.
Summed up, a one-liner ended up showing 56,734 input tokens. The correct way:
sum fresh input, and show cache reads as a maximum next to it.

### The security stop hook fires inside role sessions too

The hook asks *every* session to start the `security-reviewer` through the
Agent tool. A role does not have that tool and then burns turns explaining
that it can't — measured at 4 requests instead of 2. Role runs therefore set
`SECURITY_REVIEW_GATE=off`; the hook script provides that off switch itself.

The reverse direction exists too: the hook cannot know that a review already
happened inside the session, because it only writes its per-state hash marker
when it blocks. The console therefore calls `security-review-gate.sh mark`
after a role run that included the `security-reviewer` — same hash logic, same
marker file, so the hook stays quiet for a state that has been reviewed. The
hash lives in the gate script only; the console never re-implements it.

Review economy in general: the orchestrator prompt asks for reviews **once at
the end** of a task (not after every step), tells each subagent to report
findings only (file:line, 1–2 sentences, nothing about what is fine), and a
repeated default role run hands a role its previous findings plus the new diff
instead of the full review task. Measured before the change: a single session
delegated to `business-analyst` sixteen times.

### Next binds to all interfaces unless told otherwise

`next dev -p 4300` and `next start -p 4300` listen on `0.0.0.0` by default —
`lsof` confirmed a running server reachable from the LAN/Tailnet, even though
the docs and the "no auth" design both assume localhost-only. The comment in
`next.config.ts` describing that assumption was aspirational, not enforced.
Fixed by passing `--hostname 127.0.0.1` in both npm scripts; `scripts/start.sh`
inherits it since it just calls `npm run start`.

Binding correctly only stops requests that arrive from another machine. A
page open in the browser can still reach `localhost` — DNS rebinding, or a
`fetch` with a body type that skips CORS preflight, works the same whether
the target is `0.0.0.0` or `127.0.0.1`. The state-changing routes therefore
also check the `Origin` header against the request's own `Host` header
(`src/lib/http.ts`) and reject anything that is not a loopback address. The
first version compared `Origin` against `new URL(req.url).origin` instead —
which Next reports as `localhost` internally no matter which loopback address
the browser actually used, so visiting the console at `127.0.0.1` (exactly
the address `--hostname` now prints) tripped the guard on every action.
Comparing to the `Host` header instead works regardless of which loopback
name was used, because that header reflects the connection the browser
actually made and JS cannot override it.

### `--settings '{"hooks":{}}'` does not disable hooks

Settings are merged, and an empty object removes nothing. Tested and
discarded.

### A free-text task can look like a CLI flag

`laufeRolle` appends the role's task text as the last argv item to the
`claude` CLI, unquoted (no shell is involved, so this is not shell injection —
but the CLI still parses its own argv). A task starting with `--`, e.g.
`--settings={...}`, was read as an option rather than as the prompt. Fixed by
inserting `--` before it (`args.push('--', auftrag)`), the standard
end-of-options marker that stops the CLI's own parser from treating anything
after it as a flag.

### "Last line is assistant" does not mean aborted

Interactive sessions have no end marker. That criterion flagged nearly every
transcript as aborted. The correct rule: aborted = a `tool_use` without a
matching `tool_result`.

### The folder name under `~/.claude/projects` cannot be reversed

It is the path with `/` → `-`. Real folder names contain hyphens themselves, so
the mapping is not unique. The project path therefore always comes from the
`cwd` field inside the transcript.

### Feedback loop between canvas height and parent height

A `ResizeObserver` that computes the canvas height from the parent height,
while the canvas co-determines that parent height, inflates the graph to tens
of thousands of pixels. `.stage` is therefore set to `flex: 1 1 0;
min-height: 0`, with the canvas positioned absolutely on top.

### A physics simulation that never settles

The graph is force-based. Without a stop condition it runs 60 frames per
second forever — and the chips are a moving target. Playwright could not click
them ("element is not stable"), and a human hits them only with effort. The
simulation therefore halts once nobody is working and the motion has decayed;
any state change wakes it up again.

## Role runs in detail

```
runPipeline(id, roles, { model, task, state })
  │
  ├─ sammleArbeitsstand()      git status + git diff HEAD + new files
  │                            ONCE, not per role
  ├─ assign order              stable numbering despite parallelism
  │
  └─ queue, N at a time
        └─ laufeRolle()        claude -p --agent <role> [--model]
              ├─ time limit    SIGTERM, SIGKILL after GRACE_SEC
              ├─ tokens        counted per role
              └─ full text     reports/<run>-<role>.md
```

**The working state is collected once.** Before, every role gathered the same
thing separately — with five roles, five times over. Measured on the same
case: **1 request instead of 12.**

That requires the second version of the review task
(`PRUEFAUFTRAG_MIT_STAND`). With the old wording ("collect it yourself with
`git diff HEAD`"), the role would have fetched everything again despite the
attached state, and the saving would have evaporated.

The node only shows the instruction plus a note about the size of the
attachment. The state itself is not included — otherwise 60 KB would travel
through the event stream on every event and end up in storage.

**The model comes from the role file.** Leave out `--model` and the CLI reads
`model:` from `~/.claude/agents/<role>.md`. The `security-reviewer` runs on
Opus that way, the rest on Sonnet. The selector can force one model for all of
them instead.

**Reviews return verdict JSON, and code terminates the loop.** The standard
review task runs with `--json-schema`: the CLI enforces a structured result
(`verdict`, `befunde[]` with severity/file/line, summary). The console — not
the model — decides what happens next: re-checks are capped at two per role
and session; after that, open findings go to the human. A custom task skips
the schema, since free-form prose may be exactly what was asked for.

## Requirements list, handover, worktrees, costs

Four mechanisms added in August 2026, all following the same principle:
**state lives outside the LLM context.**

- **Requirements list.** Every user message is appended verbatim to
  `anforderungen/<id>.json` by the console — deterministically, not by
  asking the model. The orchestrator's system prompt points at the file and
  restricts it to maintaining `status`/`notiz` per entry — and the console
  enforces that on read-back: entries are server-owned, only `status` and
  `notiz` of known entries are merged in, whatever the model wrote. The file
  deliberately lives outside `runs/`, next to nothing the model should touch.
  The UI shows the list; a session ending with open entries gets called out.
  This is the answer to follow-up requirements getting lost to compaction.
- **Handover.** A finished session with open requirements offers
  "handover → new session": a fresh process, fresh context, the open entries
  seeded as the new session's requirements file and quoted in the prompt —
  taken from the server-side state, not from the model-writable file. Full
  context reset instead of trusting compaction.
- **Worktree isolation.** Optional per session: `git worktree add -b
  fleet/<short>` under `~/.fleet-console/worktrees/` — deliberately outside
  `~/.claude`, because the worktree becomes the cwd of a possibly permissive
  session and has no business sitting next to `settings.json` and `agents/`.
  The session (and
  its role runs) work in the copy; an unchanged worktree is removed at the
  end, one with work in it is kept and reported. Interrupted sessions keep
  theirs for `--resume`.
- **Costs.** `total_cost_usd` from every `result` event (per process,
  cumulative — role runs and restarts are folded in via a base amount). Not a
  bill on a subscription, but the honest per-run consumption number.

**Context parity.** Headless `-p` sessions load CLAUDE.md, skills and
settings like interactive ones (this console deliberately does not use
`--bare`). The `init` event's inventory — tool count, subagents, permission
mode, cwd — is logged to the feed so a context mismatch is visible before it
shows up as a quality problem.

## Storage and resuming

Session state is written continuously to `~/.claude/fleet-console/runs/` and
`reports/`, throttled to at most once every two seconds.

Sessions live in the Node process. Restart the server and they are gone there —
but the conversation still exists on Claude's side. `listSessions()` therefore
merges storage back in: runs recorded as running that are no longer in memory
count as **interrupted**. `resumeSession()` restarts the process with
`--resume <claudeSessionId>` and restores nodes, feed and answers from storage.

A running **role run** does not survive this — the role processes die with the
server. Reports written up to that point remain.

## What is deliberately missing

Comparing notes with [Paperclip](https://github.com/paperclipai/paperclip) was
what triggered the role run. Only the execution model was adopted, not the
corporate scaffolding: no tickets, no org chart, no approvals, no budgets, no
Postgres. That is built for organisations with many agents and several people.
Here, one person works.

Also deliberately absent:

- **No multi-user, no authentication.** The server binds to localhost. Whoever
  reaches the API starts processes in someone else's project directories — and
  under someone else's Claude account, which the terms of use do not allow (see
  the README section on terms of use).
- **No budget stop.** The only brakes are `--autocompact` and the per-role time
  limit.
- **No agent frameworks.** They need an API key with metered billing; this
  console deliberately inherits the subscription.
- **No Claude Agent SDK.** Evaluated in August 2026: the SDK is the cleaner
  substrate on paper (in-process hooks, `canUseTool`, structured output), but
  it only supports API-key authentication — Anthropic explicitly does not
  allow third-party products to offer claude.ai login. The CLI subprocess is
  the officially supported way to inherit the subscription, so it stays. The
  SDK's key benefit, structured output, is available on the CLI as
  `--json-schema` anyway (used by role runs for verdict JSON).
- **No Dynamic Workflows as the engine.** Saved workflows in
  `.claude/workflows/` cannot be triggered headlessly from a server process
  (they are invoked interactively via slash command or by the model itself).
  The role run stays a thin CLI fan-out; workflow patterns worth keeping —
  verdict schemas, iteration caps, cost accounting — are implemented directly.
