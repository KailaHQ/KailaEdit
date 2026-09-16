---
name: dynamic-zoom
description: Dynamic Zoom (Punch-in cut) workflow to alternate shot framing between medium shot (100%) and close-up (115%–120%) across speaking cuts to maintain visual retention.
---

# KailaEdit Skill: Dynamic Zoom (`dynamic-zoom`)

This skill defines the standard procedure for applying dynamic zoom (punch-in cuts) to conversational video clips on the KailaEdit timeline.

---

## 1. Principles of Talking Head Pacing

Continuous single-angle videos (e.g. tutorials, podcasts, vlogs, TikTok/Reels commentaries) suffer from viewer fatigue when the camera angle remains static for more than 4–6 seconds.

**Dynamic Zoom** introduces rhythmic visual variation by cutting between two virtual camera angles from a single high-resolution source:
1. **Medium Shot (A-Cam: 100% Zoom)**: The standard framing, showing head and torso. Used for general exposition or neutral statements.
2. **Close-up Punch-in (B-Cam: 115%–120% Zoom)**: A punchy close-up, zooming in slightly on the speaker's face. Used for punchlines, key arguments, call-to-actions, or emotional emphasis.

---

## 2. Thresholds & Recommended Parameters

| Parameter | Recommended Value | Range | Notes |
|---|---|---|---|
| **Zoom Scale (`scale`)** | `115%` | `110%` – `125%` | Zooming beyond 125% causes perceptible resolution degradation on 1080p footage. |
| **Origin / Centering** | Centered (`positionX: 0, positionY: 0`) | Centered | Automatic offset: KailaEdit ffmpeg exporter and CSS preview automatically maintain frame centering. |
| **Sequence Alternation** | `100%` $\to$ `115%` $\to$ `100%` $\to$ `115%` | Alternating | Apply across consecutive sentence-level cuts after silent interval removal or transcribe cut. |

---

## 3. Workflow for CoEdit

When asked to "tạo nhịp zoom", "punch-in", "dynamic zoom", or "tạo góc quay cận cảnh":

### Step 1: Inspect Timeline
Use `timeline_describe` to inspect existing clips on the primary video track (`V1` / `trackIndex: 0`). Verify clip IDs, start times, and durations.

### Step 2: Propose EditPatch
Use `edit_propose` with one of the two operations:

#### Option A: Alternating Sequence across a Track (`punch_in_sequence`)
Ideal when the speaker has multiple consecutive cuts:
```json
{
  "version": 1,
  "description": "Áp dụng nhịp zoom luân phiên 100% ↔ 115% trên track chính",
  "operations": [
    {
      "op": "punch_in_sequence",
      "trackIndex": 0,
      "scale": 115,
      "startWithZoom": false
    }
  ]
}
```

#### Option B: Target Punch-in on a Specific Emphasis Clip (`punch_in_cut`)
Ideal when highlighting a specific punchline or hook:
```json
{
  "version": 1,
  "description": "Punch-in cận cảnh 120% cho câu nhấn mạnh",
  "operations": [
    {
      "op": "punch_in_cut",
      "clipId": "clip_abc123",
      "scale": 120
    }
  ]
}
```

### Step 3: Verify & Apply
1. Check that the proposal is valid (`valid: true`).
2. Run `render_preview` if user review is desired.
3. Run `qc_check` to verify no timeline bounds are violated.
4. Execute `edit_apply` to commit changes atomically.
