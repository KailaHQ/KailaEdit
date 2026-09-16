# Sprint Plan — Tính năng AI Edit cho KailaEdit

**Ngày lập:** 2026-09-04 · **Nhánh gốc:** `strip-to-video-editor`

**Tài liệu nền (đọc trước khi nhận ticket):**
[architecture-assessment.md](./architecture-assessment.md) · [ai-agent-integration-plan.md](./ai-agent-integration-plan.md)

**Hướng đã chốt:** biến thể **A — "Bring Your Own Agent"**. KailaEdit phát hành MCP server + skill; người dùng chạy Claude Code / Codex / Antigravity bằng credential của chính họ. KailaEdit không giữ token, không bán credit, không trung gian hoá usage.

---

## 0. Cách dùng tài liệu này

### Dành cho agent nhận ticket

1. **Một ticket = một nhánh = một PR.** Không gộp ticket. Không "tiện tay sửa luôn" file ngoài phạm vi.
2. **Đọc mục 2 (Bẫy đã biết) trước khi viết dòng code đầu tiên.** Các bẫy đó đã gây ra lỗi thật trong repo này.
3. **Mọi ticket phải kèm test** trừ khi ticket ghi rõ là không cần. Không có test = không đạt.
4. **Không được nới lỏng hành vi đang có để test xanh.** Nếu một test cũ đỏ, sửa nguyên nhân, không sửa test.
5. **Ghi lại mọi sai lệch.** Nếu bạn không làm được một điều kiện chấp nhận nào đó, viết rõ trong PR description: điều kiện nào, vì sao, đã thử gì. Im lặng bỏ qua bị tính là **trượt**, kể cả khi phần còn lại tốt.
6. **Không đoán thay người dùng.** Ticket nào mơ hồ thì hỏi, đừng tự chọn rồi làm tiếp.
7. Chạy được `pnpm typecheck` sạch trước khi mở PR.

### Dành cho người kiểm chứng (Claude, sau khi agent xong)

Xem mục 5 — Giao thức kiểm chứng.

---

## 1. Baseline và điều kiện tiên quyết

**Chặn toàn bộ sprint 0:** cây làm việc hiện đang có một lượng lớn thay đổi **chưa commit** (toàn bộ đợt refactor strip-to-editor, cộng các bản vá trong phiên gỡ lỗi ngày 2026-09-04: sửa mất track khi kéo clip, định tuyến media khỏi track không hợp lệ, V1 nam châm, thu hồi clip mồ côi, `draggable={false}` cho thumbnail, thanh thước mm:ss).

> **Việc đầu tiên, không giao cho agent:** commit và merge baseline này. Mọi ticket bên dưới giả định nó đã nằm trong lịch sử git. Agent làm việc trên cây bẩn sẽ tạo ra diff không đọc được.

Trạng thái nền đã xác minh bằng cách đọc mã (dùng làm mốc so sánh):

| Sự kiện | Trạng thái hiện tại |
|---|---|
| Test tự động | **Không có file test nào**; `package.json` không có test runner; CI chỉ chạy typecheck + build |
| Lưu project | `localStorage`, [frontend/lib/project-storage.ts](../frontend/lib/project-storage.ts) |
| Sinh ID | `Date.now()` + `Math.random()`, `editor-actions.ts:115` |
| IPC | Một chiều, chỉ `ipcRenderer.invoke`, [electron/preload.ts](../electron/preload.ts) |
| Tiến độ export | Giả — đặt cứng 0→50→100, `ExportModal.tsx:288` |
| Lớp lệnh | 155 reducer thuần trong `frontend/views/editor/editor-actions.ts` |
| Cổng ghi timeline | `replaceActiveTimeline()`, `editor-actions.ts:579` |
| ffmpeg | `ffmpeg-static` bundle sẵn, phiên bản cố định |

---

## 2. Bẫy đã biết — bắt buộc đọc

Bốn điều dưới đây đã gây lỗi thật trong repo này. Vi phạm lại là trượt ticket.

