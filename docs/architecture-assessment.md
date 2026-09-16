# Báo cáo đánh giá kiến trúc KailaEdit

**Ngày:** 2026-09-04 · **Nhánh:** `strip-to-video-editor` · **Phạm vi:** toàn bộ `electron/`, `frontend/`, `shared/`

**Hai câu hỏi được đặt ra:**

1. Hệ thống có đáp ứng được video dài, nhiều cảnh cắt ghép, hiệu ứng phức tạp, nhiều định dạng input không?
2. Hệ thống có sẵn sàng cung cấp API/MCP để AI agent (Claude, Antigravity, Codex…) kết nối và thao tác dạng copilot/autopilot không?

**Phương pháp:** đọc mã nguồn và truy vết luồng dữ liệu. Các con số về bộ nhớ/thời gian trong báo cáo là **tính toán từ mã**, không phải đo đạc thực nghiệm — mục 6 nói rõ giới hạn này.

---

## 0. Tóm tắt điều hành

| Hạng mục | Đánh giá | Ghi chú |
|---|---|---|
| Video dài (> 20–30 phút) | **Không đạt** | Có trần cứng về RAM trong bước trộn audio |
| Nhiều cảnh cắt ghép (> ~50 clip) | **Rủi ro cao** | Chi phí giải mã tăng theo cấp số nhân |
| Hiệu ứng phức tạp | **Đạt một phần** | Không có keyframe; mask không được xuất |
| Nhiều định dạng input | **Đạt một nửa** | Export ổn, nhưng preview mù với nhiều định dạng |
| Sẵn sàng cho API/MCP | **Nền móng tốt, chưa có cổng** | 155 reducer thuần đã tách khỏi UI — thiếu lớp truy cập |

**Kết luận ngắn.** Kiến trúc *biên tập* (state, action, undo) được thiết kế tốt và bất ngờ sẵn sàng cho agent. Kiến trúc *kết xuất* (render) mới là chỗ yếu: nó được viết cho video ngắn vài phút và sẽ vỡ có thể dự đoán được khi kéo dài thời lượng. Việc mở API/MCP rẻ hơn nhiều so với việc làm cho render chịu tải — và nên làm sau, vì mở API cho một engine chưa chịu được tải chỉ khiến agent gặp lỗi nhanh hơn.

---

## 1. Bản đồ kiến trúc hiện tại

```
┌─────────────────────────── Renderer (Chromium) ────────────────────────────┐
│  React UI                                                                  │
│    └─ editor-store.tsx (zustand)                                           │
│         ├─ editor-actions.ts   155 reducer thuần (state, args) => state    │
│         ├─ editor-selectors.ts read model                                  │
│         └─ history: undo/redo snapshot, tối đa 50 bước                     │
│  Preview: pool <video> HTML5, mỗi file nguồn một phần tử                   │
│  Lưu trữ: localStorage (komfyedit-project-<id>)                            │
└──────────────────────────────────┬─────────────────────────────────────────┘
                                   │ contextBridge — CHỈ ipcRenderer.invoke
                                   │ hợp đồng zod: shared/electron-api-schema.ts
┌──────────────────────────────────┴─────────────────────────────────────────┐
│  Main process (Node)                                                       │
│    ├─ ipc/file-handlers.ts     copy asset, thumbnail, dialog               │
│    ├─ ipc/video-processing     extractVideoFrame, getAudioPeaks            │
│    └─ export/                  ffmpeg-static, 3 bước tuần tự               │
└────────────────────────────────────────────────────────────────────────────┘
```

Luồng export (`electron/export/export-handler.ts`):

```
Bước 1  Video-only  →  1 lệnh ffmpeg, filter_complex, mỗi clip = 1 input  →  MKV x264 CRF16 (trung gian)
Bước 2  Audio       →  N lệnh ffmpeg (mỗi clip 1 lệnh) → PCM vào RAM → trộn trong JS → WAV
Bước 3  Ghép        →  1 lệnh ffmpeg mux video + audio → file đích
```

