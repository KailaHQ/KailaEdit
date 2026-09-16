# Kế hoạch tích hợp AI Agent cho KailaEdit

**Ngày:** 2026-09-04 · **Tài liệu nền:** [architecture-assessment.md](./architecture-assessment.md)

Tài liệu này khảo sát cách các editor phổ biến và các dự án mã nguồn mở đang cho AI agent điều khiển việc dựng phim, rút ra các mẫu kiến trúc, rồi đề xuất kế hoạch cụ thể cho KailaEdit.

> **Về nguồn:** phần khảo sát dựa trên tìm kiếm web tháng 9/2026. Con số công cụ của các dự án cộng đồng thay đổi nhanh và các nguồn không thống nhất (fcp-mcp được ghi 88 hoặc 94 tool tuỳ trang) — hãy đọc chúng như *bậc độ lớn*, không phải số liệu chính xác. Tôi chưa cài hay chạy thử bất kỳ MCP server nào trong số này.

---

## 1. Bối cảnh: bốn mẫu kiến trúc đang tồn tại

### Mẫu A — Cầu nối API sống (live scripting bridge)

Agent điều khiển **ứng dụng đang chạy** qua API kịch bản chính thức của nó.

| Sản phẩm | Đường vào | Quy mô |
|---|---|---|
| **DaVinci Resolve** | Scripting API Python chính thức → server MCP cộng đồng | ~34 tool nhóm cao / ~341 method chi tiết: project, timeline, media pool, color, Fusion, playback |
| **Premiere Pro** | UXP (thay CEP, ExtendScript hết hạn 9/2026) → server MCP cộng đồng | Một dự án công bố ~285 tool; UXP phơi bày sequence, marker, effect, transition, **keyframe**, transcript, encoder |

Ưu: quyền lực đầy đủ, thấy được state thật, kết quả hiện ngay trước mắt người dùng. Nhược: đòi app phải mở, bám chặt phiên bản app, khó chạy theo lô, và agent thao tác trực tiếp lên phiên làm việc của người dùng — rủi ro cao.

Đáng chú ý: **các server MCP này đều là của cộng đồng, không phải của Blackmagic hay Adobe.** Nhà sản xuất cung cấp API kịch bản; cộng đồng bọc nó thành MCP.

### Mẫu B — Bàn làm việc trên tài liệu (document workbench)

Agent đọc/ghi **file dự án** ở dạng văn bản, không cần app chạy.

- **fcp-mcp / fcp-mcp-server (Final Cut Pro)** — làm việc trên FCPXML: phân tích timeline, QC (flash frame, gap, trùng lặp), thêm marker hàng loạt, dựng rough cut, import SRT/transcript, xuất EDL/CSV và bàn giao sang Resolve. Thiết kế quanh vòng **export → sửa → reimport**.
- **Một số editor phổ thông** — vì không có API công khai nào (không API, không CLI, không hook kịch bản), cộng đồng phải viết MCP server đọc thẳng **file JSON dự án cục bộ**. Đây là kỹ thuật đảo ngược, dễ vỡ mỗi lần đổi schema.

Ưu: xác định, chạy theo lô được, không đụng vào phiên người dùng, dễ kiểm chứng. Nhược: không có phản hồi trực tiếp, agent làm việc trên mô hình chứ không trên hình ảnh.

### Mẫu C — Engine kết xuất headless

Không có NLE nào cả; agent gọi thẳng các thao tác media.

- **Kinocut** — MCP server + thư viện Python + CLI bọc FFmpeg, 196 tool: cắt/ghép/resize/overlay/phụ đề, xử lý audio (tách stem, chuẩn hoá), phân tích (scene detection, so sánh chất lượng), tái chế nội dung sang Shorts/Reels.
- **ffmpeg-mcp**, **mcp-video-editor**, **VibeVideo MCP** — cùng ý tưởng ở quy mô nhỏ hơn.

Ưu: tự động hoá hoàn toàn, không cần GUI. Nhược: **không có mô hình timeline** — sản phẩm là file đã render, người dùng không mở ra sửa tiếp được. Đây chính là ranh giới KailaEdit không nên rơi vào.