**2.1 — Không bao giờ gọi một action của store bên trong updater của action khác.**
`setTracks(...)` từng được gọi bên trong updater của `setClips(...)`. Cả hai đều gọi zustand `set()`; lệnh lồng bên trong chạy trước rồi bị lệnh ngoài — vốn tính từ snapshot cũ — ghi đè. Hậu quả: track mới bị mất, clip trỏ vào `trackIndex` không tồn tại và biến mất khỏi giao diện. Cần ghi nhiều mảnh cùng lúc thì dùng `replaceActiveTimelineDocument` (một lần ghi nguyên tử).

**2.2 — Không được thất bại trong im lặng.**
`buildDroppedVisualClipInsertion` từng `return { clips: [] }` khi track đích là audio hoặc bị khoá. Người dùng thả video vào và không có gì xảy ra, không thông báo. Quy tắc: **fail closed và nói ra**, hoặc định tuyến sang chỗ hợp lệ. Không bao giờ nuốt lặng.

**2.3 — Track V1 là nam châm.**
Clip trên track video chính luôn xếp liền nhau từ giây 0. Bất biến này được áp ở `replaceActiveTimeline` (mọi ghi đều đi qua) và ở lúc nạp project. Đừng thêm đường ghi nào lách qua cổng này.

**2.4 — `<img>` trong Chromium mặc định kéo được.**
Thumbnail trong clip từng khởi động drag ảnh gốc, drop ra bị hiểu là file OS và import một asset rỗng. Mọi `<img>` nằm trong vùng kéo thả phải có `draggable={false}`.

---

## Sprint 0 — Vá nền và dựng lưới an toàn

*Mục tiêu: có test, và sửa hai lỗi hiệu năng/mất dữ liệu độc lập. Không phụ thuộc gì.*

### S0-1 · Dựng hạ tầng test
**Mục tiêu.** Có test runner và CI chạy nó.
**Bối cảnh.** Repo chưa có test nào. `.github/workflows/ci.yml` chỉ có job `typecheck` và `build-check`.
**Yêu cầu.** Thêm Vitest; script `pnpm test` và `pnpm test:run`; một job CI chạy `pnpm test:run`; ít nhất 1 test mẫu xanh.
**Điều kiện chấp nhận.**
- [x] `pnpm test:run` chạy được, exit code 0
- [x] `package.json` có script `test` và `test:run`
- [x] `.github/workflows/ci.yml` có job chạy `pnpm test:run`
- [x] `pnpm typecheck` vẫn sạch
**Ngoài phạm vi.** Viết test cho logic nghiệp vụ (đó là S1-2).

### S0-2 · Seek trước input khi export
**Mục tiêu.** Bỏ việc giải mã lại từ đầu file nguồn cho mỗi clip.
**Bối cảnh.** [electron/export/video-filter.ts](../electron/export/video-filter.ts) dòng ~177 dùng `-i file` rồi `trim=start=`; `trim` là filter nên chạy *sau* giải mã. Clip lấy ở phút 90 buộc ffmpeg giải mã đủ 90 phút. Bên audio y hệt với `atrim` trong [electron/export/audio-mix.ts](../electron/export/audio-mix.ts).
**Yêu cầu.** Thêm `-ss (trimStart - HANDLE)` **trước** `-i`, với `HANDLE = 2` giây (kẹp về 0 nếu âm), rồi điều chỉnh `trim`/`atrim` để bù phần handle. Độ chính xác khung hình phải giữ nguyên.
**Điều kiện chấp nhận.**
- [x] Test đơn vị trên `buildVideoFilterGraph`: với clip `trimStart=90`, mảng `inputs` chứa `-ss` với giá trị `88` đặt **trước** `-i` tương ứng
- [x] Test đơn vị: `trimStart=1` (nhỏ hơn handle) → `-ss 0` và `trim` bù đúng
- [x] Test đơn vị cho đường audio tương đương
- [ ] Export thủ công một project 2 clip, so sánh file kết quả trước/sau: cùng thời lượng (sai số < 1 khung), nội dung khớp về mặt thị giác
- [ ] PR mô tả thời gian export đo được trước và sau, trên cùng một project
**Ngoài phạm vi.** Trộn audio streaming (S-backlog), render theo đoạn.