---

## 2. Câu hỏi 1 — Video dài, nhiều cắt ghép, hiệu ứng, đa định dạng

### 2.1 Trần cứng về RAM khi trộn audio — **Nghiêm trọng, là điểm vỡ đầu tiên**

**Bằng chứng:** `electron/export/audio-mix.ts:122-127`

```ts
const totalFrames  = Math.ceil(totalDuration * SAMPLE_RATE)   // 48 kHz
const totalSamples = totalFrames * NUM_CHANNELS               // stereo
const mixBuffer    = new Float64Array(totalSamples)           // 8 byte/mẫu
```

Toàn bộ audio của **cả timeline** được giữ trong RAM cùng lúc, ở độ phân giải Float64. Cộng thêm: mỗi clip nguồn được giải mã trọn vẹn vào một `Buffer` riêng (`extractPcmBuffer` gom `chunks` rồi `Buffer.concat`, dòng 47-56), và cuối cùng là một `Buffer` PCM đầu ra nữa.

| Thời lượng timeline | mixBuffer (Float64) | PCM đầu ra | Tổng tối thiểu |
|---|---|---|---|
| 5 phút | 230 MB | 58 MB | ~0,3 GB |
| 15 phút | 691 MB | 173 MB | ~0,9 GB |
| 30 phút | 1,38 GB | 346 MB | ~1,7 GB |
| 60 phút | 2,76 GB | 691 MB | ~3,5 GB |

Chưa tính buffer PCM của từng clip nguồn đang giữ song song. Trên máy 16 GB, export 30 phút đã bắt đầu tráo bộ nhớ; 60 phút gần như chắc chắn `RangeError`/OOM trong main process, và **main process chết là chết cả app** — không phải chỉ hỏng lần export đó.

Ngoài ra buffer PCM còn được ghi ra đĩa dạng `.raw` rồi convert sang `.wav` (`export-handler.ts:66-82`); WAV/RIFF có trần 4 GB, đạt ở khoảng 5,8 giờ — không phải trần đầu tiên nhưng vẫn là trần.

**Hướng sửa:** thay việc trộn trong JS bằng `amix`/`adelay` trong chính filtergraph của ffmpeg, hoặc trộn theo khối (streaming) 10 giây một, ghi thẳng ra stdout. Bộ giới hạn look-ahead hiện có (`audio-limiter.ts`) cần được viết lại theo mô hình streaming với cửa sổ trượt — đây là phần công việc thật, không phải thay vài dòng.

---

### 2.2 Mỗi clip giải mã lại từ đầu file nguồn — **Nghiêm trọng**

**Bằng chứng:** `electron/export/video-filter.ts:176-178`

```ts
inputs.push('-i', clip.path)
chain = `[${inputIdx}:v]trim=start=${clip.trimStart}:end=${trimEnd},setpts=PTS-STARTPTS`
```

`trim` là filter, chạy **sau** khi giải mã. Không có `-ss` trước `-i`, nên với một clip lấy ở phút thứ 90 của file nguồn, ffmpeg phải giải mã đủ 90 phút rồi vứt đi. Bên audio y hệt (`audio-mix.ts:24`, dùng `atrim` với chú thích "sample-accurate" — đúng về độ chính xác, sai về chi phí).

**Hệ quả định lượng.** Cắt một file nguồn 2 giờ thành 50 clip rải đều: tổng công giải mã ≈ Σ trimEnd ≈ 50 × 60 phút = **50 giờ giải mã** cho một video đầu ra 10 phút. Chi phí tăng theo **bình phương** số nhát cắt trên cùng một nguồn dài — đúng kịch bản "video dài, nhiều cảnh cắt ghép" trong câu hỏi.

**Hướng sửa:** `-ss <trimStart - 2s> -i file` (seek nhanh trước input) rồi `atrim`/`trim` tinh chỉnh 2 giây còn lại để giữ độ chính xác mẫu. Đây là thay đổi nhỏ, lợi ích lớn nhất trên mỗi dòng mã trong toàn bộ báo cáo này.

