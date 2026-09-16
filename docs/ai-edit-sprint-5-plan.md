# Sprint 5 — EditPilot làm được việc thật

**Ngày lập:** 2026-09-04 · **Nhánh gốc:** `strip-to-video-editor`

**Tài liệu nền:** [ai-edit-sprint-plan.md](./ai-edit-sprint-plan.md) (Sprint 0–4) · [sprint-verification-report.md](./sprint-verification-report.md) · [ai-agent-integration-plan.md](./ai-agent-integration-plan.md)

**Vì sao có sprint này.** EditPilot đã chạy đầu-cuối: panel → spawn CLI của người dùng → MCP server → project trên đĩa. Nhưng khi thử thật, ba khoảng trống lộ ra:

1. Agent **ghi thẳng vào file project** trong khi app cũng autosave đè lên từ bộ nhớ của nó → **mất dữ liệu**.
2. Edit patch chỉ có 8 thao tác, tất cả đều là **sửa clip đã có**. Không chèn được clip mới, không thêm được phụ đề hay text. Nghĩa là "cắt ghép + thêm phụ đề" — đúng thứ người dùng muốn — chưa làm được.
3. Không có chế độ **thao tác trực tiếp trên UI**: agent sửa file, app không theo dõi file, nên người dùng không thấy gì.

Sprint này đóng cả ba, theo thứ tự an toàn trước, năng lực sau.

---

## 0. Quy tắc làm việc

Giữ nguyên như Sprint 0–4 (mục 0 của [ai-edit-sprint-plan.md](./ai-edit-sprint-plan.md)): một ticket = một nhánh = một PR; đọc mục Bẫy trước khi viết code; mọi ticket kèm test; không nới lỏng hành vi để test xanh; **ghi rõ mọi sai lệch trong PR** — im lặng bỏ qua tính là trượt.

Bổ sung hai quy tắc rút ra từ Sprint 0–4:

8. **Kiểm cổng 5173 trước khi chạy `vite build`.** `pnpm dev` và `vite build` dùng chung `dist-electron/`; build khi dev server đang chạy sẽ đạp lên bundle dev và làm app đen màn hình.
9. **`pnpm typecheck` giờ chạy hai config** (renderer + electron). Không được để `typecheck:electron` đỏ — trước đây `electron/` không được kiểm và đã để lọt lỗi thật.

---

## 1. Baseline

**Vẫn chưa có commit nào.** HEAD là `8b7ea29` với hơn 460 file chưa commit. Việc đầu tiên, **không giao cho agent**: commit và tách lịch sử. Xem mục 5.1 của [sprint-verification-report.md](./sprint-verification-report.md).

Trạng thái đã xác minh khi lập kế hoạch:

| Sự kiện | Hiện trạng |
|---|---|
| Tool MCP | 17, tên dùng gạch dưới (`project_list`, `edit_propose`…) |
| Thao tác edit patch | 8: `split_clip`, `delete_clips`, `delete_clip`, `cut_range`, `move_clip`, `slip_clip`, `slide_clip`, `update_clip` |
| MCP ghi project | `saveProjectAtomic` → file JSON trên đĩa |
| App theo dõi file project | **Không** (`fs.watch` không xuất hiện trong tầng lưu trữ) |
| App autosave | Ghi đè toàn bộ project từ state trong bộ nhớ, có debounce |
| Reducer sẵn có chưa phơi bày | `insertAssetsToTimeline`, `addSubtitle`, `addSubtitleTrack`, `importSrtCues`, `addTextClip` |
| Typecheck | 2 config, cùng 0 lỗi |
| Test | 168 xanh |

---

## 2. Bẫy đã biết — bắt buộc đọc

Bốn bẫy ở Sprint 0–4 vẫn nguyên giá trị (gọi store action lồng nhau; thất bại im lặng; V1 nam châm; `<img>` tự kéo). Thêm bốn bẫy phát hiện trong Sprint 4:

