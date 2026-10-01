# Sprint Plan — Speed Curve (đường cong tốc độ) cho KailaEdit

**Ngày lập:** 2026-10-01 · **Nhánh gốc:** `main` (sau v1.0.10)

**Tham chiếu UI:** tab Speed của CapCut → tab con **Curve**: lưới preset (None, Custom, Montage, Hero, Bullet, Jump cut, Flash in, Flash out), đồ thị chỉnh điểm trục log 0.1x–10x, nhãn "Duration 6s → 7s", nút Reset, ô Smooth slow-mo.

**Tài liệu nền:** [architecture-assessment.md](./architecture-assessment.md) · [skills/video-editor-development.md](./skills/video-editor-development.md)

---

## 0. Cách dùng tài liệu này

### Dành cho agent nhận ticket

1. **Một ticket = một nhánh = một PR.** Không gộp ticket, không sửa file ngoài phạm vi ticket.
2. **Đọc mục 2 (Bẫy đã biết) trước khi viết code.**
3. **Mọi ticket phải kèm test**, trừ khi ticket ghi rõ là không cần.
4. **Không nới hành vi đang có để test xanh.** Test cũ đỏ thì sửa nguyên nhân. Chỉ được sửa test khi ticket ghi rõ là đang đổi hành vi đó có chủ đích.
5. `pnpm typecheck` phải sạch, và `npx vitest run core electron shared frontend` phải xanh, trước khi mở PR.

### Quyết định đã chốt (2026-10-01)

| # | Quyết định | Hệ quả |
|---|---|---|
| Q1 | Tab Speed có **2 tab con: Standard \| Curve** | Standard giữ phần chỉnh đơn giản (slider, nút preset tốc độ, Duration, Start Time). Curve là tính năng mới |
| Q2 | **Bỏ speed ramp dạng keyframe** (mục "Speed Ramp Presets" và nút kim cương keyframe ở thanh Speed) | Chỉ còn **một** mô hình thời gian. Dự án cũ có keyframe `speed` được chuyển thành curve khi mở (SC2) |
| Q3 | Âm thanh của clip có curve dùng **varispeed**: cao độ đổi theo tốc độ, giống băng từ | Áp dụng cho cả preview và export. Bỏ quy tắc "tắt tiếng khi có speed ramp" (KE-804) |
| Q4 | **Smooth slow-mo** (Frame blending / Optical flow) **để đợt sau** | Schema dành sẵn trường `smoothSlowMo` nhưng UI chưa hiện. Xem mục 5 |
| Q5 | Hai chế độ **loại trừ nhau** trên một clip | Có `speedCurve` thì `clip.speed` bị bỏ qua khi tính thời gian. Thao tác ở tab Standard sẽ xóa curve |

---

## 1. Hiện trạng và vì sao không thể chỉ vẽ UI lên keyframe

Speed ramp hiện là keyframe trên thuộc tính `speed`, gắn theo **thời gian timeline** (`t` = giây trong clip):

- Tích phân: `computeMediaTimeFromTimelineTime`, `integrateSpeedSegment` — [core/src/keyframes.ts](../core/src/keyframes.ts) (mục "Speed Ramp & Time Mapping")
- Export: `buildSpeedRampSetptsExpression` → [electron/export/video-filter.ts](../electron/export/video-filter.ts) (nhánh `hasSpeedKeyframes`)
- Âm thanh: bị bỏ qua — [electron/export/audio-mix.ts](../electron/export/audio-mix.ts) (`if (hasSpeedKeyframes) continue`)
- UI: 3 nút preset gọi `setKeyframe` — [SpeedPropertiesTab.tsx](../frontend/views/editor/properties/SpeedPropertiesTab.tsx)

### Lỗi đang tồn tại (được sửa luôn khi chuyển sang curve)

| # | Lỗi | Hậu quả |
|---|---|---|
| B1 | Đặt keyframe `speed` không cập nhật `duration` hay `trimEnd` | Preset Montage (đầu clip 3x) đọc vượt đoạn nguồn đã cắt, nên hình đứng ở frame cuối. `trimEnd` sai làm split/trim sau đó sai theo |
| B2 | `integrateSpeedSegment` được gọi trên đoạn con với `vStart`/`vEnd` nội suy, rồi áp easing **lần nữa** | Thời gian nguồn tính sai khi playhead nằm giữa một đoạn có easing, nên preview lệch export |
| B3 | Biểu thức `setpts` khi export dùng **tốc độ trung bình** cho mỗi đoạn keyframe | Mất ease-in/out khi xuất, chuyển động khác preview |
| B4 | ~20 file đổi thời gian theo kiểu `trimStart + t * clip.speed` (coi tốc độ là hằng số) | Split, trim, slip/slide, transition, matte, stabilization, LUT, BrushOverlay, audio sync, MCP đều sai với clip có ramp |