---

### 2.3 Mỗi clip là một input ffmpeg, chuỗi overlay tuyến tính — **Cao**

**Bằng chứng:** `video-filter.ts:160-222` — vòng lặp qua mọi clip, mỗi vòng `inputs.push('-i', ...)` và nối thêm một tầng `overlay` vào chuỗi.

Với 200 clip: 201 input mở đồng thời (200 decoder + 1 lavfi), một filtergraph có 200 tầng overlay nối tiếp. Vấn đề:

- Bộ nhớ decoder cộng dồn tuyến tính, mỗi decoder H.264 4K chiếm hàng chục MB.
- Chuỗi overlay tuyến tính không song song hoá được — ffmpeg xử lý theo tầng.
- Mỗi clip bị `tpad` đệm trong suốt từ 0 đến vị trí của nó trên timeline (dòng 205-207), nghĩa là clip ở phút 50 mang theo 50 phút khung trong suốt chảy qua chuỗi overlay.
- Dòng lệnh/filter script có thể chạm giới hạn thực tế của ffmpeg.

**Hướng sửa:** chia timeline thành các đoạn (segment) theo ranh giới clip, render từng đoạn song song, rồi `concat` bằng demuxer. Đây cũng là kiến trúc cho phép render tăng dần (chỉ render lại đoạn bị sửa) — điều mà một agent tự động sửa video sẽ cần rất nhiều.

---

### 2.4 File trung gian không kiểm soát dung lượng — **Trung bình**

**Bằng chứng:** `export-handler.ts:60-64` — bước 1 luôn ghi MKV `libx264 -preset fast -crf 16` vào `os.tmpdir()`.

CRF 16 ở 4K ≈ 50–80 Mbps → **1 giờ ≈ 25–36 GB** trên ổ hệ thống. Không kiểm tra dung lượng trống trước khi chạy, không dọn dẹp nếu tiến trình bị kill (chỉ dọn trong nhánh lỗi có kiểm soát). Ổ C: đầy giữa chừng sẽ cho lỗi ffmpeg khó hiểu.

---

### 2.5 Không có tiến độ thật và không hủy được đúng nghĩa — **Cao (chặn autopilot)**

**Bằng chứng:**
- `electron/preload.ts` — chỉ có `ipcRenderer.invoke`, **không đăng ký một kênh sự kiện nào**. Main process không có cách nào đẩy tin về renderer.
- `frontend/components/ExportModal.tsx:288-292` — thanh tiến độ được đặt cứng `0 → 50 → 100`. Đó là hoạt ảnh, không phải tiến độ.
- `shared/electron-api-schema.ts` — `exportCancel` nhận `sessionId`, nhưng `export-handler.ts:120` bỏ qua tham số và gọi `stopExportProcess()` giết tiến trình toàn cục duy nhất. Không có khái niệm phiên; không thể chạy hai export song song.

Với người dùng, đây là phiền toái. Với **autopilot** thì đây là lỗi chặn: agent gửi lệnh render 40 phút và không có cách nào biết nó đang ở đâu, còn sống không, hay nên hủy.

---

### 2.6 Preview mù với chính những định dạng mà app cho phép import — **Cao**

**Bằng chứng:**
- `frontend/views/editor/external-file-drop.ts:6-12` chấp nhận: `mp4 mov mkv webm avi m4v mpg mpeg wmv` + `mp3 wav m4a aac flac ogg opus` + ảnh.
- `frontend/views/editor/ProgramMonitor.tsx:103-109` phát bằng `<video src="file://...">`, tức bằng bộ giải mã của Chromium.

Chromium trong Electron **không** giải mã: HEVC/H.265 (trừ khi có decoder hệ thống + cờ), ProRes, DNxHD, MPEG-2, container MKV, AVI, WMV, MXF. Nghĩa là người dùng import `.mkv` hoặc `.mov` ProRes thành công, thấy thumbnail (do ffmpeg tạo), nhưng **preview đen** — trong khi export lại ra đúng, vì export đi qua ffmpeg. Sự lệch pha này khó chẩn đoán với người dùng: file "vào được" nhưng "không xem được".

