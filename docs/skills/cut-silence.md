---
name: cut-silence
description: Automated workflow to detect and cut silence/pauses from timeline audio or speech using KailaEdit observe, edit, preview, and QC tools.
---

# KailaEdit Skill: Cut Silence (`cut-silence`)

This skill defines the strict procedure for detecting and removing silent intervals or pauses from audio/video clips on the KailaEdit timeline.

---

## 1. Safety Rules & Constraints (HARD STOPS)

1. **NO DIRECT FFMPEG CALLS**:
   - Never run raw `ffmpeg` or `ffprobe` commands via CLI / shell / bash.
   - All operations must strictly go through KailaEdit tools (`observe_silence`, `edit_propose`, `render_preview`, `qc_check`, `edit_apply`).
2. **RESPECT LOCKED TRACKS**:
   - Never propose or apply cuts to clips situated on locked tracks (`locked: true`). Any operation attempting to modify clips on locked tracks is rejected by the transaction validator.
3. **PRESERVE TIMELINE INVARIANTS**:
   - V1 is magnetic: cuts on V1 ripple automatically. Do not leave gaps on V1.
   - Maintain minimum clip duration: never create or leave clips shorter than **0.5s** (500ms).
4. **FAIL CLOSED ON QC ISSUES**:
   - If `qc_check` reports errors or warnings (e.g., `CLIP_TOO_SHORT`, invalid tracks, overlaps), do NOT proceed to `edit_apply`. Adjust the patch or abort.
5. **NEVER APPLY BLINDLY**:
   - Always run `edit_propose` first to generate a semantic diff, and render a preview before applying.
   - Never delete a silence range the user has not seen listed. The listing goes through `ask_confirm`, which blocks the run until they answer; asking in the reply text does not count.

---

## 2. Thresholds & Calibration

| Parameter | Default Value | When to Loosen | When to Tighten |
|---|---|---|---|
| **Noise Threshold (`noiseThresholdDb`)** | `-30dB` | Soft speech, quiet voices, or high ambient noise: loosen to `-35dB` to prevent clipping quiet words. | Clean studio recordings with sharp voice gates: tighten to `-25dB` to eliminate subtle room tone. |
| **Minimum Silence Duration (`minDurationSec`)** | `2.0s` | Casual conversations or dramatic speech with natural pauses: loosen to `2.5s`–`3.0s` to preserve rhythm. | Fast-paced tutorials, vlogs, or presentations: tighten to `1.0s`–`1.5s` for rapid pacing. |
| **Speech Padding (`padSec`)** | `0.15s` (150ms) | Breathy speech or trailing vowels: increase to `0.25s`. | Rapid-fire speech with fast turn-taking: decrease to `0.08s`–`0.10s`. |
| **Minimum Clip Guard (`minClipSec`)** | `0.5s` (500ms) | Never allow any resulting clip < `0.5s`. Silence intervals leaving tiny fragments must be skipped. |

---

## 3. Mandatory Workflow Sequence

The agent MUST follow this 6-step sequence without skipping any step:

```
Step 1: observe_silence
          │
          ▼
Step 2: edit_propose (generate diff & validate)
          │
          ▼
Step 3: ask_confirm — list every range and BLOCK for the answer
          │
          ▼
Step 4: render_preview (render 480p snippet around transitions)
          │
          ▼
Step 5: qc_check (verify timeline invariants & no micro-clips)
          │
          ▼
Step 6: edit_apply (or rollback / abort if rejected)
```

### Detailed Steps

#### Step 1 — Observe Silence (`observe_silence`)
- Probe silence for each clip on the target track:
  ```json
  {
    "mediaPath": "/path/to/media.mp4",
    "noiseThreshold": -30,
    "minDuration": 2.0
  }
  ```
- Filter out silent ranges that fall outside the clip's active trim (`trimStart` to `trimEnd`).
- Apply safety padding (e.g. 150ms) at the start and end of silence ranges so word boundaries are preserved.
- Discard silence ranges where cutting would leave audio/video fragments shorter than `0.5s`.

#### Step 2 — Propose Edit Patch (`edit_propose`)
- Construct an `EditPatch` containing `cut_range` operations (or `split_clip` / `delete_clip` operations):
  ```json
  {
    "projectId": "/path/to/project.json",
    "patch": {
      "version": 1,
      "description": "Cut 3 silent pauses (> 2.0s at -30dB) on track V1",
      "operations": [
        {
          "op": "cut_range",
          "trackId": "t_v1",
          "startTime": 5.2,
          "endTime": 8.1
        }
      ]
    }
  }
  ```
- Note: `edit_propose` validates invariants against the schema and returns a `patchId` with a detailed semantic diff without modifying the project file on disk.

#### Step 3 — Human Inspection (`ask_confirm`, blocking)
- This is a gate, not a narration. Call `ask_confirm` and **wait for the answer**:
  a sentence in the reply is not inspection, because the user only reads it once
  the run — and the deletion — is over.
- One item per silence range, so the list is a checklist of exactly what will go:
  ```json
  {
    "title": "Cắt 2 khoảng lặng dài hơn 2 giây",
    "message": "Tổng cộng 5,1 giây sẽ bị cắt khỏi video chính.",
    "items": [
      { "label": "1. 00:16 - 00:18", "detail": "2,4 giây", "highlight": true, "startSec": 16.1, "endSec": 18.5 },
      { "label": "2. 00:29 - 00:31", "detail": "2,7 giây", "highlight": true, "startSec": 29.1, "endSec": 31.8 }
    ],
    "taskIndex": 2
  }
  ```
- `startSec` / `endSec` are what make a row clickable: the playhead jumps there,
  so the user judges the pause by watching it. They also turn the list into a
  set of checkboxes, and the answer comes back as `selectedItemNumbers`.
- **Cut only the numbers that came back.** An unticked range is a range the user
  wants kept; an empty selection means cut nothing.
- Also state, in the message: original duration vs. new duration, and the
  thresholds the count came from — the number of ranges is a function of
  `minDurationSec` and `noiseThresholdDb`, not a property of the video.
- `answered: false` (dismissed, timed out, no live editor) is a **no**. Stop.
- If the count is lower than the user expects, re-measure at a shorter
  `minDurationSec` (e.g. `1.0`) and tell them how many shorter pauses exist, so
  they can choose to loosen the threshold rather than being told "done" after
  two cuts.
- If the user requests adjustments, calibrate thresholds and return to Step 1.

#### Step 4 — Low-Resolution Preview (`render_preview`)
- Render a lightweight preview (480p) covering the edited section to verify smooth transitions:
  ```json
  {
    "projectId": "/path/to/project.json",
    "startTime": 0,
    "duration": 15,
    "resolution": "480p",
    "wait": true
  }
  ```
- Verify audio transitions do not produce clicks, pops, or clipped syllables.

#### Step 5 — Quality Control Gate (`qc_check`)
- Run `qc_check` on the proposed project state:
  ```json
  {
    "projectId": "/path/to/project.json"
  }
  ```
- Verify:
  - `issues` list is empty.
  - Zero clips with duration < 0.5s.
  - Zero overlaps on magnetic track V1.
  - Zero locked track violations.

#### Step 6 — Atomic Apply (`edit_apply`)
- Once human confirms and QC passes:
  ```json
  {
    "projectId": "/path/to/project.json",
    "patchId": "<patchId_from_step_2>"
  }
  ```
- The project file is saved atomically in a single ACID transaction.
- If at any point the result is unsatisfactory, call `edit_undo` to restore the project byte-for-byte.