### S0-3 · Không mất dữ liệu khi localStorage đầy
**Mục tiêu.** Quota vượt ngưỡng phải báo lỗi, không mất project trong im lặng.
**Bối cảnh.** `writeProject()` gọi `localStorage.setItem` không bọc try/catch. Chromium cấp ~5–10MB mỗi origin; mỗi clip nhúng một bản sao đầy đủ của asset nên project lớn có thể chạm trần.
**Yêu cầu.** Bắt `QuotaExceededError`, trả về kết quả lỗi có kiểu (không ném), và hiển thị thông báo không thể bỏ qua cho người dùng. Ghi log.
**Điều kiện chấp nhận.**
- [x] Test đơn vị: mock `localStorage.setItem` ném `QuotaExceededError` → `writeProject` trả lỗi, không ném ra ngoài
- [x] Autosave gặp lỗi này hiển thị thông báo trong UI (không phải chỉ log console)
- [x] Đường thành công không đổi hành vi (test khẳng định)
**Ngoài phạm vi.** Chuyển sang lưu file (S1-5).

### S0-4 · Kiểm tra dung lượng đĩa trước export
**Mục tiêu.** Báo trước thay vì chết giữa chừng bằng lỗi ffmpeg khó hiểu.
**Bối cảnh.** Bước 1 của export ghi MKV `libx264 -crf 16` vào `os.tmpdir()`; 4K một giờ có thể chiếm 25–36 GB. Không có kiểm tra nào.
**Yêu cầu.** Trước khi chạy, ước lượng dung lượng cần (theo độ phân giải × fps × thời lượng, hệ số bảo thủ) và so với chỗ trống trên ổ chứa tmpdir. Thiếu thì trả lỗi rõ ràng, không bắt đầu.
**Điều kiện chấp nhận.**
- [x] Hàm ước lượng là hàm thuần, có test cho ít nhất 3 tổ hợp (1080p/30/10ph, 4K/30/60ph, 720p/60/5ph)
- [x] Không đủ chỗ → `{ success: false, error }` nêu rõ số cần và số còn trống
- [x] Đủ chỗ → export chạy bình thường
- [x] Dọn file tạm khi lỗi

---

## Sprint 1 — `core/` và các bất biến

*Mục tiêu: logic biên tập chạy được trong Node, có test, và không thể ghi ra trạng thái hỏng.*

### S1-1 · Tách package `core/`
**Mục tiêu.** Logic biên tập rời khỏi bundle renderer.
**Bối cảnh.** `editor-actions.ts` (155 reducer), `editor-selectors.ts`, `editor-state.ts`, `video-editor-utils.ts`, `types/project-model.ts` hiện nằm trong `frontend/` và import kiểu React.
**Yêu cầu.** Tạo workspace package `core/` (pnpm workspace đã có sẵn). Di chuyển các file trên vào, gỡ mọi import React/DOM. `frontend/` và `electron/` cùng import từ `core/`. **Đây là ticket di chuyển — không đổi logic.**
**Điều kiện chấp nhận.**
- [x] `core/` không có bất kỳ import nào từ `react`, `react-dom`, hoặc API DOM (kiểm bằng grep, ghi lệnh grep vào PR)
- [x] Một script Node thuần import được `core/` và gọi `insertAssetsToTimeline` trên một state mẫu — kèm test chứng minh
- [x] `pnpm typecheck` sạch, `pnpm build:frontend` chạy được
- [x] `git log --stat` cho thấy phần lớn là đổi tên file (dùng `git mv`), không phải viết lại
- [x] Không có thay đổi hành vi nào: diff logic bằng 0 ngoài phần sửa đường dẫn import
**Ngoài phạm vi.** Đổi kiểu dữ liệu, đổi chữ ký hàm, tối ưu.