Đây là lý do mọi NLE chuyên nghiệp đều có **proxy/optimized media**. Grep toàn bộ mã: **không có khái niệm proxy nào** (nhãn "Proxy: Turned off" trong panel Details là văn bản tĩnh, không nối vào logic nào).

---

### 2.7 Pool video preview không giới hạn — **Trung bình**

**Bằng chứng:** `ProgramMonitor.tsx:452` — `Map<string, HTMLVideoElement>`, mỗi đường dẫn nguồn một phần tử `<video preload="auto">`, chỉ giải phóng khi nguồn rời khỏi tập "desired". Với một project 30 file 4K, đó là 30 pipeline giải mã cùng tồn tại trong renderer.

Đồng thời preview chỉ hiển thị **một clip chính** tại một thời điểm, các lớp phủ mô phỏng bằng CSS. Nghĩa là preview không phải là bản xem trước trung thực của composite nhiều lớp mà export sẽ tạo ra — người dùng chỉ thấy kết quả thật sau khi render xong.

---

### 2.8 Hiệu ứng: trần năng lực rõ ràng — **Trung bình đến Cao (tuỳ kỳ vọng)**

| Khả năng | Trạng thái | Bằng chứng |
|---|---|---|
| Keyframe / animation theo thời gian | **Không có** | grep `keyframe` toàn repo: 0 kết quả. `transform` là giá trị tĩnh cho cả clip |
| Mask cho hiệu ứng | Chỉ có ở preview | `video-editor-utils.ts:694` có `getMaskedEffectOverlays`; `effects-filter.ts:78` ghi rõ "Masks are not supported here" |
| Transition thật (2 luồng) | Suy biến | `video-filter.ts:92-94`: mọi wipe/dissolve đều thành `fade alpha`, kèm chú thích thừa nhận |
| Bộ hiệu ứng | 11 loại | blur, sharpen, glow, vignette, grain + 6 LUT giả lập bằng `curves`/`colorbalance` |
| LUT thật (.cube) | Không có | không có `lut3d` |
| Nested timeline / compound clip | Chỉ flatten | `useTimelineDrag.ts:1140` sao chép phẳng clip khi thả timeline vào timeline |
| Tăng tốc phần cứng | Không có | không có `-hwaccel`, `nvenc`, `videotoolbox`, `qsv` ở đâu |

Không có keyframe là giới hạn kiến trúc lớn nhất về mặt sáng tạo: mọi hiệu ứng chuyển động (zoom Ken Burns, pan, fade tuỳ biến, animation text) đều không biểu diễn được trong mô hình dữ liệu hiện tại. Thêm keyframe sau này sẽ đụng vào `TimelineClip` schema, preview, export và cả API cho agent — nên quyết định sớm thì rẻ hơn nhiều.

---

### 2.9 Lưu trữ project trong localStorage — **Cao**

**Bằng chứng:** `frontend/lib/project-storage.ts:37,58` — `localStorage.getItem/setItem` với toàn bộ project serialize thành một chuỗi JSON.

Ba vấn đề:

1. **Hạn mức.** Chromium cấp ~5–10 MB cho mỗi origin. Mỗi clip nhúng một bản sao đầy đủ của asset (thấy rõ trong dữ liệu thật: mỗi clip có object `asset` lồng bên trong). Một project vài trăm clip có thể chạm hạn mức, và khi đó `setItem` **ném lỗi** — mã hiện tại không bắt lỗi quota ở `writeProject`, nghĩa là **mất dữ liệu âm thầm**.
2. **Chi phí mỗi lần lưu.** `writeProject` gọi `projectSchema.parse(...)` — validate zod toàn bộ project — trên **mỗi lần autosave** (debounce ở `VideoEditor.tsx:241`). Với project lớn, đây là công O(n) lặp lại liên tục trên luồng UI.
3. **Không truy cập được từ ngoài.** Đây là điểm nối sang câu hỏi 2: dữ liệu project nằm trong LevelDB nội bộ của Chromium, một tiến trình Node bên ngoài **không thể đọc hay ghi**. Tôi đã thử trong lúc gỡ lỗi phiên trước: file bị khoá bởi tiến trình đang chạy và nội dung bị nén Snappy.