Danh sách file B4 (tìm bằng `grep -rlE "\* ?\(?(clip|c|primaryClip|linkedClip|src)\.speed|\.speed \?\? 1\)|mediaSecondsForTimelineSeconds\(|autoMattePlaybackRate\("`):

```
core/src/actions/clip-cinematic-actions.ts      frontend/views/editor/ClipContextMenu.tsx
core/src/actions/clip-core-actions.ts           frontend/views/editor/preview/BrushOverlay.tsx
core/src/auto-matte.ts                          frontend/views/editor/preview/LutCanvas.tsx
core/src/clip-replace.ts                        frontend/views/editor/preview/preview-frame-engine.ts
core/src/clip-speed.ts                          frontend/views/editor/preview/useVideoPoolManager.ts
core/src/keyframes.ts                           frontend/views/editor/timeline/useTimelineResize.ts
core/src/stabilization.ts                       frontend/views/editor/timeline/useTimelineSlipSlide.ts
core/src/timeline-overlap.ts                    frontend/views/editor/usePlaybackAudioSync.ts
core/src/timeline-transitions.ts                packages/kailaedit-mcp/src/tools/read-tools.ts
electron/export/render-matte-prep.ts            electron/export/video-filter.ts
                                                electron/export/audio-mix.ts
```

---

## 2. Bẫy đã biết

1. **Trục x của curve là vị trí trong NGUỒN, không phải trên timeline.** Đoạn nguồn `[trimStart, mediaDuration - trimEnd]` giữ nguyên, còn `duration` được tính lại từ curve. Nếu đặt x theo timeline, mỗi lần kéo tốc độ các điểm sẽ trôi khỏi khoảnh khắc của video. Đây cũng chính là gốc của lỗi B1.
2. **Không subscribe `currentTime` ở gần danh sách clip hoặc trong đồ thị curve.** Đường playhead trên đồ thị đọc thời gian qua rAF hoặc `getState()`. Xem memory "Editor performance".
3. **Clip video và audio đi kèm (linked) phải luôn có cùng curve.** `setClipSpeed` hiện đã cập nhật cả clip linked. Action mới cũng phải làm vậy, nếu không tiếng sẽ lệch hình.
4. **Volume là gain tuyến tính, không phải %.** Khi làm varispeed, keyframe volume (theo thời gian timeline) phải áp **sau** khi resample, trên trục timeline. Không được để ffmpeg áp lên audio trước resample. Xem memory "Audio gain".
5. **`fps=${fps}` ở cuối filtergraph** ([video-filter.ts](../electron/export/video-filter.ts), nhãn `[fpsout]`) là bước nhân đôi frame ở đoạn chậm. Đừng xóa nó, và đừng chèn thêm `fps` trong chain của từng clip.
6. **Bake matte làm theo thứ tự frame nguồn** (`BakeManifestV2.frameMap`). Người dùng bake tự áp speed khi đọc. Với curve, chỗ đọc phải dùng `sourceTimeAt` thay cho `autoMattePlaybackRate`/offset tuyến tính, nếu không mask sẽ trượt khỏi người.
7. **Render cache:** key phải có cả `speedCurve`. Nếu thiếu, sửa curve xong export vẫn ra bản cũ.
8. **Undo:** kéo một điểm trên đồ thị chỉ được tạo **một** bước undo. Khi đang kéo, giữ state tạm, chỉ commit lúc `pointerup`.

---

## 3. Thiết kế

### 3.1 Mô hình dữ liệu

```ts
// core/src/project-model.ts (+ clip-model.ts cho schema patch/MCP)
export const speedCurvePresetValues = ['custom', 'montage', 'hero', 'bullet', 'jump-cut', 'flash-in', 'flash-out'] as const

speedCurve?: {
  preset: SpeedCurvePreset
  /** Sắp xếp tăng dần theo x. Điểm đầu x=0, điểm cuối x=1, luôn có ít nhất 2 điểm. */
  points: { x: number /* 0..1 tiến độ trong nguồn */; v: number /* 0.1..10 */ }[]
  /** Dành sẵn cho đợt sau (Q4), chưa có UI. */
  smoothSlowMo?: 'off' | 'blend' | 'optical-flow'
}
```