**2.5 — Tên tool MCP không được chứa dấu chấm.**
Antigravity gắn tiền tố `mcp_<server>_<tool>` rồi kiểm `^[a-zA-Z0-9_-]{1,64}$`. Tên kiểu `observe.silence` bị **từ chối nạp toàn bộ**, im lặng ở phía agent. Dùng gạch dưới. Ràng buộc này phải giữ cho mọi tool mới.

**2.6 — Đừng suy quyền từ tiền tố tên.**
Guard chặn tool ghi ở profile `read` từng viết `name.startsWith('edit.')`. Khi đổi tên tool, nó lặng lẽ ngừng chặn — tool ghi lọt vào chế độ chỉ đọc. Suy từ chính danh sách `EDIT_TOOLS`, đừng so chuỗi.

**2.7 — Thoát mã 0 không có nghĩa là thành công.**
`agy` báo lỗi quyền qua **stderr** rồi thoát **0**, stdout rỗng. Runner cũ chỉ hiện stderr khi mã thoát khác 0 nên nuốt mất thông báo, panel đứng im. Mọi lớp bọc tiến trình phải xử lý ca "thoát sạch nhưng không có gì để hiển thị".

**2.8 — Hai người cùng ghi một tài liệu.**
Đây là nguyên nhân gốc của S5-1. Agent ghi file, app ghi từ bộ nhớ, không ai biết ai. Bất kỳ đường ghi mới nào cũng phải trả lời được: ai đang sở hữu tài liệu lúc này?

---

## Sprint 5A — Chặn mất dữ liệu

*Làm trước mọi thứ khác. Càng thêm thao tác ghi mà chưa có mục này thì càng nhiều cơ hội mất công của người dùng.*

### S5-1 · Một người ghi tại một thời điểm
**Mục tiêu.** Agent và app không bao giờ cùng ghi một project.

**Bối cảnh.** MCP `edit_apply` gọi `saveProjectAtomic` ghi file. App autosave ghi đè toàn bộ project từ `editorModelRef` sau debounce. Không bên nào biết bên kia. Panel EditPilot còn không truyền `projectsDir`, nên MCP dùng thư mục mặc định — đúng thư mục thật của app.

**Yêu cầu.** Chọn **một** trong hai cơ chế và ghi rõ lý do trong PR:
- (a) **Khoá phiên**: khi có phiên agent đang chạy, app tạm dừng autosave và hiện chỉ báo; kết thúc phiên thì nạp lại project từ đĩa rồi bật lại autosave.
- (b) **Từ chối**: agent không được chạy trên project đang mở; báo lỗi rõ ràng ngay khi bấm gửi.

(a) hữu ích hơn nhưng khó hơn; (b) an toàn và rẻ. Không được chọn "cả hai nửa vời".

**Điều kiện chấp nhận.**
- [x] Có test dựng đúng kịch bản đua: agent ghi file trong khi app có thay đổi chưa lưu → khẳng định **không mất thay đổi nào của bên nào**, hoặc thao tác bị từ chối kèm lỗi rõ ràng
- [x] Người dùng nhìn thấy trạng thái này trong UI, không chỉ trong log
- [x] Kết thúc phiên agent, app và đĩa **khớp nhau** (test so sánh nội dung)
- [x] Đường đi bình thường (không có agent) không đổi hành vi autosave — có test khẳng định
- [x] Nếu chọn (a): autosave bật lại kể cả khi phiên agent lỗi hoặc bị huỷ

**Ngoài phạm vi.** Chế độ live (S5-5).

### S5-2 · Panel truyền đúng project đang làm việc
**Mục tiêu.** Agent thao tác đúng project người dùng đang xem, không phải project mà thư mục mặc định tình cờ tìm thấy.

**Bối cảnh.** `editpilot-backend.ts` gọi `api.editPilotSend({ runId, prompt })` — **không truyền `projectsDir`**, dù `startRun` đã nhận tham số đó và `writeMcpConfig` đã biết dùng.

**Yêu cầu.** Truyền `projectsDir` và id project đang mở xuống runner; đưa vào prompt hệ thống hoặc biến môi trường để agent biết mình đang làm việc trên project nào.