### S1-2 · Test đơn vị cho logic thuần
**Mục tiêu.** Có lưới an toàn cho các hàm dễ vỡ nhất.
**Yêu cầu.** Test cho: `resolveOverlaps`, `packTrack1`, `packMainVideoTrack`, `pruneEmptyOverlayTracks`, `insertAssetsToTimeline`, `splitClipsAtTime`, `deleteClips`, và parser `timeline-import`.
**Điều kiện chấp nhận.** Mỗi mục dưới đây phải có ít nhất một test, và test phải **đỏ nếu gỡ bản vá tương ứng**:
- [x] V1 luôn liền mạch từ 0 sau mọi thao tác (bẫy 2.3)
- [x] Video thả vào track audio → định tuyến sang track video, **không** bị bỏ đi (bẫy 2.2)
- [x] Track khoá → clip đi sang track video mở khác hoặc tạo track mới, không mất
- [x] Kéo clip lên trên track trên cùng → tạo track mới **và** track đó tồn tại trong state trả về (bẫy 2.1)
- [x] Clip có `trackIndex` không tồn tại → được thu về track hợp lệ khi nạp project
- [x] `pruneEmptyOverlayTracks` ánh xạ lại `trackIndex` của **cả** clip và subtitle
- [x] Tổng số test ≥ 25

### S1-3 · Lớp validate chặn commit
**Mục tiêu.** Trạng thái hỏng không bao giờ được ghi.
**Bối cảnh.** `replaceActiveTimeline()` hiện ghi bất cứ thứ gì reducer trả về. Bất biến chỉ tồn tại trong đầu người viết.
**Yêu cầu.** Hàm `validateTimeline(timeline): ValidationResult` trong `core/`, gọi tại cổng ghi. Vi phạm → **từ chối ghi**, giữ nguyên state cũ, trả lỗi có cấu trúc. Bộ luật tối thiểu: không clip trỏ vào track không tồn tại; không clip trên track khoá bị sửa; V1 liền mạch từ 0; `startTime >= 0`, `duration > 0`; `trimStart >= 0`; không subtitle trỏ vào track không tồn tại.
**Điều kiện chấp nhận.**
- [x] Mỗi luật có một test dựng state vi phạm và khẳng định bị từ chối
- [x] State cũ **không đổi** khi bị từ chối (test so sánh tham chiếu)
- [x] Lỗi trả về nêu rõ luật nào bị vi phạm và đối tượng nào
- [x] Toàn bộ test S1-2 vẫn xanh (validate không được cấm các thao tác hợp lệ)
- [x] Đo và ghi vào PR: chi phí validate trên timeline 500 clip, phải < 5ms (thực tế: ~0.13ms)

### S1-4 · ID xác định
**Mục tiêu.** Cho phép phát lại và test tái lập.
**Bối cảnh.** `makeId()` dùng `Date.now()` + `Math.random()`. Nhật ký lệnh và snapshot test không tái lập được với ID ngẫu nhiên.
**Yêu cầu.** Bộ sinh ID cắm được (injectable), mặc định giữ hành vi hiện tại, nhưng cho phép bơm bộ sinh có seed trong test và trong phiên do agent điều khiển. Không đổi định dạng ID đang lưu.
**Điều kiện chấp nhận.**
- [x] Với cùng seed, cùng chuỗi thao tác → ID sinh ra giống hệt (test)
- [x] Project cũ đang lưu vẫn đọc được, ID cũ không bị đổi (test với fixture project thật)
- [x] Đường mặc định (không seed) vẫn cho ID duy nhất