- Thang tốc độ trong curve là 0.1x–10x, khớp đồ thị CapCut. Tab Standard vẫn cho tới 100x.
- Không có `speedCurve` (hoặc `undefined`) nghĩa là clip dùng tốc độ hằng số `clip.speed`.

### 3.2 Toán thời gian: file mới `core/src/clip-time-map.ts`

- `v(x)`: nội suy **monotone cubic (Fritsch–Carlson) trên `log10(v)`**. Đường cong ra mượt và không vọt ra ngoài [0.1, 10].
- Thời gian timeline tại vị trí nguồn x: `T(x) = L · ∫₀ˣ du / v(u)`, với `L` là độ dài đoạn nguồn (giây).
- Tính sẵn bảng `N = 512` mẫu bằng Simpson. Suy ra `duration = T(1)`. Phép ngược t → x dùng tìm kiếm nhị phân rồi nội suy tuyến tính.
- Cache bằng `WeakMap<SpeedCurve, Table>`. Store immutable nên đổi curve sẽ ra object mới, cache tự hết hạn.
- API công khai (dùng chung cho mọi nơi):

```ts
sourceSpanOf(clip, mediaDuration?): number                 // L
sourceTimeAt(clip, timeInClip): number                      // giây nguồn tuyệt đối, đã tính reversed
clipTimeAtSource(clip, sourceSec): number                   // ngược lại
speedAt(clip, timeInClip): number                           // tốc độ tức thời (playbackRate, varispeed)
durationForCurve(sourceSpan, curve): number
splitCurveAt(curve, x): [SpeedCurve, SpeedCurve]            // chèn điểm nội suy, chuẩn hóa lại x
cropCurve(curve, x0, x1): SpeedCurve                        // dùng cho trim
buildSetptsExpression(clip, segments = 48): string          // cho export
```

- Tốc độ hằng số là trường hợp đặc biệt (một đường thẳng). **Mọi chỗ trong danh sách B4 chuyển sang API này.** `mediaSecondsForTimelineSeconds` được giữ làm wrapper cho tương thích.

### 3.3 Preset (giá trị khởi điểm, tinh chỉnh khi review UI)

| Preset | Điểm `(x, v)` |
|---|---|
| Montage | (0,1) (0.25,1) (0.35,4) (0.5,0.3) (0.65,1) (1,1) |
| Hero | (0,2) (0.3,2) (0.45,0.2) (0.55,0.2) (0.7,2) (1,2) |
| Bullet | (0,1) (0.3,1) (0.4,0.2) (0.6,0.2) (0.7,1) (1,1) |
| Jump cut | (0,1) (0.4,1) (0.5,5) (0.6,1) (1,1) |
| Flash in | (0,5) (0.3,5) (0.6,1) (1,1) |
| Flash out | (0,1) (0.4,1) (0.7,5) (1,5) |
| Custom | (0,1) (0.25,1) (0.5,1) (0.75,1) (1,1) |

### 3.4 Thao tác

| Thao tác | Hành vi |
|---|---|
| `setClipSpeedCurve(id, curve \| null)` | Gán curve cho clip và các clip linked, tính lại `duration`, ripple track chính qua đường sẵn có của `setClipSpeed`. Truyền `null` thì quay về `clip.speed` |
| Split tại t | x = `clipTimeToX(t)`, rồi `splitCurveAt`. Mỗi nửa nhận `trimStart`/`trimEnd` theo x. Tổng duration không đổi (sai số dưới 1 ms) |
| Trim hai đầu | `cropCurve`, preset thành `custom` |
| Slip / slide | Giữ curve, chỉ dời đoạn nguồn |
| Tab Standard: đổi speed, chọn nút preset, sửa Duration | Xóa curve (có dòng nhắc trong UI), rồi áp tốc độ hằng số |
| Reverse | `sourceTimeAt` tự đảo. Không đổi curve |

### 3.5 UI

- `SpeedPropertiesTab` gồm thanh tab con **Standard | Curve**. Tab mặc định là chế độ clip đang dùng. Khi clip có curve, tab Curve hiện chấm báo.
- **Standard:** giữ Start Time, Speed slider, nút 0.25x–4x và Duration. Bỏ "Speed Ramp Presets", nút kim cương keyframe và cảnh báo tắt tiếng.
- **Curve:**
  - `SpeedCurvePresetGrid`: 8 ô, thumbnail SVG vẽ từ cùng dữ liệu preset. Ô đang chọn có viền accent.
  - `SpeedCurveEditor`:
    - Đồ thị SVG, trục y log có vạch 10x / 1x / 0.1x.
    - Điểm kéo được: kéo dọc để đổi v, kéo ngang bị kẹp giữa hai điểm kề nhau, điểm đầu/cuối khóa x.
    - Đường playhead đọc qua rAF. Bấm vào đồ thị thì seek.
    - Nút "+" / "−" để thêm/xóa điểm tại playhead. Nút Reset trả về preset gốc.
    - Header: `Duration {gốc}s → {mới}s`.
  - Chọn preset "None" thì gọi `setClipSpeedCurve(id, null)`.
