# Báo cáo kiểm chứng Sprint 0–4

**Ngày:** 2026-09-04 · **Người kiểm:** Claude · **Đối tượng:** kết quả agent thực hiện [ai-edit-sprint-plan.md](./ai-edit-sprint-plan.md)

**Kết luận tổng: ĐẠT VỀ KỸ THUẬT, TRƯỢT VỀ QUY TRÌNH.**
Chất lượng mã và test cao hơn tôi dự đoán. Nhưng quy tắc số 1 của kế hoạch — một ticket = một nhánh = một PR — bị bỏ hoàn toàn, và có một lỗi tích hợp thật mà bộ test không thể bắt được.

---

## 1. Số liệu tổng quan

| Hạng mục | Kết quả | Cách kiểm |
|---|---|---|
| `pnpm typecheck` | Sạch, exit 0 | Tự chạy |
| `pnpm test:run` | **143 test / 22 file, xanh**, exit 0 | Tự chạy |
| Test bị skip | **Không có** | `grep -rn "it.skip\|test.skip\|it.todo"` |
| AC agent tự đánh dấu | 98 đạt / 2 để trống | Đếm trong plan |
| Đột biến mã tôi thử | **4/4 đều bị test bắt** | Xem mục 3 |
| Job CI chạy test | Có (`Unit Tests` → `pnpm run test:run`) | `.github/workflows/ci.yml:53,69` |

---

## 2. Kiểm chứng theo ticket

Ký hiệu: **✅** tôi tự xác minh · **⚠️** đạt nhưng có ghi chú · **❌** trượt

### Sprint 0

| Ticket | KL | Bằng chứng tôi thu được |
|---|---|---|
| S0-1 Hạ tầng test | ✅ | Vitest 4.1.11; script `test`/`test:run`; job CI `Unit Tests`; 143 test xanh |
| S0-2 Seek trước input | ⚠️ | `computePreInputSeek()` đúng logic; `-ss` đặt trước `-i` (`video-filter.ts:191`). **Tôi tự chạy A/B bằng ffmpeg thật**: cách cũ vs cách mới cho ra file **giống hệt từng byte** (sha256 `c55256f3…`), cùng 2.00s. Ghi chú bên dưới |
| S0-3 Quota localStorage | ✅ | Có test mock `QuotaExceededError`; đường thành công có test riêng |
| S0-4 Dung lượng đĩa | ✅ | `disk-space-estimate.test.ts` tồn tại và xanh |

**Ghi chú S0-2.** Hai AC bị để trống là về **đo tốc độ**. Tôi xác minh được **tính đúng đắn** (byte-identical, tốt hơn mức "khớp thị giác" mà AC yêu cầu) nhưng **không xác minh được lợi ích tốc độ** — fixture chỉ dài 7 giây nên không có gì để tiết kiệm. Cần một lần đo trên nguồn dài thật (≥ 30 phút, cắt ở phút 20+) trước khi coi mục tiêu của S0-2 là đã đạt.

### Sprint 1

| Ticket | KL | Bằng chứng |
|---|---|---|
| S1-1 Tách `core/` | ✅ | `core/src/editor-actions.ts` = 2676 dòng (nguồn thật); `frontend/views/editor/editor-actions.ts` rút còn **1 dòng** `export * from '@core/editor-actions'`. Cách làm shim này hợp lý — tránh sửa hàng trăm điểm import. `grep` React/DOM/localStorage trong `core/src/` → **rỗng**. Có `pure-node-import.test.ts` |
| S1-2 Test logic thuần | ✅ | 28 test riêng trong `pure-logic-safety.test.ts`, phủ đủ 4 bẫy + prune + resolveOverlaps + split + delete + parser XML. Đột biến bắt được (mục 3) |
| S1-3 Validate chặn commit | ✅ | Nối đúng vào cổng ghi `replaceActiveTimeline` (`editor-actions.ts:598`), có hoãn khi đang trong giao dịch, từ chối trả về `timeline` cũ. **Tôi tự đo: 0.081 ms/lần trên 500 clip** (ngân sách 5 ms) |
| S1-4 ID xác định | ✅ | `core/src/id-generator.ts` + test |
| S1-5 Lưu project ra file | ✅ | `electron/storage/project-file-storage.ts`; `grep localStorage` trong `project-storage.ts` → **rỗng**; có test migration |

### Sprint 2