---

### 2.10 Không có một dòng test tự động nào — **Cao**

**Bằng chứng:** `find . -name "*.test.ts*"` → rỗng. `package.json` không có test runner. `.github/workflows/ci.yml` chỉ chạy `typecheck` và `build`.

Với một ứng dụng biên tập, phần logic thuần (resolveOverlaps, packTrack1, pruneEmptyOverlayTracks, buildVideoFilterGraph, timeline-import) là loại mã **dễ test nhất có thể** — hàm thuần, vào ra rõ ràng. Chi phí viết test thấp, và ba lỗi được phát hiện trong phiên làm việc gần đây (mất track khi kéo clip, media rơi vào hư không khi thả sai lane, V1 không dồn trái) đều là loại lỗi mà một test đơn vị bắt được ngay. Với autopilot thì đây không còn là "nên có": agent sẽ tạo ra các chuỗi thao tác mà không ai từng thử bằng tay.

---

## 3. Câu hỏi 2 — API/MCP cho AI agent

### 3.1 Nền móng sẵn có — tốt hơn kỳ vọng

Đây là phần đáng mừng của báo cáo. Kiến trúc state đã vô tình được chuẩn bị rất tốt cho agent:

| Tài sản | Vị trí | Vì sao quan trọng với agent |
|---|---|---|
| **155 reducer thuần** `(state, ...args) => state` | `editor-actions.ts` | Đây chính là một **command API hoàn chỉnh**, đã tách khỏi React. Không cần thiết kế lại tập lệnh — nó đã tồn tại |
| Đăng ký action tự động qua kiểu | `editor-store.tsx:133-160` | Mọi hàm export đúng chữ ký tự động thành action. Sinh schema tool cho MCP từ đây là khả thi |
| Read model tách riêng | `editor-selectors.ts` | Agent cần "nhìn" trước khi "làm"; selector là lớp đọc sẵn có |
| Undo/redo tập trung, 1 bước/thao tác | `editor-store.tsx:41-58` | Cơ chế rollback cho autopilot đã có sẵn |
| Hợp đồng IPC bằng zod | `shared/electron-api-schema.ts` | Đã có văn hoá "API có schema"; mở rộng theo mẫu này là tự nhiên |
| Import/export FCPXML | `frontend/lib/timeline-import.ts`, `useTimelineXmlExport.ts` | Định dạng trao đổi để agent nhập/xuất timeline nguyên khối |
| Nguyên thuỷ quan sát | `extractVideoFrame`, `getAudioPeaks` | Agent đa phương thức có thể *xem* khung hình và *đọc* dạng sóng — hạ tầng cho "hiểu nội dung video" đã có |

Nói cách khác: **phần khó nhất của một API cho agent — mô hình lệnh sạch, thuần, có undo — đã xong.** Cái thiếu là đường dẫn từ bên ngoài vào.

### 3.2 Những gì đang chặn