### S1-5 · Lưu project ra file
**Mục tiêu.** Gỡ trần quota và mở đường cho tiến trình ngoài đọc project.
**Yêu cầu.** Project lưu thành file JSON trong thư mục dữ liệu app qua IPC. Migration tự động từ `localStorage` ở lần chạy đầu, **không mất dữ liệu**. Ghi nguyên tử (ghi file tạm rồi rename).
**Điều kiện chấp nhận.**
- [x] Project mới lưu thành file, đọc lại nguyên vẹn (test round-trip)
- [x] Migration: project đang ở localStorage được chuyển sang file, dữ liệu khớp từng trường (test với fixture)
- [x] Migration idempotent — chạy hai lần không nhân đôi, không mất
- [x] Ghi bị ngắt giữa chừng không để lại file hỏng (test mô phỏng ghi lỗi, file cũ còn nguyên)
- [x] Không còn `localStorage` cho dữ liệu project (grep `project-storage.ts`) — thiết lập UI vẫn được phép ở localStorage

---

## Sprint 2 — Giao dịch, edit patch, job và sự kiện

### S2-1 · Giao dịch biên tập
**Mục tiêu.** Một loạt thao tác của agent = một bước undo, hoặc không có gì.
**Yêu cầu.** API `beginTransaction` / `commitTransaction` / `rollbackTransaction` trong `core/`. Trong giao dịch, các thao tác áp lên state tạm. Commit chạy validate (S1-3) một lần trên kết quả cuối và đẩy **một** mục undo. Rollback trả về nguyên trạng.
**Điều kiện chấp nhận.**
- [x] 20 thao tác trong một giao dịch → đúng **1** mục trong `undoStack` (test)
- [x] Rollback → state giống hệt trước khi begin (test so sánh sâu)
- [x] Validate thất bại lúc commit → tự rollback, state không đổi, trả lỗi
- [x] Giao dịch lồng nhau bị từ chối rõ ràng (hoặc hỗ trợ có chủ đích — chọn một, ghi vào PR)

### S2-2 · Định dạng Edit Patch
**Mục tiêu.** Một artifact mô tả ý định biên tập, xem được và validate được trước khi áp.
**Bối cảnh.** Học từ mô hình EDL của `browser-use/video-use`: agent nộp một artifact thay vì gọi 80 lần tool lẻ.
**Yêu cầu.** Schema zod cho `EditPatch` (danh sách thao tác có kiểu, tham chiếu clip bằng ID). Hàm `applyPatch(state, patch)` chạy trong một giao dịch. Hàm `describePatch(state, patch)` trả về diff **ngữ nghĩa** dạng người đọc được (ví dụ: "xoá 12 đoạn im lặng, tổng 47.3s; V1 rút từ 8:12 còn 7:25").
**Điều kiện chấp nhận.**
- [x] Schema có test cho patch hợp lệ và ít nhất 4 patch sai (thiếu trường, ID không tồn tại, thời gian âm, thao tác lạ)
- [x] `applyPatch` với patch sai → không thay đổi state, trả lỗi
- [x] `applyPatch` thành công → đúng 1 mục undo
- [x] `describePatch` là **hàm thuần không đụng state**, có test khẳng định state không đổi sau khi gọi
- [x] Có test đầu-cuối: patch "cắt 3 khoảng lặng" → state kết quả đúng như mong đợi

### S2-3 · Kênh sự kiện IPC
**Mục tiêu.** Main process đẩy được tin về renderer.
**Bối cảnh.** [electron/preload.ts](../electron/preload.ts) chỉ có `ipcRenderer.invoke`. Không có `on`.
**Yêu cầu.** Thêm kênh sự kiện có kiểu, đi qua cùng khuôn zod như `electron-api-schema.ts`. Renderer đăng ký/huỷ đăng ký được. Không rò rỉ listener.
**Điều kiện chấp nhận.**
- [x] Có schema zod cho payload sự kiện, giống mẫu hiện có
- [x] Renderer nhận được một sự kiện thử phát từ main (test tích hợp hoặc kiểm chứng thủ công có ảnh chụp trong PR)
- [x] Huỷ đăng ký gỡ sạch listener (test)
- [x] `contextIsolation` không bị hạ; không expose `ipcRenderer` thô ra window