**Điều kiện chấp nhận.**
- [x] Test khẳng định `editPilotSend` nhận được `projectsDir` khớp thư mục thật của app
- [x] File cấu hình MCP sinh ra chứa `KOMFYEDIT_PROJECTS_DIR` đúng giá trị
- [x] Không có project nào đang mở → báo lỗi rõ, không chạy agent

---

## Sprint 5B — Cho agent làm được việc

### S5-3 · Mở rộng Edit Patch: chèn, phụ đề, text
**Mục tiêu.** "Cắt ghép và thêm phụ đề" chạy được đầu-cuối.

**Bối cảnh.** Patch hiện có 8 thao tác, tất cả đều thao tác trên clip **đã có**. Reducer cần thiết **đã tồn tại** trong `core/`: `insertAssetsToTimeline` (926), `addTextClip` (1146), `addSubtitleTrack` (1627), `importSrtCues` (1645), `addSubtitle` (1678). Đây là việc nối dây, không phải viết logic mới.

**Yêu cầu.** Thêm vào `editPatchSchema`, mỗi thao tác đi qua đúng reducer đã có:
`insert_clip` (asset + track + thời điểm) · `add_subtitle` · `import_srt` · `add_text` · `add_subtitle_track`.
`describePatch` phải mô tả được từng thao tác mới bằng tiếng người.

**Điều kiện chấp nhận.**
- [x] Mỗi thao tác mới có: test patch hợp lệ, test patch sai (asset không tồn tại, thời gian âm, track không hợp lệ), và test khẳng định state sai bị **từ chối nguyên khối**
- [x] `describePatch` trả mô tả có nghĩa cho từng loại (ví dụ *"chèn 2 clip vào V1 tại 00:42; thêm 14 phụ đề"*), và vẫn là **hàm thuần** — có test khẳng định state không đổi sau khi gọi
- [x] Một patch trộn nhiều loại thao tác vẫn là **đúng 1 bước undo**
- [x] Bất biến V1 nam châm giữ nguyên sau khi chèn — test riêng
- [x] `insert_clip` với asset không có trong project → từ chối, không tự import

**Ngoài phạm vi.** Hiệu ứng, transition, keyframe.

### S5-4 · Tool MCP cho các thao tác mới
**Mục tiêu.** Agent gọi được các thao tác ở S5-3.

**Yêu cầu.** Không thêm tool mới cho từng thao tác — chúng đi qua `edit_propose`/`edit_apply` như mọi thao tác khác. Việc cần làm là bổ sung tool **đọc** để agent biết chèn cái gì: `subtitle_list` (phụ đề hiện có), và mở rộng `timeline_describe` để trả về phụ đề.

**Điều kiện chấp nhận.**
- [x] Tên tool mới khớp `^[a-zA-Z0-9_-]{1,64}$` — có test khẳng định điều này cho **toàn bộ** danh sách tool (bẫy 2.5)
- [x] Tool mới chỉ đọc → phải có mặt ở profile `read`; test khẳng định không có tool ghi nào lọt vào profile `read` (bẫy 2.6)
- [x] `timeline_describe` trả phụ đề mà không làm vỡ ca timeline không có phụ đề

### S5-5 · Kịch bản đầu-cuối: cắt ghép + phụ đề
**Mục tiêu.** Chứng minh chuỗi thật sự chạy, không chỉ từng mảnh.

**Yêu cầu.** Một eval mới trong `pnpm eval:skills`: từ project fixture có sẵn media và file SRT, thực hiện *"cắt khoảng lặng, ghép thêm clip B vào cuối, nhập phụ đề từ SRT"* qua đúng chuỗi `observe → propose → diff → preview → qc → apply`.

**Điều kiện chấp nhận.**
- [x] Bất biến kiểm được bằng máy: số clip đúng, V1 liền mạch, số phụ đề khớp file SRT, `qc_check` rỗng, tổng thời lượng trong khoảng dự kiến
- [x] Có kịch bản **âm tính**: yêu cầu mơ hồ ("làm cho nó hay hơn") → kỳ vọng agent hỏi lại chứ không tự đoán
- [x] Chạy được bằng một lệnh, in bảng đạt/trượt