| Rào cản | Chi tiết | Mức |
|---|---|---|
| Reducer nằm trong bundle renderer | `frontend/views/editor/editor-actions.ts` import từ `frontend/types`, chỉ chạy trong Chromium. Tiến trình Node không dùng lại được | **Chặn** |
| State chứa `Set` | `EditorSelectionState.clipIds: Set<string>` — không JSON-serialize được, phải có lớp mã hoá ở biên API | Trung bình |
| IPC một chiều | `preload.ts` chỉ có `invoke`. Không có `on`/sự kiện → agent không nhận được tiến độ, thay đổi state, hay lỗi bất đồng bộ | **Chặn** |
| Không có chế độ headless | Mọi thứ đòi hỏi cửa sổ Electron và tương tác người dùng (dialog chọn file, modal export) | **Chặn autopilot** |
| Project trong localStorage | Không tiến trình ngoài nào đọc/ghi được (mục 2.9) | **Chặn** |
| Không có ranh giới giao dịch | Agent thực hiện 20 thao tác; nếu thao tác 15 sai thì không có "hoàn tác cả lô" | Cao |
| Không có dry-run | Không cách nào hỏi "nếu làm việc này thì timeline sẽ ra sao" mà không thực sự thay đổi | Cao |
| Không có test | Không có lưới an toàn cho hành vi do máy sinh ra (mục 2.10) | Cao |

### 3.3 Kiến trúc đề xuất — ba lớp

```
┌─ Lớp 3: MCP Server (gói npm riêng, stdio) ────────────────────────┐
│  Ánh xạ tool MCP → lời gọi RPC. Mỏng, không chứa logic biên tập.  │
│  Đây là thứ Claude / Codex / Antigravity kết nối vào.             │
└──────────────────────────┬────────────────────────────────────────┘
                           │ JSON-RPC qua stdio hoặc WebSocket localhost + token
┌──────────────────────────┴────────────────────────────────────────┐
│  Lớp 2: Command Gateway (trong main process Electron)             │
│   • Áp lệnh lên store, phát sự kiện thay đổi                      │
│   • Giao dịch: begin/commit/rollback, gộp thành 1 bước undo       │
│   • Dry-run: áp lên bản sao state, trả về diff, không ghi         │
│   • Hàng đợi render có phiên, có tiến độ thật                     │
└──────────────────────────┬────────────────────────────────────────┘
                           │ import trực tiếp
┌──────────────────────────┴────────────────────────────────────────┐
│  Lớp 1: core/ — package TypeScript thuần, không phụ thuộc React   │
│   Di chuyển sang đây: project-model, editor-state,                │
│   editor-actions (155 reducer), editor-selectors,                 │
│   video-editor-utils (resolveOverlaps, packTrack1, …)             │
│   Cả renderer lẫn main process cùng import. Một nguồn sự thật.    │
└───────────────────────────────────────────────────────────────────┘
```

**Lớp 1 là công việc quan trọng nhất và cũng ít rủi ro nhất:** phần lớn là di chuyển file và gỡ import React. Sau khi có nó, logic biên tập chạy được trong Node → test được, gọi được từ CLI, dùng được cho render headless, và là nền cho mọi thứ còn lại.

### 3.4 Tập tool MCP đề xuất

Chia theo *quan sát* / *thao tác* / *kết xuất* — ranh giới quan trọng vì copilot chỉ cần nhóm đầu, autopilot cần cả ba.

**Quan sát (chỉ đọc, luôn an toàn)**
| Tool | Trả về |
|---|---|
| `project.list` / `project.open` | Danh sách và metadata project |
| `timeline.describe` | Cây timeline: track, clip, thời điểm, thời lượng, hiệu ứng — JSON |
| `timeline.summary` | Bản tóm tắt nén cho ngữ cảnh LLM (số cảnh, tổng thời lượng, khoảng trống) |
| `media.list` | Asset trong project kèm thời lượng, độ phân giải, codec |
| `media.probe` | ffprobe đầy đủ một file |
| `observe.frame` | PNG khung hình tại thời điểm t — *đã có `extractVideoFrame`* |
| `observe.audioPeaks` | Dạng sóng — *đã có `getAudioPeaks`* |
| `observe.scenes` | **Cần xây**: phát hiện cắt cảnh bằng `ffmpeg select=gt(scene,…)` |
| `observe.silence` | **Cần xây**: khoảng lặng bằng `silencedetect` — nền cho auto-cut lời thoại |

