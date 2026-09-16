---
name: auto-edit
description: End-to-end automated video editing orchestrator coordinating silence removal, smart captions, B-roll overlays, dynamic zoom pacing, quality control, and human confirmation.
---

# KailaEdit Skill: Auto Edit (`auto-edit`)

This skill defines the master orchestration workflow for automatically editing an entire talking-head / raw footage video into a polished, engaging final cut using existing KailaEdit MCP tools and edit-patch operations.

It acts as the single coordinator ("người chỉ huy") uniting the 4 specialized workflows:
1. **`cut-silence`** (detect and cut pauses/dead air)
2. **`smart-captions`** (generate and chunk concise, rhythmic subtitles)
3. **`insert-broll`** (detect long talking sections and overlay context B-roll)
4. **`dynamic-zoom`** (alternate medium shot and close-up punch-in cuts)

---

## 1. Safety Rules & Constraints (HARD STOPS)

1. **NO DIRECT FFMPEG CALLS**:
   - Never invoke raw `ffmpeg` or `ffprobe` commands via CLI / shell / bash.
   - All measurements, edits, and checks must go through KailaEdit MCP tools (`timeline_describe`, `observe_silence`, `suggest_broll`, `edit_propose`, `render_preview`, `qc_check`, `ask_confirm`, `edit_apply`).
2. **REUSE STORED TRANSCRIPT (DO NOT RE-TRANSCRIBE)**:
   - Always check if the project already contains transcript data (`transcripts` in project model / assets, or existing subtitle cues).
   - Only call `transcribe` if no transcript exists. Re-transcribing existing footage wastes API credits, time, and computational resources.
3. **NEVER SELF-BROLL**:
   - `insert_broll` MUST strictly use secondary/supplementary media assets already imported into the project.
   - If the project contains no secondary video or image assets, the agent **must explicitly inform the user** that B-roll was skipped due to lack of supplementary footage.
   - **Under no circumstances should the primary talking-head video clip be inserted onto an overlay track to cover itself.**
4. **DO NOT ASSUME TRACK 0 IS BASE FOOTAGE**:
   - Subtitle tracks have `kind: 'video'` and are frequently positioned at the beginning of the tracks array (track index 0), shifting base footage to track index 1.
   - Always determine the base footage track by identifying the track holding the primary video footage (e.g. longest cumulative duration via `selectBaseFootageTrackIndex` logic) before applying cuts or `punch_in_sequence`.
5. **ENFORCE EXPLICIT DENSITY LIMITS**:
   - The most common failure mode of AI automated editing is **over-editing** (visual overload, seizure-inducing cuts, and constant visual clutter).
   - Strictly adhere to the concrete density limits defined in Section 2. Do not rely on model discretion alone.
6. **PRESERVE TIMELINE INVARIANTS & PREVENT MASS DELETION**:
   - Magnetic track V1 ripples cuts automatically. Maintain minimum clip duration of **0.5s** (500ms). Never leave micro-fragments.
   - If `observe_silence` indicates the entire video is silent (`isEntirelySilent: true` or silence covers 100% of duration due to missing audio or mic off), **ABORT IMMEDIATELY**. Never propose cutting 100% of the timeline.
7. **BLOCKING HUMAN INSPECTION GATE (`ask_confirm`)**:
   - Never apply edits blindly with `edit_apply`.
   - Before `edit_apply`, call `ask_confirm` and **BLOCK until the user responds**.
   - Every modified item (silence cut, B-roll insert, punch-in) must provide a `startSec` (and optional `endSec`) parameter so the user can click the item to jump the playhead directly to that moment on the timeline.
8. **FAIL CLOSED ON QC FAILURES**:
   - If `qc_check` reports errors (e.g., `CLIP_TOO_SHORT`, invalid tracks, overlaps), do NOT apply the patch. Correct or abort.
9. **HONOR USER EXCLUSIONS**:
   - The user can turn off any individual step via natural language (e.g., *"tự dựng nhưng đừng chèn B-roll"*, *"không zoom"*). Always respect user exclusions.

---

## 2. Density Limits & Pacing Rules

To prevent sensory overload and preserve narrative rhythm, the agent MUST enforce these numerical thresholds:

| Element | Maximum Density / Constraint | Recommended Parameter | Rationale |
|---|---|---|---|
| **B-roll Overlays** | Max **1 overlay every 4.0s** of talking head | Clip duration **3.0s – 5.0s**, `fadeIn: 0.25`, `fadeOut: 0.25`, `muteAudio: true` | Prevents jumping between footage too quickly; allows viewers to absorb each graphic/visual. |
| **Dynamic Zoom (Punch-in)** | Max **1 punch-in cut every 8.0s** | Zoom scale **115% – 120%** (centered `0, 0`), alternating 100% $\leftrightarrow$ 115% | Changing angle too frequently causes motion fatigue; scale $> 125\%$ degrades 1080p resolution. |
| **Minimum Clip for Zoom** | Never apply punch-in to clips **$< 2.0\text{s}$** | Only zoom clips $\ge 2.0\text{s}$ | Brief cutaways or quick sentences feel jarring if framed in close-up. |
| **Smart Captions** | **3 – 5 words per chunk**, max 2 lines | Presets: `tiktok-classic`, `viral-yellow`, or `center-punch` | Aligns with natural conversational phrasing for short-form retention without obscuring faces. |
| **Silence Removal** | Min silence duration **$\ge 1.5\text{s} – 2.0\text{s}$**, noise threshold **-30dB** | Speech padding **$150\text{ms}$**, guard **$0.5\text{s}$** | Avoids clipping natural breathing pauses while eliminating dead air. |
| **Text & Emotion Stickers** | Max **1 pair every 5.0s – 7.0s**, duration **2.5s – 3.5s** | **Stacked Badge Layout**: Sticker on top (`positionY: -36%`, `scale: 26%–28%`), Text below (`positionY: 26%`, `fontSize: 44–56px`) | **Chống đè hình (Anti-Collision)**: giữ khoảng cách an toàn $\ge 10\%$ màn hình giữa icon và chữ. |

---

## 3. Mandatory Workflow Sequence

The workflow consists of 7 strictly ordered stages. Every step occupies a deliberate position in the pipeline:

```
Step 1: timeline_describe
          │  (inspect canvas, clips, tracks, identify base footage track)
          ▼
Step 2: Ensure Transcript
          │  (re-use project transcript store; transcribe only if missing)
          ▼
Step 3: observe_silence & Cut Silence
          │  (cuts MUST happen first: they ripple timecodes on V1)
          ▼
Step 4: Smart Captions (chunk_subtitles)
          │  (locks speech cues; needed before B-roll analysis)
          ▼
Step 5: suggest_broll & insert_broll
          │  (analyzes continuous speech from subtitles; uses secondary assets)
          ▼
Step 6: punch_in_sequence
          │  (alternates framing across cut clips on base footage track)
          ▼
Step 7: qc_check → render_preview → ask_confirm → edit_apply
             (blocking user approval gate with jumpable startSec)
```

### Why This Exact Sequence?

1. **Why `timeline_describe` first?**
   You cannot modify what you do not understand. Knowing track layout, clip IDs, existing assets, and canvas aspect ratio (16:9 vs 9:16) determines where overlays and cuts can safely land.
2. **Why resolve transcript before cutting?**
   If transcription is needed, it must be performed on the source asset before complex cuts or re-arrangements so timestamps map accurately to original media seconds.
3. **Why cut silence BEFORE subtitles and B-roll?**
   Track V1 is magnetic. Removing silent pauses ripples subsequent clips earlier on the timeline. If subtitles or B-roll were placed first, ripple edits on V1 would immediately desynchronize them from the speaker's voice!
4. **Why subtitles BEFORE B-roll?**
   `suggest_broll` directly analyzes the timeline subtitles (`subtitles: timeline.subtitles`) and their semantic keywords to identify continuous speech blocks lacking visual variety. Without subtitles on the timeline, B-roll detection has no semantic text to parse.
5. **Why B-roll BEFORE dynamic zoom?**
   B-roll completely covers the camera with secondary footage on track V2/V3. Knowing where B-roll covers the screen prevents redundant punch-in cuts underneath B-roll segments.
6. **Why dynamic zoom on the cut clips?**
   Once silence cuts create natural sentence breaks, `punch_in_sequence` alternates camera framing (100% $\leftrightarrow$ 115%) across consecutive cuts, simulating a multi-camera setup.
7. **Why `qc_check` & `render_preview` before `ask_confirm`?**
   The user must never be asked to approve a timeline state that contains invalid durations, overlaps, or rendering errors.

---

## 4. Detailed Step-by-Step Instructions

### Step 1 — Inspect Timeline (`timeline_describe`)
- Call `timeline_describe` to obtain:
  - Canvas dimensions (`width`, `height`, `aspectRatio`).
  - Tracks list (locate base video track vs overlay tracks).
  - All clips on the base track with their `id`, `startTime`, `duration`, and `assetPath`.
  - Check `project.assets` to see what secondary assets exist for B-roll.