### Mẫu D — Biên tập theo ngữ nghĩa (transcript-first)

Không thao tác trên hình học timeline mà trên **nội dung**.

- **Descript** — "sửa video như sửa văn bản": xoá một câu trong transcript là đoạn video đó biến mất. Trợ lý **Underlord** siết nhịp, bỏ khoảng lặng và từ đệm, thêm caption theo chỉ đạo.
- **OpusClip** — nhận video dài, tự tìm đoạn hấp dẫn nhất, bỏ khoảng chết, reframe dọc cho Reels/TikTok.
- **Các editor hiện đại** — đang thử nghiệm tính năng agent dựng phim ngay trong app; tự động cắt theo lời nói và tách cảnh.

Đây là mẫu *thực sự được người dùng phổ thông dùng*. Nó không cạnh tranh với A/B/C mà nằm **trên** chúng: một lớp ngữ nghĩa sinh ra các thao tác timeline.

### Chuẩn dữ liệu xuyên suốt: OpenTimelineIO

OTIO (Pixar, nay thuộc Academy Software Foundation) đang nổi lên như lớp dữ liệu chung. Định dạng gốc là **JSON**, nghĩa là **LLM đọc và sinh trực tiếp được** — không cần lớp dịch. Nó chuyển đổi hai chiều với FCPXML, AAF, EDL, Resolve, và đã có các lệnh biên tập thử nghiệm (insert, overwrite, roll) — phôi thai của một mô hình dữ liệu NLE headless.

Một phân tích cộng đồng ("Agent-Driven Editing 2026") gọi OTIO là "một EDL hiện đại, lập trình được" và coi nó là mảnh ghép quan trọng nhất của toàn bộ bức tranh.

---

## 2. Hai bài học lớn từ khảo sát

### 2.1 Khoảng trống tri giác — agent không xem được phim

Đây là vấn đề khó nhất mà mọi dự án đều thừa nhận. Dựng phim đòi hỏi *xem* vật liệu ở tốc độ phát để cảm nhận nhịp và sức nặng cảm xúc; như tài liệu Agent-Driven Editing viết: không lượng metadata nào về một cú máy nói cho bạn biết nó *cảm giác* ra sao.

Cách các dự án đang bù đắp:

1. **Công cụ phân tích media làm giác quan thay thế** — Kinocut và fcp-mcp đều có nhóm tool riêng cho việc này: scene detection, blackdetect, đo loudness LUFS, ffprobe, so sánh chất lượng. Agent không "xem" nhưng *đo* được.
2. **Vòng lặp phản hồi đa phương thức** — agent render bản preview độ phân giải thấp, đưa cho một model thị giác phân tích, rồi tự tinh chỉnh. Đây là cách gần nhất với "agent tự kiểm tra công việc của mình".
3. **Phân vai rõ ràng** — agent làm phần cơ học (tổ chức dailies, đồng bộ, rough cut, QC, delivery), con người giữ phần sáng tạo (nhịp, cấu trúc, cảm xúc). Giao diện của người dùng chuyển từ "thao tác timeline" sang "xem kết quả và ra chỉ đạo".

### 2.2 Guardrail là phần thiết kế, không phải phần thêm vào sau

Hai dự án trưởng thành nhất đều dành phần lớn thiết kế cho việc *ngăn* agent làm bậy:

**Kinocut:**
- **Video Receipts** — bản ghi xuất xứ có cấu trúc: hash SHA-256 của input/output từng bước, phiên bản FFmpeg, con trỏ resume, manifest dọn dẹp. Agent *chứng minh* được nó đã tạo ra gì.
- **Quality gates** — kiểm tra trước khi chạy (bounds của filter, tương thích khi merge, âm lượng) và checkpoint trước khi xuất.
- **`video_intent`** — động từ dry-run: lập kế hoạch mà không đụng vào media.
- **Fail closed, không có cờ bypass.** Đầu ra của bộ phân tích một mình không đủ để phê duyệt. Tài liệu nói thẳng: đừng publish video do agent tạo mà chưa qua quality check và mắt người.