| Ticket | KL | Bằng chứng |
|---|---|---|
| S2-1 Giao dịch | ✅ | Test khẳng định `undoStack` = 0 giữa chừng và **đúng 1** sau commit |
| S2-2 Edit Patch | ✅ | Schema zod discriminated-union 8 thao tác. **Tôi tự gọi qua MCP**: patch sai → từ chối kèm đường dẫn lỗi cụ thể; patch đúng → trả `diff` ngữ nghĩa: *"xoá 1 clip; V1 rút từ 0:12 còn 0:08 (-4.0s)"* |
| S2-3 Kênh sự kiện IPC | ✅ | `electronEventSchemas` trong hợp đồng zod; preload kiểm tra channel hợp lệ trước khi cho đăng ký |
| S2-4 Tiến độ render thật | ✅ | Chuỗi đầy đủ: `-progress pipe:1` (`ffmpeg-utils.ts:105`) → `out_time_us` → `job.percent` → schema zod → `setExportProgress(Math.round(payload.percent))`. **Số 50 đặt cứng đã biến mất** |

### Sprint 3

| Ticket | KL | Bằng chứng |
|---|---|---|
| S3-1 Bộ phân tích media | ✅ | Fixture **32 KB** (ngân sách 2 MB). Test khẳng định **vị trí khoảng lặng biết trước**: 1.0–3.5 và 4.5–7.0, sai số < 0.1s; cảnh cắt tại 2.0s. Có ca file không audio |
| S3-2 `observe.filmstrip` | ✅ | Tool có mặt, có test |
| S3-3 summary + qc | ✅ | Có test; `qc.check` phát hiện `UNUSUALLY_SHORT_CLIP` (thấy chạy thật trong eval) |
| S3-4 MCP profile `read` | ✅ | **Tôi tự chạy server**: mặc định đúng 11 tool đọc, **không có tool ghi nào**. Log ra stderr, stdout sạch cho JSON-RPC |

### Sprint 4

| Ticket | KL | Bằng chứng |
|---|---|---|
| S4-1 MCP profile `edit` | ✅ | Bật bằng `KOMFYEDIT_MCP_PROFILE=edit`, chặn hai tầng (lọc `tools/list` + kiểm lúc gọi). **Tôi tự kiểm**: `edit.propose` → sha256 file project **không đổi**; `edit.apply` với patchId lạ → từ chối; propose+apply thật → clip bị xoá và **V1 tự dồn trái** (c2: 8s → 4s); apply lần hai bị từ chối (patch dùng một lần) |
| S4-2 `render.preview` | ⚠️ | Tool có mặt, có test. Chưa đo được ngưỡng "10s < 15s" vì không có timeline mẫu đủ dài |
| S4-3 Skill `cut-silence` | ✅ | Ba stub trỏ đúng `../../../docs/skills/cut-silence.md` (tôi kiểm tồn tại file theo từng đường dẫn tương đối). **Skill đã đăng ký thành công** — nó xuất hiện trong danh sách skill của chính phiên này |
| S4-4 Eval | ✅ | `pnpm eval:skills` chạy: **5/5 kịch bản đạt**, có kịch bản **âm tính** (`scenario-5-negative-locked-breach`: validator từ chối sửa track khoá, project trên đĩa nguyên vẹn) |

---

## 3. Kiểm tra test có thật sự bảo vệ không

Đây là bước tôi coi trọng nhất: test luôn xanh dù code sai là test vô dụng. Tôi phá code rồi khôi phục.

| Đột biến | Kết quả |
|---|---|
| `packMainVideoTrack` thành no-op (bẫy 2.3 — V1 nam châm) | **1 test đỏ** ✅ |
| Bỏ định tuyến khỏi track khoá (bẫy 2.2 — thất bại im lặng) | **2 test đỏ** ✅ |
| `validateTimeline` luôn trả hợp lệ (S1-3) | **13 test đỏ** ✅ |
| Xoá `-ss` trước `-i` (S0-2) | **2 test đỏ** ✅ |

4/4 bị bắt. Bộ test này là lưới an toàn thật, không phải trang trí.

---

## 4. Lỗi phát hiện được

### 4.1 — Quy trình: baseline chưa commit, không có nhánh, không có PR · **Nghiêm trọng**

`git log` cho thấy HEAD vẫn là `8b7ea29` — **đúng commit của đầu phiên**. `git status` có **459 file chưa commit**. Không có nhánh nào, không có PR nào.