### Step 2 — Ensure Transcript
- Check whether transcripts already exist in the project or timeline subtitles.
- If not present, call `transcribe` on the primary media asset with `wordTimestamps: true`.
- If already present, re-use existing transcript cues. Do not call `transcribe` again.

### Step 3 — Silence Removal (`observe_silence`)
*(Can be skipped if user says "đừng cắt khoảng lặng" / "giữ nguyên âm thanh")*
- Run `observe_silence` on the main clip (`noiseDb: -30`, `minDurationSec: 2.0`).
- If `isEntirelySilent: true`, abort silence removal and notify the user that audio is absent or muted.
- Propose `cut_range` operations (or `split_clip` + `delete_clip`), with 150ms speech padding.
- Ensure no clip fragment shorter than 0.5s is created.

### Step 4 — Smart Captions (`chunk_subtitles` / `add_subtitle`)
*(Can be skipped if user says "không cần phụ đề" / "bỏ qua sub")*
- Generate subtitles aligned with the post-cut speech timing.
- Apply `chunk_subtitles` (or `import_srt` with `chunk: true`):
  - `minWords: 3`, `maxWords: 5`, `maxChars: 25`.
  - Style preset: `tiktok-classic` (high contrast white/black outline) or `viral-yellow`.

### Step 5 — Contextual B-roll (`suggest_broll` + `insert_broll`)
*(Can be skipped if user says "đừng chèn B-roll" / "không dùng hình minh hoạ")*
- **Asset Check**: Check available assets in `project.assets`.
  - If only the main video asset exists: **DO NOT INSERT B-ROLL**. Explicitly inform the user:
    *"Dự án hiện chỉ có video gốc, không có tư liệu/hình ảnh B-roll bổ sung nên mình bỏ qua bước chèn B-roll để tránh đè video lên chính nó."*
- If secondary video/image assets exist:
  - Call `suggest_broll` (`minDuration: 5.0`, `maxDuration: 8.0`).
  - Enforce density limit: at most 1 B-roll every 4.0s.
  - Insert onto overlay track (`V2` or `V3`) via `insert_broll`:
    ```json
    {
      "op": "insert_broll",
      "assetPath": "/path/to/secondary-footage.mp4",
      "startTime": 12.0,
      "duration": 4.0,
      "fadeIn": 0.25,
      "fadeOut": 0.25,
      "muteAudio": true
    }
    ```

### Step 5.5 — Visual Accents: Text Overlays & Emotion Stickers (Anti-Collision Rules)
Khi chèn tiêu đề / con số ấn tượng kết hợp icon emotion minh hoạ:
1. **Luật chống đè hình (Anti-Collision Rule)**:
   - Hệ thống render Text dùng `positionY` theo % từ mép trên đỉnh màn hình (0% = đỉnh, 50% = giữa màn hình).
   - Hệ thống render Sticker dùng `positionY` trong `transform` theo % độ lệch từ tâm (-50% = mép trên, 0 = tâm).
   - **CẢNH BÁO**: Tuyệt đối không đặt cùng một cao độ Y tương đối (ví dụ Text `positionY: 22` và Sticker `positionY: -22`), hai phần tử sẽ đè bẹp lên nhau!
2. **Khuyến nghị chuẩn: Stacked Badge Layout (Huy hiệu xếp tầng)**:
   - **Sticker (Icon)**: Nằm ở tầng trên, `positionY: -35%` đến `-37%` (tương đương 13%–15% từ mép trên), `positionX: 0`, `scale: 25% – 28%`.
   - **Text (Tiêu đề/Con số)**: Nằm ở tầng dưới ngay dưới icon, `positionY: 26%`, `positionX: 50%`, `fontSize: 44 – 56px`.
   - Bố cục này tạo thành một khối đồ hoạ thống nhất (badge), nằm trọn vẹn ở 1/3 trên của khung hình 9:16, không che mặt người nói (ở giữa) và không che phụ đề (ở chân màn hình).

### Step 6 — Dynamic Zoom Pacing (`punch_in_sequence`)
*(Can be skipped if user says "đừng zoom" / "không đổi góc quay")*
- Locate the base footage track index (remember: subtitle track may be track 0; use the track with the primary video footage).
- Enforce density rules: only apply to clips $\ge 2.0\text{s}$, and at most 1 punch-in per 8s.
- Propose `punch_in_sequence`:
  ```json
  {
    "op": "punch_in_sequence",
    "trackIndex": 1,
    "scale": 115,
    "startWithZoom": false
  }
  ```