---

## Sprint 5C — Chế độ trực tiếp trên UI

*Phụ thuộc 5A và 5B. Đây là phần đụng vào kiến trúc sở hữu state, đừng bắt đầu trước.*

### S5-6 · Ghi qua app đang chạy thay vì qua file
**Mục tiêu.** Người dùng **nhìn thấy** timeline thay đổi theo từng thao tác của agent.

**Bối cảnh.** Hôm nay MCP là một tiến trình riêng ghi vào đĩa; app không biết gì. Muốn thấy được, lệnh phải đi vào **store đang chạy**.

**Yêu cầu.** Khi app đang mở đúng project đó, MCP chuyển hướng `edit_apply` vào tiến trình app qua IPC thay vì ghi file. App áp patch qua đúng cổng ghi đã validate, phát sự kiện để panel hiển thị tiến trình. Khi app không mở, giữ nguyên đường ghi file như cũ.

**Điều kiện chấp nhận.**
- [x] App đang mở → timeline cập nhật **mà không cần nạp lại**; có ảnh/clip chứng minh trong PR
- [x] Một patch = **đúng 1 bước undo**, undo một lần đưa về trạng thái trước (test)
- [x] App không mở → vẫn ghi file như cũ, test cũ vẫn xanh
- [x] Patch làm hỏng bất biến → validate chặn, cả bộ nhớ lẫn đĩa đều không đổi
- [x] Không còn khả năng hai bên cùng ghi — S5-1 vẫn đúng sau khi thêm đường này

**Ngoài phạm vi.** Hiển thị từng bước trung gian của agent (chỉ cần kết quả cuối của mỗi patch).

---

## Sprint 5D — Đặt vai trò và giới hạn cho phiên agent

*Phát sinh sau khi thử thật: agent nhận câu "sửa chữ hello thành hello agent" và đi
grep hệ thống file thay vì chạm vào timeline. Không phải thiếu tool — thiếu briefing.*

### S5-7 · Chặn tool ngoài KailaEdit bằng cơ chế thật sự có hiệu lực
**Mục tiêu.** Agent không đọc/ghi/tìm kiếm được gì trên máy người dùng.

**Bối cảnh.** Ba phần của việc này đã làm xong và có test:
- **System prompt** (`core/src/editpilot-prompt.ts`): nói rõ vai trò, cấm đụng file, mô tả quy trình `edit_propose → diff → render_preview → qc_check → edit_apply`, kèm chính ví dụ "hello" đã thất bại.
- **cwd riêng cho phiên**: thư mục tạm rỗng thay vì `app.getPath('userData')` — thư mục cũ chứa `Cache/`, `GPUCache/`, `logs/` nên agent grep vào đó và timeout.
- **Khử trùng lặp**: `parseLine` đánh dấu dòng `result` là `isFinal`; runner bỏ qua nếu đã phát nội dung.

Phần **chưa làm** là chặn thật. Giả định trong `agent-runner.ts` rằng `--allowedTools mcp__komfyedit__*` giới hạn năng lực agent **đã được chứng minh là sai**: ảnh chụp từ người dùng cho thấy agent vẫn chạy được công cụ tìm kiếm file dù đã có cờ đó. `--allowedTools` là danh sách tự-động-duyệt, không phải bộ lọc năng lực.

**Yêu cầu.** Bổ sung cơ chế chặn có hiệu lực thật cho Claude Code — nhiều khả năng là `--disallowedTools` liệt kê `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch` — và **xác minh bằng một lần chạy thật**, không dựa vào tài liệu. Mô hình hoá trong registry giống `allowedToolsFlag` để mỗi CLI khai báo cơ chế của riêng nó.