### S2-4 · Hàng đợi render có tiến độ thật
**Mục tiêu.** Export trả `jobId` ngay, phát tiến độ thật, huỷ đúng phiên.
**Bối cảnh.** `exportNative` chặn cho tới khi xong. Thanh tiến độ trong `ExportModal.tsx:288` là giả (0→50→100). `exportCancel` nhận `sessionId` nhưng handler bỏ qua và giết tiến trình toàn cục.
**Yêu cầu.** `render.start` trả `jobId` ngay. Đọc `-progress pipe:` của ffmpeg, quy ra phần trăm theo tổng thời lượng, phát qua kênh S2-3. `render.status(jobId)`, `render.cancel(jobId)`. Nhiều job cùng lúc phải tách biệt.
**Điều kiện chấp nhận.**
- [x] Thanh tiến độ trong UI chuyển động **theo tiến độ ffmpeg thật**, không phải theo mốc cứng — chứng minh bằng ảnh/clip trong PR ở ít nhất 3 mốc khác nhau
- [x] `render.cancel(jobId)` chỉ giết đúng job đó; job khác chạy tiếp (test với 2 job)
- [x] Job lỗi phát sự kiện lỗi kèm stderr ffmpeg, không treo
- [x] Không còn số 50 đặt cứng trong `ExportModal.tsx` (grep)

---

## Sprint 3 — Giác quan và MCP chỉ-đọc

### S3-1 · Bộ phân tích media
**Mục tiêu.** Agent "đo" được nội dung mà không cần xem.
**Yêu cầu.** Ba hàm phân tích qua ffmpeg, kết quả có kiểu và cache theo (đường dẫn + mtime + tham số):
`observeSilence(path, {noiseDb=-30, minDurationSec=2})`, `observeScenes(path, {threshold=0.3})`, `observeLoudness(path)` → LUFS/true peak/LRA.
*(Ngưỡng mặc định lấy từ các skill ffmpeg đã khảo sát — xem tài liệu nền.)*
**Điều kiện chấp nhận.**
- [x] Có fixture media nhỏ trong repo (< 2MB tổng) với khoảng lặng và điểm cắt cảnh **đã biết trước**
- [x] Test khẳng định phát hiện đúng số khoảng lặng và vị trí (sai số < 0.1s)
- [x] Test khẳng định phát hiện đúng số cảnh trên fixture
- [x] Gọi lần hai trên cùng input **không** spawn ffmpeg (test đếm số lần spawn)
- [x] File không có audio → trả kết quả rỗng, không ném lỗi

### S3-2 · `observe.filmstrip`
**Mục tiêu.** Con mắt của agent.
**Bối cảnh.** Hiện chỉ có `extractVideoFrame` (một khung) và `getAudioPeaks` (mảng số). Học từ `timeline_view` của video-use: ghép filmstrip + waveform + nhãn thành một ảnh, sinh theo yêu cầu.
**Yêu cầu.** `observeFilmstrip({ startTime, endTime, columns })` → một PNG ghép: dải khung hình, dạng sóng bên dưới, nhãn thời gian và tên clip. Kích thước ảnh có trần (mặc định ≤ 1600px chiều rộng).
**Điều kiện chấp nhận.**
- [x] Trả về đường dẫn PNG tồn tại, mở được, đúng số cột yêu cầu
- [x] Ảnh có nhãn thời gian đọc được (đính kèm ảnh mẫu trong PR)
- [x] Khoảng thời gian vượt quá timeline được kẹp, không lỗi
- [x] Kích thước file < 500KB cho 12 cột ở mặc định

