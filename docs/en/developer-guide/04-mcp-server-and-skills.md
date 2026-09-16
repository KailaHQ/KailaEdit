# MCP Server & AI Skills

<p align="center">
  <img src="../../images/editpilot-architecture.png" alt="Model Context Protocol Architecture" width="85%">
</p>

KailaEdit features a native Model Context Protocol (MCP) server located in `packages/kailaedit-mcp/`. This allows AI coding agents and LLM assistants to automate video editing tasks without touching the raw filesystem or UI clicks.

---

## 🛠️ The MCP Server Toolset

The server exposes tools partitioned into distinct tiers:

### 1. Read Tools (Observation)
- `timeline_describe`: Returns high-level timeline structure, duration, tracks, clips, and gaps.
- `timeline_summary`: Provides a compact token-efficient summary of the active project.
- `media_list` & `media_probe`: Lists imported assets and extracts codec/resolution/fps/audio metadata.
- `subtitle_list`: Retrieves timed subtitle segments.

### 2. Measure Tools (Audio/Visual Analysis)
- `observe_silence`: Runs FFmpeg `silencedetect` to locate pauses and dead air with customizable dB thresholds.
- `observe_scenes`: Detects cut boundaries via luminance shifts (`select='gt(scene,0.4)'`).
- `observe_loudness`: Evaluates EBU R128 integrated loudness (LUFS) for broadcast compliance.

### 3. Edit Tools (Mutation)
- `edit_propose`: Validates a sequence of atomic operations against timeline invariants and returns a proposed diff.
- `render_preview`: Generates a quick low-res video preview of the proposed patch.
- `qc_check`: Validates that the proposed edit introduces zero timeline violations.
- `edit_apply`: Commits the proposed `EditPatch` into the active project state.
- `edit_undo`: Reverts the most recent applied patch.

---

## 🧩 The `EditPatch` Protocol

All AI timeline modifications are represented as a discriminated union of atomic operations defined in `core/src/edit-patch.ts`:

```ts
export type EditPatchOperation =
  | { type: 'split_clip'; clipId: string; splitTime: number }
  | { type: 'cut_range'; startTime: number; endTime: number; trackIndices?: number[] }
  | { type: 'move_clip'; clipId: string; targetTrackIndex: number; targetStartTime: number }
  | { type: 'update_clip'; clipId: string; updates: Partial<TimelineClip> }
  | { type: 'insert_clip'; assetId: string; trackIndex: number; startTime: number; duration?: number }
  | { type: 'delete_clip'; clipId: string }
  | { type: 'add_filter'; clipId: string; filterId: string; intensity?: number }
  | { type: 'add_subtitle'; text: string; startTime: number; duration: number }
```

### Every New Feature Must Ship With Its MCP Counterpart!
Whenever you introduce a new editing capability to the frontend:
1. Add the operation to `editPatchOperationSchema` in `core/src/edit-patch.ts`.
2. Implement its handler in `executePatchOperations` and `describePatch`.
3. Add validation logic to `validateEditPatch`.
4. Ensure `timeline_describe` exposes the new properties so the agent can perceive them.
5. Add unit tests in `core/tests/edit-patch.test.ts`.

---

## 🧪 Skill Benchmark Harness (`pnpm eval:skills`)

To prevent regressions in AI editing accuracy, KailaEdit includes an automated evaluation harness:

```bash
pnpm eval:skills
```

This suite executes benchmark scenarios against the MCP server and asserts machine-checkable invariants:
- **Duration Reduction**: Verifies silence removal reduces timeline length within expected tolerances (e.g. 15%–30%).
- **No Micro-Clips**: Asserts all created fragments satisfy duration $\ge 0.5s$.
- **Track Contiguity**: Asserts Track V1 has zero audio/video gaps.
- **Zero QC Violations**: Guarantees `qc_check` reports zero defects.

---

[← Previous: 03. State & Editor Store](03-state-and-editor-store.md) · [Next: 05. Contributing Guidelines →](05-contributing.md)