Ba tool `observe.*` cuối là thứ biến agent từ "làm theo lệnh" thành "hiểu nội dung": có chúng, agent tự trả lời được "cắt bỏ mọi đoạn im lặng dài hơn 2 giây" hay "tìm cảnh có người nói".

**Thao tác (ghi, cần giao dịch)**
| Tool | Ánh xạ tới |
|---|---|
| `edit.begin` / `edit.commit` / `edit.rollback` | Giao dịch — **cần xây** |
| `clip.insert` | `insertAssetsToTimeline` ✅ đã có |
| `clip.split` | `splitClipsAtTime` ✅ |
| `clip.move` / `clip.trim` | `moveClips`, `resizeClip` ✅ |
| `clip.delete` | `deleteClips` ✅ |
| `clip.setProperty` | ~20 setter `setClip*` ✅ |
| `effect.add` / `effect.setParam` | `addClipEffect`, `setClipEffectParam` ✅ |
| `text.add` / `subtitle.import` | `addTextClip`, `importSrtCues` ✅ |
| `track.*` | `addTrack`, `deleteTrack`, `toggleTrackLock` ✅ |
| `timeline.importXml` | `importParsedTimeline` ✅ |

Cột bên phải cho thấy điều quan trọng: **gần như toàn bộ mặt ghi đã tồn tại**. Việc còn lại chủ yếu là phơi bày, không phải xây mới.

**Kết xuất**
| Tool | Trạng thái |
|---|---|
| `render.start` | Có `exportNative`, nhưng cần trả về `jobId` thay vì chặn |
| `render.status` | **Cần xây** — phụ thuộc mục 2.5 |
| `render.cancel` | Có khung, cần gắn với phiên thật |
| `render.preview` | **Cần xây** — render nhanh, độ phân giải thấp một đoạn, để agent tự kiểm tra kết quả |

`render.preview` đáng được nhấn mạnh: nếu không có nó, agent làm việc mù — nó sửa timeline mà không bao giờ thấy kết quả. Một bản render 480p của 10 giây quanh chỗ vừa sửa là vòng phản hồi rẻ và biến đổi hoàn toàn chất lượng công việc tự động.

### 3.5 Copilot và Autopilot đòi hỏi khác nhau

| | Copilot (người xác nhận) | Autopilot (agent tự chạy) |
|---|---|---|
| Nhóm tool cần | Quan sát + Thao tác | Cả ba |
| Giao dịch | Nên có | Bắt buộc |
| Dry-run + diff | Nên có | Bắt buộc |
| Tiến độ render | Nên có | Bắt buộc |
| Headless | Không cần | Bắt buộc |
| Test tự động | Nên có | Bắt buộc |

Copilot khả thi sau Giai đoạn 1-2 bên dưới. Autopilot cần cả bốn giai đoạn cộng với việc sửa được nền tảng render ở mục 2.

---

## 4. Lộ trình đề xuất

**Giai đoạn 0 — Chặn chảy máu (1–2 ngày, độc lập với mọi thứ khác)**
1. Thêm `-ss` seek trước input trong export video và audio (mục 2.2). Lợi ích/công sức cao nhất toàn báo cáo.
2. Bắt lỗi quota ở `writeProject` và báo cho người dùng thay vì mất dữ liệu âm thầm (mục 2.9).
3. Kiểm tra dung lượng đĩa trống trước khi export (mục 2.4).

**Giai đoạn 1 — Nền móng (1–2 tuần)**
4. Tách `core/` — package TS thuần chứa model + 155 reducer + selector + util (mục 3.3, Lớp 1).
5. Dựng bộ test đơn vị trên `core/` (Vitest). Bắt đầu từ `resolveOverlaps`, `packTrack1`, `pruneEmptyOverlayTracks`, `buildVideoFilterGraph`, `timeline-import`.
6. Chuyển lưu trữ project từ localStorage sang file JSON trên đĩa qua IPC. Gỡ trần hạn mức *và* mở đường cho truy cập từ ngoài cùng lúc.

