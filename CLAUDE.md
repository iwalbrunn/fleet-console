# Fleet Console development

## Commands

- Run targeted tests while iterating; run `npm test` before finishing.
- Run `npm run typecheck`, `npm run lint`, and `npm run build` after code changes.
- The UI is bilingual. Every new message key must exist in both `messages/de.json` and `messages/en.json`.

## Architecture

- Keep the Claude CLI as the execution engine. Fleet observes and controls processes; it does not call model APIs.
- `sessions.ts` is the public facade. Process lifecycle belongs in `claude-process.ts`; stream parsing in `claude-events.ts`.
- Persistent requirements and verification state are server-owned. Never trust a model-writable file as authoritative state.
- Prefer one strong implementation session. Use subagents only for bounded context isolation, verification, or genuinely independent parallel work.
- `direct` is the default. `verified` adds deterministic checks and one independent verifier. `parallel` delegates orchestration to native Claude Code workflows.
- Review agents are read-only. Do not give them Edit or Write.
- Keep session storage backward-compatible: add defaults when loading older runs.

## Code conventions

- TypeScript, ES modules, no shell command construction from user input.
- User-facing UI is German by default; code comments may be German.
- Preserve localhost binding, origin checks, worktree path validation, process timeouts, and bounded review loops.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Design

Maschinenlesbares Designsystem in `DESIGN.md` (Google-DESIGN.md-Format), Prosa-Leitfaden in `DESIGNSYSTEM.md`, Token-Quelle `src/app/nocturne.css`. Vor UI-Arbeit beide lesen; Light- und Dark-Block in nocturne.css identisch halten. Lint: `npx @google/design.md lint DESIGN.md`. Arbeitsweise: Skill `design-system`.