**fcp-mcp:**
- Quy trình mặc định: **inspect → prepare → review → phê duyệt bằng hash → commit**. Chữ ký phê duyệt của con người được ràng buộc mật mã vào đúng SHA-256 của bản ứng viên.
- **Điều khiển app sống tắt mặc định**, phải bật riêng bằng biến môi trường — chọn profile "full" vẫn *không* cấp quyền này. Agent xem được state sống nhưng không tự động thao tác.
- Lưu "semantic diff + bằng chứng validate" vào sổ cái bền vững; backup có dấu thời gian UTC trước khi ghi đè.

Bài học: **tách bạch quyền đọc, quyền ghi tài liệu, và quyền điều khiển app sống thành ba mức riêng, mặc định chỉ mở mức thấp nhất.**

---

## 3. KailaEdit đang ở đâu trên bản đồ này

| Yếu tố | Resolve / Premiere | Editor phổ thông | fcp-mcp | Kinocut | **KailaEdit** |
|---|---|---|---|---|---|
| API chính thức của nhà sản xuất | Có | **Không có** | Không (dựa FCPXML) | N/A | **Tự quyết định được** |
| Lớp lệnh sạch, thuần | Phải suy ra từ API ngoại lai | Đảo ngược schema JSON | Thao tác XML | Không có timeline | **Có sẵn 155 reducer thuần** |
| Cùng ngôn ngữ với MCP server | Không (Python bridge) | Không | Không | Có (Python) | **Có (TypeScript, chung repo)** |
| Mô hình timeline sau khi agent làm xong | Còn | Còn | Còn | **Mất** | **Còn** |
| Engine render chịu tải | Có | Có | Dùng FCP | Có | **Chưa** (xem báo cáo nền) |
| Undo tập trung | Có | Có | Backup file | Receipts | **Có, 1 bước/thao tác** |

Ba lợi thế thật sự của KailaEdit:

1. **Không phải đảo ngược gì cả.** Các dự án MCP bên thứ ba phải mò schema JSON của người khác; fcp-mcp phải bám đặc tả FCPXML. KailaEdit sở hữu cả app lẫn định dạng — API tài liệu là *first-party*, không bao giờ vỡ vì bên thứ ba đổi phiên bản.
2. **Lớp lệnh đã tồn tại.** `editor-actions.ts` có 155 reducer thuần `(state, args) => state`, đăng ký tự động qua kiểu. Các dự án khác phải *tổng hợp* lớp này từ một API ngoại lai; ở đây chỉ cần phơi bày.
3. **Đồng nhất ngôn ngữ.** MCP server viết bằng TypeScript, import thẳng type từ `core/`. Schema tool sinh từ chữ ký reducer, không có lớp dịch nào để lệch.

Một bất lợi phải nói thẳng: **engine render chưa chịu được tải** (trần RAM khi trộn audio, không seek trước input — mục 2.1 và 2.2 của báo cáo nền). Mở API cho một engine như vậy chỉ khiến agent gặp lỗi nhanh hơn con người.

---

## 4. Kế hoạch đề xuất

### 4.1 Thế trận: tài liệu làm chính, sống làm phụ, ngữ nghĩa làm giá trị

- **Mẫu B (tài liệu) là trục chính.** Agent làm việc trên project JSON qua `core/`, không cần cửa sổ Electron. Chạy theo lô được, test được, không đụng vào phiên làm việc của người dùng.
- **Mẫu A (sống) là tuỳ chọn, mặc định tắt.** Cho copilot: agent thao tác trên timeline đang mở, người dùng thấy ngay. Bật bằng cờ, theo đúng cách fcp-mcp làm.
- **Mẫu D (ngữ nghĩa) là lớp giá trị.** Cắt theo khoảng lặng, dựng theo transcript, tìm highlight — đây là thứ người dùng thực sự muốn, và nó *sinh ra* các lệnh của mẫu B chứ không thay thế.
- **Không đi theo mẫu C.** Nếu agent chỉ xuất ra file đã render thì KailaEdit thành một wrapper ffmpeg đắt tiền. Giá trị nằm ở chỗ sau khi agent làm xong, người dùng **mở ra sửa tiếp được**.