- Timeline ([TimelineClipItem.tsx](../frontend/views/editor/timeline/TimelineClipItem.tsx)): badge "Curve" thay badge ramp cũ.
- i18n: thêm key ở `frontend/i18n/locales/{en,vi}.ts`. Xóa `speedRampAudioMuted`.

### 3.6 Preview

- `getClipTargetTime` ([preview-frame-engine.ts](../frontend/views/editor/preview/preview-frame-engine.ts)) gọi `sourceTimeAt`.
- `useVideoPoolManager`: `playbackRate = speedAt(t)` ở mỗi tick. Ngưỡng drift và seek-driven giữ nguyên (curve tối đa 10x, dưới ngưỡng 16x).
- `usePlaybackAudioSync`: với clip có curve, đặt `el.preservesPitch = false` và cập nhật `playbackRate = speedAt(t)` mỗi tick. Tắt tiếng khi tốc độ ra ngoài 0.25–4x (giới hạn trình duyệt, giống logic hiện tại).

### 3.7 Export video

- Nhánh `hasSpeedKeyframes` trong `video-filter.ts` đổi thành `clip.speedCurve`:
  `trim=start:end (theo nguồn), setpts=PTS-STARTPTS, setpts='${buildSetptsExpression(clip)}'`.
- Biểu thức là **hàm tuyến tính từng khúc gồm 48 đoạn chia đều theo x**, lấy từ bảng ở 3.2, dạng `if(lt(T,m_i), ..., ...)` lồng nhau. Sai số phải dưới nửa frame ở 60fps (có test kiểm).
- Áp tương tự cho nhánh nền blur (`primaryClip`) trong cùng file.
- `buildSpeedRampSetptsExpression` và `integrateSpeedSegment` bị xóa sau khi SC2 chuyển xong dữ liệu.

### 3.8 Export âm thanh (varispeed)

Thay `continue` trong `mixAudioToPcm` bằng nhánh riêng:

1. Lấy PCM nguồn ở **1x**, chưa có volume filter: `buildAudioPcmArgs(..., speed = 1, reversed = false, volumeTrack = undefined)`.
2. **Resample với tốc độ thay đổi trong JS:**
   - Với mỗi mẫu ra `n`, tính `t = n / SR`, rồi `s = sourceTimeAt(clip, t) - trimStart` (có tính reversed), rồi `idx = s · SR`.
   - Nội suy Hermite 4 điểm giữa các mẫu nguồn.
   - Khi `v > 1`, lọc thông thấp trước để tránh aliasing (box filter có độ rộng `ceil(v)` mẫu là đủ cho bản đầu).
3. Áp keyframe volume theo trục timeline (`sampleKeyframeTrack`) rồi cộng vào `mixBuffer`.

Đặt hàm thuần ở `core/src/varispeed.ts` (không phụ thuộc Node) để test được và dùng lại được.

### 3.9 Migration và AI

- `frontend/lib/project-migration.ts`: clip có keyframe `speed` thì lấy mẫu hàm cũ tại ~32 điểm. Với mỗi điểm, `x = M(t)/M(duration)` và `v = value`. Sau đó xóa track keyframe `speed` và đặt `trimEnd` cho khớp `M(duration)` (đồng thời sửa luôn B1). Nhớ tăng version của project.
- Bỏ `'speed'` khỏi `keyframeProperty` trong schema patch ([clip-model.ts](../core/src/clip-model.ts)). Validator từ chối với thông báo hướng sang `set_speed_curve`.
- MCP (`packages/kailaedit-mcp`): thêm tool `set_speed_curve { clipId, preset? , points? }`. Read-tools trả về `speedCurve` và duration đã tính.
- [editpilot-prompt.ts](../core/src/editpilot-prompt.ts): thay đoạn "BIẾN ĐỔI TỐC ĐỘ (SPEED RAMP)" bằng hướng dẫn dùng `set_speed_curve`.

---

## 4. Tickets