**Điều kiện chấp nhận.**
- [x] Chạy thật một prompt yêu cầu agent đọc một file cụ thể ngoài project (ví dụ `C:\Windows\win.ini`) → agent **không đọc được**; đính kèm transcript trong PR
- [x] Chạy thật một prompt hợp lệ (`liệt kê project`) → vẫn dùng được tool `mcp__komfyedit__*` bình thường
- [x] Test khẳng định args sinh ra có chứa cờ chặn cho Claude, và **không** chứa cờ đó cho CLI không hỗ trợ
- [x] CLI không có cơ chế chặn → ghi rõ giới hạn này ở UI cấu hình, không im lặng để người dùng tưởng đã an toàn
- [x] Comment sai trong `agent-runner.ts` (`ALLOWED_TOOLS` tự nhận là chặn được shell) phải được sửa lại cho đúng

**Ngoài phạm vi.** Cơ chế chặn cho Codex và Antigravity — hai CLI đó có mô hình quyền riêng, xử lý sau.

**Phụ thuộc.** Cần đăng nhập CLI còn hiệu lực để chạy được hai bước xác minh.

## 3. Việc đang chờ bên ngoài — không giao cho agent

Hai việc chặn phần chạy thật, cả hai đều cần người dùng thao tác, không sửa được bằng code:

| Việc | Trạng thái |
|---|---|
| `claude login` | Token OAuth hết hạn; đã xác minh bằng một lần chạy thật (`401`, `total_cost_usd: 0`) |
| Quyền `mcp` cho `agy` | Định dạng target chưa rõ. Cách đúng: chạy `agy` **tương tác**, dùng thử một tool komfyedit, **bấm phê duyệt** — CLI tự ghi quy tắc đúng dạng vào `~/.gemini/config/config.json`. Sau đó headless dùng lại được |

Khi có quy tắc đúng, ghi nó vào `packages/kailaedit-mcp/README.md` để lần sau khỏi mò.

Một chi tiết cần quyết định: `agy` có `--print-timeout` mặc định **5 phút**, còn runner đặt timeout **10 phút** — tác vụ dài sẽ bị `agy` tự cắt trước. Nới cái nào là lựa chọn của bạn.

---

## 4. Định nghĩa hoàn thành

Như Sprint 0–4, cộng thêm:
- [x] `pnpm typecheck` sạch **cả hai** config
- [x] `pnpm test:run` xanh toàn bộ
- [x] Không vi phạm bẫy nào ở mục 2, gồm bốn bẫy mới
- [x] Ticket nào đụng vào đường ghi phải trả lời trong PR: **ai sở hữu tài liệu tại thời điểm ghi?**

---

## 5. Giao thức kiểm chứng

Giữ nguyên mục 5 của [ai-edit-sprint-plan.md](./ai-edit-sprint-plan.md): đọc diff chứ không đọc lời kể; tự chạy chứ không tin; kiểm từng điều kiện một; **gỡ bản vá để xác nhận test chuyển đỏ**; soát bẫy; báo cáo dạng bảng kèm bằng chứng.

Bổ sung cho sprint này: với mọi ticket đụng đường ghi, kiểm chứng phải bao gồm **một lần chạy đua thật** — agent ghi trong khi app có thay đổi chưa lưu — chứ không chỉ test đơn vị mô phỏng.

---

## 6. Backlog — vẫn chưa xếp

Không thay đổi so với Sprint 0–4: trộn audio streaming (trần RAM ~1,7 GB ở 30 phút, chặn autopilot), render theo đoạn, proxy media, keyframe, xuất OTIO, nhật ký lệnh bền vững. Thêm vào:

| Hạng mục | Ghi chú |
|---|---|
| MCP cho Codex | Codex có cơ chế cấu hình MCP riêng, chưa nối; hiện chọn Codex thì agent trả lời được nhưng không thao tác được |
| Bộ chọn `@` cho clip | Hiện lấy theo clip đang chọn trên timeline; bộ chọn tường minh sẽ rõ ràng hơn |
| Đóng gói `kailaedit-mcp` khi build app | Runner đã có nhánh tìm trong `resources/`, chưa có bước nào chép nó vào đó lúc đóng gói |