### 4.2 Kiến trúc mục tiêu

```
┌─ Agent (Claude Code / Codex / Antigravity) ───────────────────┐
└───────────────────────────┬───────────────────────────────────┘
                            │ MCP (stdio)
┌───────────────────────────┴───────────────────────────────────┐
│  kailaedit-mcp   (package TS riêng, mỏng)                     │
│   • Sinh schema tool từ chữ ký reducter trong core/           │
│   • Ba profile quyền: read / edit / live                      │
└───────────────────────────┬───────────────────────────────────┘
                            │
        ┌───────────────────┴────────────────────┐
        │                                        │
┌───────┴──────────────┐              ┌──────────┴──────────────┐
│ Chế độ TÀI LIỆU      │              │ Chế độ SỐNG (opt-in)    │
│ (mặc định, headless) │              │ KOMFY_ENABLE_LIVE=1     │
│ Đọc/ghi project JSON │              │ WebSocket → app đang mở │
│ Không cần app        │              │ Áp lệnh vào store thật  │
└───────┬──────────────┘              └──────────┬──────────────┘
        └───────────────────┬────────────────────┘
┌───────────────────────────┴───────────────────────────────────┐
│  core/  — TypeScript thuần, không React                       │
│   project-model · editor-state · 155 reducer · selectors      │
│   + transaction · dry-run diff · validate                     │
└───────────────────────────┬───────────────────────────────────┘
┌───────────────────────────┴───────────────────────────────────┐
│  render/  — hàng đợi có jobId, tiến độ thật, preview nhanh    │
│  observe/ — scene detect · silence · loudness · frame · peaks │
└───────────────────────────────────────────────────────────────┘
```

`core/` là điều kiện tiên quyết cho mọi thứ — đúng như Giai đoạn 1 của báo cáo nền. Nó không phải công việc riêng cho agent: nó cũng là thứ mở khoá cho unit test và render headless.

### 4.3 Bộ tool và ba mức quyền

**Profile `read` (mặc định, luôn an toàn)**

| Tool | Nền tảng |
|---|---|
| `project.list`, `project.open` | Đọc file project |
| `timeline.describe` | selectors ✅ |
| `timeline.summary` | Bản nén cho ngữ cảnh LLM — cần viết |
| `media.list`, `media.probe` | ffprobe |
| `observe.frame` | `extractVideoFrame` ✅ |
| `observe.audioPeaks` | `getAudioPeaks` ✅ |
| `observe.scenes` | `select=gt(scene,…)` — cần viết |
| `observe.silence` | `silencedetect` — cần viết |
| `observe.loudness` | `ebur128` — cần viết |
| `qc.check` | Gap, flash frame, clip mồ côi, media thiếu — cần viết |

Bốn tool `observe.*` và `qc.check` chính là **giác quan thay thế** ở mục 2.1. Không có chúng, agent dựng phim mù.

**Profile `edit` (ghi tài liệu, trong giao dịch)**

| Tool | Nền tảng |
|---|---|
| `edit.begin` / `edit.diff` / `edit.commit` / `edit.rollback` | Cần viết — gộp thành **một** bước undo |
| `clip.insert` / `split` / `move` / `trim` / `delete` | `insertAssetsToTimeline`, `splitClipsAtTime`, `moveClips`, `resizeClip`, `deleteClips` ✅ |
| `clip.setProperty` | ~20 setter `setClip*` ✅ |
| `effect.add` / `setParam` | `addClipEffect`, `setClipEffectParam` ✅ |
| `text.add`, `subtitle.import` | `addTextClip`, `importSrtCues` ✅ |
| `track.*` | `addTrack`, `deleteTrack`, `toggleTrackLock` ✅ |
| `timeline.importXml` / `exportOtio` | Có import FCPXML ✅; xuất OTIO cần viết |