Hậu quả cụ thể:
- Không xem được diff theo từng ticket → không biết ticket nào đụng vào cái gì.
- Không rollback được một ticket riêng lẻ nếu về sau phát hiện sai.
- AC của S1-1 ("`git log --stat` cho thấy phần lớn là `git mv`") **không thể kiểm chứng**. Tôi phải suy ra bằng cách so kích thước file thay thế.
- Toàn bộ 5 sprint nằm trong một khối không tách được.

Kế hoạch đã ghi rõ ở mục 1 rằng việc commit baseline là **việc đầu tiên, không giao cho agent**. Việc đó không xảy ra, và agent làm tiếp trên cây bẩn.

### 4.2 — MCP không tìm thấy project thật trên Windows · **Cao, lỗi thật**

Hai module phân giải thư mục project theo **hai luật khác nhau**:

| Module | Luật |
|---|---|
| App ghi: `electron/storage/project-file-storage.ts:20` | `app.getPath('userData')/projects` — mà `electron/app-paths.ts:9` ép userData về **`%LOCALAPPDATA%\KailaEdit`** |
| MCP đọc: `packages/kailaedit-mcp/src/project-reader.ts:32-33` | chỉ xét **`%APPDATA%`** (Roaming): `komfyedit/projects`, `KomfyEdit/projects` |

`%LOCALAPPDATA%` **không nằm trong danh sách ứng viên của MCP**. Khi người dùng chạy MCP server từ thư mục bất kỳ (đúng cách dùng thật — agent chạy ở nơi khác), `project.list` sẽ trả về rỗng.

Trong kiểm chứng của tôi nó *có* trả về kết quả, nhưng chỉ vì tôi chạy từ thư mục repo và rơi vào nhánh dự phòng `process.cwd()/.kailaedit-data`. Đó là may mắn, không phải thiết kế.

Test đơn vị không bắt được vì chúng luôn bơm thư mục tuỳ chỉnh vào.

**Sửa:** thêm `%LOCALAPPDATA%\KailaEdit\projects` vào đầu danh sách ứng viên, hoặc tốt hơn — cho cả hai module dùng chung một hàm phân giải đặt trong `core/`.

### 4.3 — `.kailaedit-data/` không được gitignore · **Thấp**

Thư mục chứa project của người dùng đang nằm trong repo, chưa được theo dõi (`?? .kailaedit-data/`) và **không có trong `.gitignore`**. Một lệnh `git add -A` sẽ commit dữ liệu cá nhân vào lịch sử. Hiện đã có sẵn một file project thật trong đó.

### 4.4 — Chưa đo được lợi ích tốc độ của S0-2 · **Cần bổ sung**

Xem ghi chú ở mục 2. Tính đúng đắn đã xác minh; tốc độ thì chưa ai đo, kể cả tôi.

---

## 5. Việc cần làm tiếp

Theo thứ tự:

1. **Commit baseline và tách lịch sử** — dù muộn. Tối thiểu: tách đợt refactor strip-to-editor thành một commit, mỗi sprint một commit. Không có việc này thì mọi kiểm chứng về sau đều mù.
2. **Sửa 4.2** — hợp nhất luật phân giải thư mục project vào một hàm dùng chung, kèm test chạy được trên cả ba nền tảng.
3. **Thêm `.kailaedit-data/` vào `.gitignore`.**
4. **Đo S0-2 trên nguồn dài thật** — quay một video ≥ 30 phút, cắt vài đoạn ở phút 20+, đo thời gian export trước/sau.
5. **Cân nhắc thêm một test tích hợp** cho đường đi mà 4.2 làm lộ ra: MCP đọc được project do app ghi ra, không bơm biến môi trường.

---

## 6. Nhận xét

Phần mã tốt hơn tôi dự đoán ở ba điểm cụ thể: bộ test **thật sự** bảo vệ (4/4 đột biến bị bắt), lớp validate được **nối đúng vào cổng ghi** chứ không nằm chơi một mình, và `edit.propose` **thuần thật** — tôi so hash file trước/sau chứ không tin lời. Cách rút file cũ thành shim `export *` để tránh sửa hàng trăm điểm import cũng là lựa chọn tốt mà kế hoạch không hề gợi ý.

Hai AC bị để trống được để trống **đúng chỗ** và không tô vẽ — đúng quy tắc số 5.

Điểm trượt duy nhất đáng kể là quy trình git, và nó không phải lỗi kỹ thuật mà là hệ quả của việc bước chuẩn bị baseline bị bỏ qua ngay từ đầu.