### SC0 — Lõi thời gian `clip-time-map` *(không UI)*
- Thêm schema `speedCurve` và file `core/src/clip-time-map.ts` với API ở 3.2. Thêm `core/src/speed-curve-presets.ts`.
- **Test** (`core/tests/clip-time-map.test.ts`):
  - Tốc độ hằng số cho đúng kết quả của công thức cũ.
  - Round-trip `clipTimeAtSource(sourceTimeAt(t)) ≈ t`.
  - `duration` của curve phẳng v=2 bằng L/2.
  - `splitCurveAt` bảo toàn tổng duration.
  - Trường hợp reversed.
  - Giá trị nội suy không vượt [0.1, 10].
  - Benchmark: 10.000 lần gọi `sourceTimeAt` dưới 5 ms khi đã có cache.

### SC1 — Action và thao tác timeline *(phụ thuộc SC0)*
- `setClipSpeedCurve` trong `clip-core-actions.ts` (có ripple và đồng bộ clip linked), cùng split, trim, slip/slide.
- Chuyển các file **core** trong danh sách B4 sang `clip-time-map`.
- **Test:** split clip có curve thì 2 nửa nối liền nhau về nguồn (không lặp, không hụt). Ripple track chính sau khi đổi curve. Clip linked có cùng curve. Undo đúng 1 bước.

### SC2 — Migration và bỏ keyframe speed *(phụ thuộc SC1)*
- Migration theo 3.9. Xóa `'speed'` khỏi danh sách keyframe property. Xóa `integrateSpeedSegment` và `buildSpeedRampSetptsExpression`.
- **Test:** dự án fixture có 3 preset ramp cũ, sau migrate thì `duration` giữ nguyên và frame nguồn tại 5 mốc lệch dưới 1 frame so với hàm cũ đã sửa B2.

### SC3 — Preview *(phụ thuộc SC1)*
- Chuyển các file **frontend** trong B4 sang API mới. Cập nhật `playbackRate` liên tục cho video và audio (3.6).
- **Kiểm tra thủ công trong app:** preset Bullet chậm đúng đoạn giữa, không giật khi qua điểm nối. Mask smart-brush vẫn bám người trên clip có curve.

### SC4 — UI 2 tab *(phụ thuộc SC1, làm song song với SC3)*
- Tab con Standard | Curve, `SpeedCurvePresetGrid`, `SpeedCurveEditor`, badge timeline, i18n (3.5).
- **Test** (vitest + testing-library):
  - Chọn preset thì gọi `setClipSpeedCurve` đúng điểm.
  - Kéo điểm tạo 1 bước undo.
  - Đổi tốc độ ở tab Standard thì curve bị xóa.
  - Đồ thị không re-render khi `currentTime` đổi (đếm render).

### SC5 — Export video *(phụ thuộc SC1)*
- `buildSetptsExpression` 48 đoạn, nhánh video và blur trong `video-filter.ts`, key render-cache.
- **Test:**
  - `filtergraph-well-formed`: ffmpeg parse được biểu thức.
  - `preview-export-parity`: frame nguồn ở 20 mốc lệch dưới nửa frame giữa preview và export.
  - Export thật một clip 5s preset Hero, duration file ra khớp với `durationForCurve` (sai số dưới 1 frame).

### SC6 — Âm thanh varispeed *(phụ thuộc SC1, SC3)*
- `core/src/varispeed.ts` và nhánh mới trong `audio-mix.ts` (3.8).
- **Test:**
  - Sóng sin 440 Hz qua curve phẳng v=2 thì ra 880 Hz (đo zero-crossing) và dài một nửa.
  - Keyframe volume áp theo trục timeline.
  - Không có mẫu NaN hay vượt full-scale trước limiter.
  - Clip linked: audio và video cùng duration.

### SC7 — AI và tài liệu *(phụ thuộc SC2)*
- Tool MCP `set_speed_curve`, cập nhật read-tools, prompt EditPilot, user guide (`docs/{vi,en}/user-guide`), CHANGELOG.

```
SC0 → SC1 → ┬→ SC2 → SC7
            ├→ SC3 → SC6
            ├→ SC4
            └→ SC5
```

---

## 5. Để đợt sau

- **Smooth slow-mo** (Q4): chỉ áp khi export, cho clip có `min(v) < 1`.
  - `blend`: thêm `framerate=fps=${fps}` sau `setpts`.
  - `optical-flow`: dùng `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1`, chậm, nên cần cảnh báo thời gian xuất.
  - UI là ô checkbox kèm dropdown như CapCut, ghi chú "áp dụng khi xuất".
- **Giữ cao độ** khi varispeed (time-stretch). Cần kiểm tra ffmpeg-static có `rubberband` không. Nếu không có thì phải tự viết WSOLA.
- Curve cho clip ảnh hoặc GIF: không làm, vì không có thời gian nguồn.