Cột phải là điểm mấu chốt: **phần lớn mặt ghi đã tồn tại.**

**Profile `live` (điều khiển app đang chạy — mặc định TẮT)**

`live.attach`, `live.applyEdit`, `live.setPlayhead`, `live.getSelection`. Bật bằng biến môi trường riêng, không nằm trong profile `full`, theo đúng mô hình fcp-mcp.

**Render (mọi profile, nhưng có cổng kiểm soát)**

| Tool | Ghi chú |
|---|---|
| `render.preview` | Đoạn ngắn 480p quanh vùng vừa sửa — **vòng phản hồi quan trọng nhất** |
| `render.start` | Trả `jobId` ngay, không chặn |
| `render.status` / `render.cancel` | Phụ thuộc kênh sự kiện IPC (mục 2.5 báo cáo nền) |
| `render.releaseCheckpoint` | Cổng chất lượng trước khi xuất bản chính thức |

### 4.4 Guardrail — sao chép những gì đã được kiểm chứng

1. **Giao dịch có diff.** `edit.begin` → các thao tác → `edit.diff` trả về thay đổi ở dạng ngữ nghĩa ("chèn 3 clip vào V1 tại 00:42, đẩy 5 clip sau đó") → `edit.commit` hoặc `edit.rollback`. Một giao dịch = một bước undo.
2. **Dry-run trước mọi thao tác ghi.** Áp lệnh lên bản sao state, trả diff, không ghi đĩa. Học từ `video_intent` của Kinocut.
3. **Phê duyệt ràng buộc bằng hash** cho autopilot: agent nộp bản ứng viên kèm SHA-256; người duyệt ký vào đúng hash đó. Học từ fcp-mcp.
4. **Receipt cho mỗi lần render:** hash input/output, phiên bản ffmpeg, tham số, thời gian. Học từ Kinocut. Đây cũng là nền cho render tăng dần — biết đoạn nào không đổi thì không render lại.
5. **Backup project trước mỗi commit của agent**, có dấu thời gian.
6. **Fail closed.** Track khoá, media thiếu, clip trỏ vào track không tồn tại → dừng và báo, không "cố gắng đoán". *Chính lỗi ngược lại với nguyên tắc này đã gây ra ba bug trong phiên gỡ lỗi gần đây: media bị vứt đi trong im lặng.*
7. **Không có cờ bypass.** Nếu cần mở một cổng nào đó thì mở bằng cấu hình tường minh, không bằng tham số trong lời gọi tool — nếu không agent sẽ tự học cách dùng nó.

### 4.5 Lớp ngữ nghĩa — nơi giá trị thực sự nằm

Sau khi có `observe.*`, bốn công thức sau viết được gần như hoàn toàn bằng các tool đã có, và chúng là thứ người dùng sẽ thực sự chạy:

| Công thức | Ghép từ |
|---|---|
| **Cắt khoảng lặng** | `observe.silence` → `clip.split` → `clip.delete` → V1 tự dồn trái (đã có) |
| **Dựng thô theo cảnh** | `observe.scenes` → `clip.insert` theo từng cảnh |
| **Dựng theo transcript** | Whisper → `subtitle.import` → cắt theo câu |
| **Tìm highlight → dọc** | `observe.scenes` + `observe.loudness` → chọn đoạn → `clip.setProperty` reframe |

Đây chính là mẫu D. Điểm khác biệt so với Descript/OpusClip: ở KailaEdit, kết quả là **một timeline sửa được**, không phải một file đã render.

### 4.6 Lộ trình