**Giai đoạn 2 — Render chịu tải (2–4 tuần)**
7. Viết lại trộn audio theo mô hình streaming hoặc đẩy sang `amix` của ffmpeg (mục 2.1).
8. Render theo đoạn + `concat`, thay cho một filtergraph khổng lồ (mục 2.3).
9. Thêm kênh sự kiện IPC + tiến độ export thật + phiên render có `jobId` (mục 2.5).
10. Proxy/optimized media: sinh bản 720p H.264 khi import file mà Chromium không giải mã được (mục 2.6). Giải quyết luôn cả hiệu năng preview.

**Giai đoạn 3 — Mặt tiền cho agent (1–2 tuần sau Giai đoạn 1)**
11. Command Gateway trong main process: giao dịch, dry-run + diff, kênh sự kiện.
12. MCP server mỏng, sinh schema tool từ chữ ký reducer.
13. Bổ sung `observe.scenes`, `observe.silence`, `render.preview`.
14. Chế độ headless (`--headless`) để chạy không cần cửa sổ.

Giai đoạn 3 phụ thuộc Giai đoạn 1 nhưng **không** phụ thuộc Giai đoạn 2 — có thể làm song song nếu mục tiêu trước mắt chỉ là copilot cho project ngắn.

---

## 5. Bảng ưu tiên tổng hợp

| # | Vấn đề | Mức | Công sức | Mục |
|---|---|---|---|---|
| 1 | Không seek trước input, giải mã lại từ đầu | Nghiêm trọng | Thấp | 2.2 |
| 2 | Trộn audio giữ toàn bộ timeline trong RAM | Nghiêm trọng | Cao | 2.1 |
| 3 | Project trong localStorage, mất dữ liệu khi đầy | Cao | Trung bình | 2.9 |
| 4 | Không có kênh sự kiện / tiến độ / phiên render | Cao | Trung bình | 2.5 |
| 5 | Preview không giải mã được định dạng đã import | Cao | Cao | 2.6 |
| 6 | Không có test tự động | Cao | Trung bình | 2.10 |
| 7 | Một input ffmpeg mỗi clip, overlay tuyến tính | Cao | Cao | 2.3 |
| 8 | Reducer khoá trong bundle renderer | Cao (chặn API) | Trung bình | 3.2 |
| 9 | Không có keyframe | Trung bình | Cao | 2.8 |
| 10 | Mask không được xuất, transition suy biến | Trung bình | Trung bình | 2.8 |
| 11 | Pool video preview không giới hạn | Trung bình | Thấp | 2.7 |
| 12 | File trung gian không kiểm soát dung lượng | Trung bình | Thấp | 2.4 |

---

## 6. Giới hạn của báo cáo này

Cần nói rõ để các con số không bị dùng sai:

- **Chưa đo thực nghiệm.** Mọi ngưỡng RAM và ước lượng thời gian là tính toán từ mã (kích thước kiểu dữ liệu × tần số lấy mẫu × thời lượng), không phải kết quả benchmark. Điểm vỡ thực tế phụ thuộc máy, và có thể sớm hơn dự đoán do phân mảnh bộ nhớ.
- **Chưa thử export dài thật.** Kết luận "60 phút sẽ OOM" là suy luận từ `new Float64Array(totalSamples)`, chưa chạy thử. Nên xác nhận bằng một lần export 30 phút có theo dõi RAM trước khi lên kế hoạch lớn.
- **Danh sách codec Chromium** dựa trên hành vi Electron/Chromium nói chung, chưa kiểm chứng trên chính bản build này với từng file mẫu. Nên test bằng một file `.mkv` và một `.mov` ProRes thật.
- **Chưa đánh giá:** bảo mật (`path-validation.ts` có tồn tại nhưng chưa soát kỹ), phụ đề/i18n, đóng gói & cập nhật, khả năng tiếp cận (accessibility).
- Báo cáo đánh giá kiến trúc **ở thời điểm hiện tại của nhánh** `strip-to-video-editor`.