### Step 7 — QC, Preview, Blocking Confirmation & Commit

#### A. Quality Control (`qc_check`)
- Call `qc_check`. Ensure `issues` is empty. If warnings like `CLIP_TOO_SHORT` occur, adjust cuts or drop micro-clips before continuing.

#### B. Low-Res Preview (`render_preview`)
- Call `render_preview` for an indicative segment (e.g. 10–15s covering the first cut and punch-in) to verify smooth transitions and audio sync.

#### C. Interactive Human Inspection (`ask_confirm`, blocking)
- Call `ask_confirm` with itemized checklist.
- **CRITICAL**: Every item MUST include `startSec` and `endSec` so that clicking it jumps the editor playhead directly to that timestamp for review.
- Example payload:
  ```json
  {
    "title": "Xác nhận tự động dựng hoàn chỉnh video",
    "message": "Đã hoàn thành phân tích. Dự kiến thực hiện 4 công đoạn trên timeline:",
    "items": [
      {
        "label": "1. Cắt 2 khoảng lặng (>2.0s)",
        "detail": "Tổng cộng 4.5s được rút gọn",
        "highlight": true,
        "startSec": 6.2,
        "endSec": 8.4
      },
      {
        "label": "2. Tạo phụ đề ngắn viral",
        "detail": "Chunk 3-5 từ, phong cách tiktok-classic",
        "highlight": false,
        "startSec": 0.0,
        "endSec": 45.0
      },
      {
        "label": "3. Chèn B-roll minh hoạ",
        "detail": "Đoạn 12.0s - 16.0s (tư liệu giao diện)",
        "highlight": true,
        "startSec": 12.0,
        "endSec": 16.0
      },
      {
        "label": "4. Nhịp zoom luân phiên (115%)",
        "detail": "Đổi góc quay chống nhàm chán thị giác",
        "highlight": true,
        "startSec": 18.5,
        "endSec": 24.0
      }
    ],
    "actions": [
      { "id": "confirm", "label": "Áp dụng thay đổi", "style": "primary" },
      { "id": "cancel", "label": "Huỷ bỏ", "style": "secondary" }
    ],
    "taskIndex": 1
  }
  ```
- If user confirms (`action === 'confirm'` and `answered === true`), apply only selected items.
- If user cancels (`answered === false` or `action === 'cancel'`), abort without modifying disk.

#### D. Commit (`edit_apply`)
- Apply the proposed patch atomically via `edit_apply`.
- Provide a concise, friendly completion message in user-facing language (no technical diffs or internal codes).

---

## 5. User Step-Skipping & Customization Matrix

The user can selectively disable parts of the automated workflow in natural language. The agent must parse these requests and omit corresponding operations:

| User Request Example | Steps Executed | Steps Omitted | Explanation to User |
|---|---|---|---|
| *"Tự dựng video này"* | 1, 2, 3, 4, 5, 6, 7 | None | Full orchestration |
| *"Tự dựng nhưng đừng chèn B-roll"* | 1, 2, 3, 4, 6, 7 | Step 5 (B-roll) | Retains cuts, captions, zoom; skips B-roll |
| *"Tự dựng không zoom, giữ nguyên góc quay"* | 1, 2, 3, 4, 5, 7 | Step 6 (Zoom) | Retains cuts, captions, B-roll; skips zoom |
| *"Chỉ cắt khoảng lặng và thêm phụ đề"* | 1, 2, 3, 4, 7 | Step 5, 6 | Quick cleanup & captions only |
| *"Tự dựng không cắt tiếng, giữ nguyên nhịp nói"* | 1, 2, 4, 5, 6, 7 | Step 3 (Cut silence) | Preserves original video duration |
| Project has no secondary assets | 1, 2, 3, 4, 6, 7 | Step 5 (B-roll) | Auto-detects missing B-roll assets & notifies user |

---

## 6. Failure Recovery & Rollback

- **Invalid QC**: If `qc_check` fails after proposal, inspect the issue list:
  - If `CLIP_TOO_SHORT` ($< 0.5\text{s}$): expand cut boundary or merge with adjacent clip.
  - If `OVERLAP`: ensure overlay tracks are used instead of magnetic track V1.
- **Rollback**: If the user expresses dissatisfaction after `edit_apply`, immediately call `edit_undo` to restore the project byte-for-byte to its prior state.