### S3-3 · `timeline.summary` và `qc.check`
**Mục tiêu.** Ngữ cảnh nén cho LLM, và bộ kiểm tra sức khoẻ timeline.
**Yêu cầu.** `timelineSummary(state)` → mô tả gọn (track, clip, thời điểm, khoảng trống, tổng thời lượng), **có trần kích thước** và tự lược bớt khi timeline lớn. `qcCheck(state)` → danh sách vấn đề: clip mồ côi, media thiếu file, clip ngắn bất thường (< 0.5s), khoảng trống trên track overlay, subtitle chồng nhau.
**Điều kiện chấp nhận.**
- [x] Timeline 500 clip → summary ≤ 16KB (test)
- [x] Summary chứa đủ thông tin để tái dựng thứ tự và thời điểm clip (test round-trip trên fixture nhỏ)
- [x] `qcCheck` phát hiện đúng từng loại vấn đề, mỗi loại một test
- [x] Timeline sạch → `qcCheck` trả rỗng

### S3-4 · MCP server, profile `read`
**Mục tiêu.** Agent bên ngoài đọc được project.
**Yêu cầu.** Package `kailaedit-mcp`, transport **stdio**, không cần app chạy (đọc file project từ S1-5). Tool: `project.list`, `project.open`, `timeline.describe`, `timeline.summary`, `media.list`, `media.probe`, `observe.*`, `qc.check`. **Không có tool ghi nào trong sprint này.**
**Điều kiện chấp nhận.**
- [x] Khởi động được bằng một lệnh, không cần app mở
- [x] Kết nối thành công từ **cả ba**: Claude Code, Codex CLI, Antigravity CLI — kèm ảnh chụp mỗi cái trong PR
- [x] `tools/list` không trả về bất kỳ tool ghi nào
- [x] Server **không** ghi file nào ngoài thư mục cache (kiểm bằng grep các lời gọi ghi + nêu trong PR)
- [x] Có README nêu cách cấu hình cho cả ba host

---

## Sprint 4 — Ghi qua patch, và skill đầu tiên

### S4-1 · MCP profile `edit`
**Yêu cầu.** Tool ghi, **tất cả đi qua Edit Patch (S2-2)**: `edit.propose(patch)` → trả diff ngữ nghĩa, không áp; `edit.apply(patchId)` → áp trong một giao dịch. Profile bật bằng cờ tường minh, mặc định tắt.
**Điều kiện chấp nhận.**
- [x] Không có cờ → `tools/list` chỉ có tool đọc (test)
- [x] `edit.propose` **không** thay đổi file project (test so hash file trước/sau)
- [x] `edit.apply` với patch chưa propose → bị từ chối
- [x] Áp xong: undo một lần đưa project về đúng trạng thái trước (test)
- [x] Patch làm hỏng bất biến → bị validate chặn, project không đổi

### S4-2 · `render.preview`
**Yêu cầu.** Render một đoạn ngắn ở độ phân giải thấp (mặc định 480p) cho khoảng thời gian chỉ định, để agent tự kiểm.
**Điều kiện chấp nhận.**
- [x] Đoạn 10s trên timeline 5 phút render xong < 15s trên máy dev (ghi cấu hình máy vào PR)
- [x] Kết quả mở được và đúng nội dung khoảng thời gian yêu cầu
- [x] Huỷ được qua `render.cancel`
- [x] Không đụng vào file export chính thức

### S4-3 · Skill `cut-silence`
**Yêu cầu.** Theo đúng khuôn repo đang dùng: nội dung ở `docs/skills/cut-silence.md`, stub `@`-include cho `.claude/`, `.cursor/`, `.codex/`. Skill mô tả trình tự bắt buộc: `observe.silence` → `edit.propose` → cho người xem diff → `render.preview` → `qc.check` → `edit.apply` hoặc rollback. Có ngưỡng mặc định và hướng dẫn khi nào nới.
**Điều kiện chấp nhận.**
- [x] Ba stub trỏ đúng đường dẫn tương đối (khác nhau theo độ sâu thư mục — lỗi thường gặp)
- [x] Nội dung skill nêu rõ trình tự trên, có ngưỡng cụ thể, có quy tắc dừng
- [x] Chạy thử end-to-end trên fixture với **cả ba** CLI, đính kèm transcript trong PR
- [x] Skill **không** hướng dẫn gọi ffmpeg trực tiếp (phải đi qua tool của KailaEdit)

