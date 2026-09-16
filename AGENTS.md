# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project Overview

KailaEdit is an offline Electron desktop video editor. Two layers, no backend server:

- **Frontend** (`frontend/`): React 18 + TypeScript + Tailwind CSS renderer
- **Electron** (`electron/`): Main process managing app lifecycle, IPC, file/media handling, and ffmpeg export

There is no Python, no network API, and no AI generation in this app. If you find code reaching for a backend URL, an API key, or a model, it is a leftover from the upstream LTX Desktop project and should be removed.

## Common Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start dev server (Vite + Electron) |
| `pnpm dev:debug` | Dev with the Electron inspector attached |
| `pnpm typecheck` | `tsc --noEmit` over `frontend/` and `shared/` |
| `pnpm build:frontend` | Vite build only |
| `pnpm build` | Build an installer for the current platform |
| `pnpm build:dir` | Build an unpacked app directory (faster, for testing) |

`pnpm typecheck` covers `frontend` and `shared` only — `electron/` is a referenced project that Vite builds with esbuild. To typecheck the main process explicitly:

```bash
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop electron/*.ts electron/ipc/*.ts electron/export/*.ts
```

## CI Checks

PRs must pass `pnpm typecheck` and the Vite frontend build.

## Frontend Architecture

- **Path alias**: `@/*` maps to `frontend/*`
- **App state**: React contexts (`ProjectContext`, `KeyboardShortcutsContext`, `ViewContext`)
- **Editor state**: a dedicated Zustand store in `frontend/views/editor/editor-store.tsx` — see the editor skill below
- **Routing**: view-based via `ViewContext` with views `home` and `project`
- **IPC bridge**: all Electron communication goes through `window.electronAPI`, whose shape is derived from `shared/electron-api-schema.ts`
- **Styling**: Tailwind with semantic color tokens via CSS variables; `class-variance-authority` + `clsx` + `tailwind-merge`
- **No frontend tests** currently exist

## Electron Architecture

- `main.ts` — lifecycle and handler registration
- `ipc/` — typed IPC handlers registered through `typed-handle.ts`, validated against the shared Zod schema
- `export/` — ffmpeg export pipeline: `timeline.ts` flattens the timeline, `video-filter.ts` builds the filtergraph, `audio-mix.ts` mixes PCM, `export-handler.ts` orchestrates
- `path-validation.ts` — every renderer-supplied path must be validated against the allowed roots before touching the filesystem

### Adding an IPC method

1. Add the `input`/`output` Zod pair to `electronAPISchemas` in `shared/electron-api-schema.ts`
2. Register the implementation with `handle('<name>', ...)` in the appropriate `electron/ipc/*.ts`
3. Call it from the renderer as `window.electronAPI.<name>(...)` — the types flow automatically

### ffmpeg

`findFfmpegPath()` in `electron/export/ffmpeg-utils.ts` is the single resolution point. It prefers the `ffmpeg-static` binary (rewriting the `app.asar` path to `app.asar.unpacked` when packaged) and falls back to `ffmpeg` on `PATH`. `electron/ipc/image-utils.ts` uses the same binary for image thumbnails and dimension probing.

## Backlog

Planned work lives in `_private/backlog/` — one Markdown file per ticket, each self-contained (acceptance
criteria, the files it touches, and a ready-to-paste prompt), plus `README.md` as the index and
`CONTEXT.md` for the rules every ticket assumes. Handing one over is a single line: *implement
`_private/backlog/KE-204.md`*.

## Video Editor

The editor is the bulk of this codebase. Before changing anything under `frontend/views/VideoEditor.tsx` or `frontend/views/editor/**`, read `docs/skills/video-editor-development.md` — it covers the store shape, selector and action rules, undo/persistence, hot paths, and keyboard/menu wiring.

## CoEdit and the MCP server

CoEdit is the in-app agent panel (`frontend/views/editor/EditPilotPanel.tsx`). It runs the
user's own CLI — Claude Code, Codex or Antigravity — and that CLI reaches the editor **only**
through KailaEdit's MCP server in `packages/kailaedit-mcp/`. The agent has no other way in: it
cannot click the UI, and `electron/editpilot/agent-runner.ts` blocks the CLI's own file and shell
tools. Whatever is not exposed as an MCP tool or an edit-patch operation does not exist as far as
autopilot is concerned.

The surface, in `packages/kailaedit-mcp/src/server.ts`:

- **Read** — `project_open`, `timeline_describe`, `timeline_summary`, `subtitle_list`, `media_list`,
  `media_probe`
- **Measure** — `observe_silence`, `observe_scenes`, `observe_loudness`, `observe_filmstrip`
- **Ask** — `ask_confirm` blocks the run until the user answers a card in the panel
- **Write** — `edit_propose` → `render_preview` → `qc_check` → `edit_apply`, plus `edit_undo`

All writes go through one `EditPatch` (`core/src/edit-patch.ts`), a discriminated union of
operations: `split_clip`, `cut_range`, `move_clip`, `update_clip`, `insert_clip`, `delete_clip(s)`,
`slip_clip`, `slide_clip`, `add_text`, `add_subtitle`, `add_subtitle_track`, `import_srt`.

### Every feature ships with its MCP counterpart

**When you add an editor feature, or change one, extend the MCP surface in the same change.** A
feature the user can only reach by clicking is a feature autopilot cannot use, and the gap is
invisible until someone asks the agent to do it and it fails or, worse, works around it by
mangling something else. This is not optional polish — it is part of "done" for any feature.

For a new capability that edits the timeline:

1. Add the operation to `editPatchOperationSchema` in `core/src/edit-patch.ts`.
2. Handle it in `executePatchOperations` **and** in `describePatch` — the description is the diff
   the user reads before approving, so an operation that describes itself as nothing is worse
   than one that fails.
3. Extend `validateEditPatch` with whatever makes the operation impossible (missing clip, a
   duration longer than the media, a locked track).
4. Make it visible to the reader tools: if `timeline_describe` does not report the new field, the
   agent cannot see what it just did, cannot verify it, and will repeat it.
5. Add `qc_check` rules if the operation can produce a broken timeline.
6. Cover it in `core/tests/edit-patch.test.ts`.

For a capability that is **not** a timeline edit (a new export setting, a new observation), add a
tool to `READ_ONLY_TOOLS` or `EDIT_TOOLS` instead, and remember that `EDIT_TOOLS` is gated behind
the `edit` profile.

Two rules that are easy to break:

- **Read tools are the agent's only eyes.** Adding a field to the project model without adding it
  to `timeline_describe` leaves the agent guessing.
- **The system prompt is part of the contract.** `core/src/editpilot-prompt.ts` tells the agent
  which tools exist and in what order to use them. A new capability the prompt never mentions
  usually goes unused.

## TypeScript Config

- Strict mode with `noUnusedLocals` and `noUnusedParameters`
- Frontend: ES2020 target, React JSX
- Electron main process: ESNext, compiled to `dist-electron/`
- Preload script must be CommonJS

## Key File Locations

- Video editor shell: `frontend/views/VideoEditor.tsx`
- Editor store / selectors / actions: `frontend/views/editor/editor-{store,selectors,actions,state}.ts`
- Project types: `frontend/types/project-model.ts`
- IPC contract: `shared/electron-api-schema.ts`
- Electron builder config: `electron-builder.yml`