| Mốc | Nội dung | Điều kiện tiên quyết | Kết quả |
|---|---|---|---|
| **M0** | `-ss` seek trước input; bắt lỗi quota localStorage | — | Sửa hai lỗi nền tảng, độc lập |
| **M1** | Tách `core/`; unit test; project lưu ra file JSON | M0 | Logic chạy được trong Node |
| **M2** | MCP server profile `read` + `observe.*` + `qc.check` | M1 | **Agent đọc và phân tích được** — đã hữu ích ngay |
| **M3** | Profile `edit` + giao dịch + dry-run diff | M2 | **Copilot hoạt động** |
| **M4** | Kênh sự kiện IPC; hàng đợi render có jobId; `render.preview` | M2 | Agent tự kiểm tra được kết quả |
| **M5** | Trộn audio streaming; render theo đoạn | M1 | **Chịu được video dài** |
| **M6** | Profile `live`; receipt; phê duyệt bằng hash; headless | M3+M4+M5 | **Autopilot** |
| **M7** | Xuất OTIO; công thức ngữ nghĩa | M3 | Liên thông hệ sinh thái |

**M2 là mốc đáng nhắm trước nhất.** Nó chỉ đọc nên rủi ro gần bằng không, không phụ thuộc việc sửa engine render, mà đã cho phép agent trả lời "video này có bao nhiêu cảnh, chỗ nào im lặng, có lỗi gì" — giá trị thật với công sức nhỏ.

Lưu ý thứ tự: **M5 (render chịu tải) không chặn M3 (copilot)** nhưng **chặn M6 (autopilot)**. Agent tự chạy trên một engine sẽ OOM ở phút thứ 30 là công thức để mất dữ liệu.

---

## 5. Rủi ro và những gì chưa kiểm chứng

- **Chưa chạy thử MCP server nào** trong số các dự án khảo sát. Đánh giá dựa trên tài liệu công khai của chúng, không phải trải nghiệm.
- **Con số tool không nhất quán giữa các nguồn** (fcp-mcp: 88 hay 94; Resolve MCP: 34 hay 341 tuỳ cách đếm). Dùng như bậc độ lớn.
- **Hệ sinh thái MCP cho video biến động rất nhanh.** Phần lớn dự án nêu trên là của cá nhân/nhóm nhỏ, mới vài tháng tuổi. Nên khảo sát lại trước khi khởi động M2.
- **Chi phí OTIO chưa ước lượng.** Ánh xạ mô hình clip của KailaEdit sang OTIO có thể lộ ra những khác biệt ngữ nghĩa (đặc biệt là track V1 nam châm — OTIO không có khái niệm này).
- **Khoảng trống tri giác không biến mất bằng kỹ thuật.** Ngay cả với đủ bộ `observe.*` và vòng lặp preview, agent vẫn không cảm nhận được nhịp phim. Kế hoạch này nhắm vào công việc cơ học của trợ lý dựng — đó là ranh giới mà cả Descript lẫn tài liệu Agent-Driven Editing đều vạch ra, và nên tôn trọng nó thay vì hứa hẹn vượt qua.

---

## 6. Nguồn tham khảo

- [Agent-Driven Editing 2026 — open-source-cinema](https://github.com/12georgiadis/open-source-cinema/blob/master/Agent-Driven-Editing-2026.md)
- [Kinocut — guardrailed video editing MCP server](https://github.com/KyaniteLabs/kinocut)
- [fcp-mcp — Final Cut Pro MCP, 88 tools](https://github.com/dreliq9/fcp-mcp)
- [fcp-mcp-server — FCPXML MCP](https://github.com/DareDev256/fcp-mcp-server)
- [DaVinci Resolve MCP Server](https://mcpservers.org/servers/Tooflex/davinci-resolve-mcp)
- [premiere-pro-mcp](https://github.com/leancoderkavy/premiere-pro-mcp)
- [Premiere Pro UXP API Reference — Adobe](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/)
- [UXP Plugins in Premiere 2026: The CEP Migration Clock — Hyper Brew](https://hyperbrew.co/blog/uxp-plugins-in-premiere-2026/)
- [Descript — AI Video Editing / Underlord](https://www.descript.com/video-editing)
- [Best Video Editing MCP Servers 2026 — Valmera](https://valmera.io/mcp/video-editing-mcp-servers)
- [Best MCP Servers for Video Processing — Fastio](https://fast.io/resources/best-mcp-servers-video-processing/)