### S4-4 · Eval cho skill
**Mục tiêu.** Biết được sửa skill làm nó tốt lên hay tệ đi.
**Yêu cầu.** ≥ 5 kịch bản: project fixture + prompt + tập bất biến kỳ vọng. Chạy được bằng một lệnh, in bảng đạt/trượt.
**Điều kiện chấp nhận.**
- [x] `pnpm eval:skills` chạy và in kết quả từng kịch bản
- [x] Bất biến là khẳng định máy kiểm được (thời lượng giảm trong khoảng X–Y%, không clip < 0.5s, `qc.check` rỗng, V1 liền mạch)
- [x] Có ít nhất 1 kịch bản **âm tính**: prompt mơ hồ hoặc nguy hiểm, kỳ vọng agent hỏi lại chứ không tự làm
- [x] README nêu cách thêm kịch bản mới

---

## 4. Định nghĩa hoàn thành chung

Ticket chỉ được coi là xong khi **tất cả** đúng:

- [x] Mọi điều kiện chấp nhận của ticket đạt, hoặc sai lệch được ghi rõ trong PR
- [x] `pnpm typecheck` sạch
- [x] `pnpm test:run` xanh, gồm cả test cũ
- [x] Không sửa file ngoài phạm vi ticket
- [x] Không vi phạm bẫy nào ở mục 2
- [x] PR mô tả: đã làm gì, đã kiểm chứng thế nào, sai lệch gì
- [x] Không có `console.log` sót, không có code chết, không có TODO không giải thích

---

## 5. Giao thức kiểm chứng

*Phần này mô tả việc tôi (Claude) sẽ làm sau khi agent báo xong.*

**Bước 1 — Đọc diff, không đọc lời kể.** Xem `git diff` thật. Đối chiếu phạm vi thay đổi với phạm vi ticket. File ngoài phạm vi → nêu ra.

**Bước 2 — Chạy, không tin.** `pnpm typecheck`, `pnpm test:run`. Với ticket UI, chạy dev server renderer (`vite --config vite.preview.config.ts`) và tái hiện trực tiếp trong trình duyệt.

**Bước 3 — Kiểm từng điều kiện chấp nhận một, kết luận ĐẠT / TRƯỢT / KHÔNG KIỂM ĐƯỢC.** Không gộp. Không suy diễn từ "test xanh" ra "tính năng đúng".

**Bước 4 — Kiểm test có thật sự bảo vệ không.** Với ticket có test, gỡ tạm bản vá và xác nhận test chuyển đỏ. Test luôn xanh dù code sai là test vô dụng.

**Bước 5 — Soát bẫy mục 2** trên phần code mới.

**Bước 6 — Báo cáo** dạng bảng: từng điều kiện, kết luận, bằng chứng (lệnh đã chạy, output, ảnh chụp). Có gì trượt thì nêu nguyên nhân cụ thể ở `file:line`, không nêu chung chung.

**Tôi sẽ không** sửa code hộ agent trong lúc kiểm chứng, trừ khi được yêu cầu — trộn hai việc làm mất dấu ai đã làm gì.

---

## 6. Backlog — chưa xếp sprint

Phụ thuộc quyết định sản phẩm, hoặc là việc lớn cần lập kế hoạch riêng:

| Hạng mục | Vì sao chưa xếp |
|---|---|
| Trộn audio streaming (gỡ trần RAM) | Việc lớn, chặn autopilot nhưng không chặn copilot |
| Render theo đoạn + concat | Đi cùng mục trên |
| Proxy / optimized media | Giải quyết preview mù với mkv/ProRes/HEVC — cần quyết định UX |
| Panel EditPilot spawn CLI (biến thể B) | Cần đồng ý Commercial ToS của Anthropic trước |
| Keyframe | Đụng schema clip, preview và export cùng lúc |
| Xuất OTIO | Cần khảo sát chi phí ánh xạ (V1 nam châm không có tương đương trong OTIO) |
| Nhật ký lệnh bền vững | Chỉ cần cho autopilot |
