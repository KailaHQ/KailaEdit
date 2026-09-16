# Sprint Plan — Tính năng Filters cho KailaEdit

**Ngày lập:** 2026-09-06 · **Nhánh gốc:** `strip-to-video-editor`

**Tham chiếu UI:** tab Filters — sidebar danh mục, ô tìm kiếm, lưới thumbnail có ảnh mẫu thật, Favorites.

**Tài liệu nền:** [architecture-assessment.md](./architecture-assessment.md) · [skills/video-editor-development.md](./skills/video-editor-development.md)

---

## 0. Cách dùng tài liệu này

### Dành cho agent nhận ticket

1. **Một ticket = một nhánh = một PR.** Không gộp ticket, không "tiện tay sửa luôn" file ngoài phạm vi.
2. **Đọc mục 2 (Bẫy đã biết) trước khi viết dòng code đầu tiên.** Mọi bẫy trong đó đều đã gây lỗi thật trong repo này.
3. **Mọi ticket phải kèm test**, trừ ticket ghi rõ không cần. Không test = không đạt.
4. **Không nới lỏng hành vi đang có để test xanh.** Test cũ đỏ thì sửa nguyên nhân, không sửa test — trừ khi ticket nói rõ hành vi đó đang được thay đổi có chủ đích.
5. **Ghi lại mọi sai lệch** trong PR description: điều kiện nào không đạt, vì sao, đã thử gì. Im lặng bỏ qua tính là **trượt**.
6. `pnpm typecheck` phải sạch (cả `typecheck:renderer` và `typecheck:electron`) trước khi mở PR.
7. `npx vitest run core electron shared frontend` phải xanh. Nếu repo có worktree phụ trong `.claude/worktrees/`, bỏ qua lỗi phát sinh từ đó — chúng không thuộc phạm vi.

### Quyết định đã chốt (2026-09-06)

| # | Quyết định | Hệ quả |
|---|---|---|
| Q1 | Filter là **file LUT `.cube`**, không phải chuỗi ffmpeg viết tay | Preview và export dùng chung một nguồn sự thật; thêm filter mới không phải viết tay hai công thức |
| Q2 | Preview **chuyển sang WebGL** | CSS `filter` không áp được LUT 3D. Sprint F0 là điều kiện tiên quyết của mọi sprint sau |
| Q3 | Filter phải **điều khiển được qua MCP** cho autopilot/EditPilot | Registry và mọi logic màu phải nằm trong `core/`; thêm Sprint F4. Xem mục 3 |

### Ba mặt tiêu thụ — không được quên mặt nào

Tính năng này có **ba** đối tượng sử dụng, không phải một. Mỗi ticket phải nói rõ nó phục vụ mặt nào:

| Mặt | Đường render | Ai dùng |
|---|---|---|
| Preview | WebGL trong `frontend/` | Người dùng, khi đang dựng |
| Export | `lut3d` của ffmpeg trong `electron/` | Người dùng, khi xuất file |
| **Autopilot** | `render_preview` (ffmpeg) + mô tả text qua MCP | Agent, khi tự động grade |

Agent **không nhìn thấy WebGL preview**. Nó nhìn timeline qua `timeline_describe` và nhìn hình qua `render_preview` — tức là qua ffmpeg. Nếu preview và export lệch nhau thì agent và người dùng đang làm việc trên hai sự thật khác nhau, và mọi quyết định màu của autopilot đều sai từ gốc. Đây là lý do thứ hai, độc lập, khiến **Sprint F0 không thể bỏ**.

---

## 1. Hiện trạng (đã đọc mã, dùng làm mốc so sánh)

Tính năng filter **đã tồn tại một nửa**. Không được viết lại từ đầu — phải mở rộng cái đang có.

| Thành phần | File | Trạng thái |
|---|---|---|
| Danh sách filter | [`core/src/project-model.ts:22`](../core/src/project-model.ts) `effectTypeValues` | 7 preset màu: `lut-cinematic`, `lut-vintage`, `lut-bw`, `lut-cool`, `lut-warm`, `lut-muted`, `lut-vivid` |
| Metadata | [`core/src/project.ts`](../core/src/project.ts) `EFFECT_DEFINITIONS` | Mỗi filter có `name`, `category: 'color-preset'`, `icon`, `defaultParams: { intensity: 100 }` |
| Lưu trên clip | [`core/src/project-model.ts:345`](../core/src/project-model.ts) | `clip.effects?: ClipEffect[]`, mỗi phần tử `{ id, type, enabled, params, mask? }` |
| Thư viện UI | [`frontend/views/editor/EditorLibraryPanel.tsx:105`](../frontend/views/editor/EditorLibraryPanel.tsx) `EffectLibrary` | Tab `filters` lọc `category === 'color-preset'`. Thumbnail là **gradient CSS** hardcoded trong `SWATCH` |
| Áp filter | [`core/src/editor-actions.ts:2383`](../core/src/editor-actions.ts) `addClipEffect` | Click áp cho mọi clip đang chọn; kéo-thả đặt `dataTransfer('effectType')`, nhận ở [`TimelineClipItem.tsx`](../frontend/views/editor/timeline/TimelineClipItem.tsx) |
| Sửa/xoá | [`frontend/views/editor/ClipPropertiesPanel.tsx:899`](../frontend/views/editor/ClipPropertiesPanel.tsx) | Slider theo `paramRanges`, bật/tắt, xoá |
| Preview | [`core/src/video-editor-utils.ts:361`](../core/src/video-editor-utils.ts) `getClipEffectStyles` | Sinh chuỗi CSS `filter` — **xấp xỉ thủ công** |
| Export | [`electron/export/effects-filter.ts`](../electron/export/effects-filter.ts) `buildClipEffectChain` | Sinh chuỗi ffmpeg `curves`/`colorbalance`/`eq` — **xấp xỉ thủ công khác** |
| Render preview | [`frontend/views/editor/ProgramMonitor.tsx`](../frontend/views/editor/ProgramMonitor.tsx) | `<video>` / `<img>` + CSS filter. Canvas 2D chỉ dùng để vẽ hạt nhiễu (`grain`) |

### Khoảng cách tính năng

| Kỳ vọng tiêu chuẩn | KailaEdit hiện tại |
|---|---|
| Hàng trăm filter, có danh mục (Featured, NEW, Hits, CCD, Life, Portrait, Retro, Night, Food…) | 7 filter, không danh mục |
| Ô tìm kiếm | Không |
| Favorites | Không |
| Thumbnail là ảnh mẫu thật đã áp filter | Gradient CSS |
| Hover để xem trước trên frame hiện tại | Không |
| Slider cường độ ngay trong thư viện | Chỉ có trong panel thuộc tính, sau khi đã áp |
| Áp cho toàn bộ clip / "Apply to all" | Chỉ áp cho clip đang chọn |

### Sai lệch preview ↔ export (vấn đề nghiêm trọng nhất)

Hai công thức được viết tay độc lập, nên **cùng một filter cho ra hai kết quả khác nhau**. Ví dụ `lut-bw` với `intensity = 100`:

- Preview: `getClipEffectStyles` → chuỗi CSS
- Export: `effects-filter.ts:48` → `hue=s=0`

Không có test nào so sánh hai bên. Người dùng chỉnh màu theo preview rồi export ra khác — đây chính là loại lỗi đã xảy ra với transitions trong repo này. **Sprint F0 tồn tại để đóng vĩnh viễn khoảng cách đó**, và mọi filter mới phải đi qua nó.

### Hiện trạng bề mặt MCP (cho autopilot)

Bề mặt agent đọc/ghi timeline nằm ở [`packages/kailaedit-mcp/src/server.ts`](../packages/kailaedit-mcp/src/server.ts) và [`core/src/edit-patch.ts`](../core/src/edit-patch.ts). **Không có gì cho màu sắc cả:**

| Bề mặt | Có gì hôm nay | Thiếu cho filter |
|---|---|---|
| `editPatchOperationSchema` | 14 op: `split_clip`, `cut_range`, `move_clip`, `update_clip`, `insert_clip`, `set_transition`, `add_text`, `import_srt`… | Không op nào áp/gỡ filter hay chỉnh màu |
| `timeline_describe` | Mô tả clip, track, transition, audio | Không nhắc filter đang áp → agent không biết clip đã grade hay chưa |
| `timelineSummary` (`core/src/timeline-summary.ts`) | Tóm tắt cho agent | Như trên |
| `qc_check` (`core/src/qc-check.ts`) | `ORPHAN_CLIP`, `MISSING_MEDIA`, clip quá ngắn… | Không phát hiện filter trỏ vào id không tồn tại hay LUT mất file |
| `media_list` / `observe_*` | Liệt kê media, dò silence/scene/loudness/filmstrip | Không có cách nào để agent biết **có những filter nào** để chọn |
| `render_preview` | Render đoạn bằng ffmpeg cho agent xem | Sẽ tự động đúng nếu F0-3 xong, nhưng cần test riêng |

`update_clip` nhận `patch: z.record(z.string(), z.unknown())` nên **về lý thuyết** agent có thể nhét `filter` vào đó. Không được dựa vào điều này: patch không kiểm kiểu, agent sẽ đặt id sai và hỏng âm thầm. Filter cần op riêng, có schema.

---

## 2. Bẫy đã biết trong repo này

Đọc hết trước khi code.

1. **`core/` phải thuần.** Không import React, không chạm DOM, không `window`. Có test canh: `core/tests/pure-node-import.test.ts`. Code WebGL thuộc `frontend/`, còn phần đọc/nội suy LUT thuần số học thì thuộc `core/`.

2. **Đừng subscribe `currentTime` ở gần danh sách clip.** Timeline cố tình không re-render theo playhead; `ProgramMonitor` đọc thời gian qua ref. Một `useEditorStore(selectCurrentTime)` đặt sai chỗ là đủ làm giật toàn bộ timeline. Xem [`skills/video-editor-development.md`](./skills/video-editor-development.md).

3. **Preview và export phải chung một nguồn sự thật.** Không được "sinh gần đúng" ở hai nơi. Nếu buộc phải xấp xỉ, phải có test parity đo được sai số và một hằng số ngưỡng ghi rõ lý do.

4. **i18n có hai file.** Mọi chuỗi hiển thị phải thêm vào **cả** `frontend/i18n/locales/en.ts` và `vi.ts`. Không hardcode tiếng Anh trong JSX.

5. **Zod schema là hợp đồng lưu file.** Thêm trường mới vào `project-model.ts` phải `.optional()` hoặc `.default()`, nếu không project cũ sẽ không mở được. Có project thật trên đĩa (`.kailaedit-data/projects/`) để kiểm chứng.

6. **Effect có `mask`.** `getClipEffectStyles` bỏ qua effect có `mask.enabled` (chúng được vẽ như overlay riêng, xem `getMaskedEffectOverlays`). Filter mới phải quyết định rõ có hỗ trợ mask không — mặc định là **không**, và phải viết ra trong PR.

7. **Đừng tin `npx vitest run` không tham số.** Nó quét cả `.claude/worktrees/`. Chạy `npx vitest run core electron shared frontend`.

8. **MCP server chạy Node thuần, không Electron, không DOM.** Nó import trực tiếp từ `core/`. Bất cứ thứ gì autopilot cần — registry filter, tra id, validate — phải nằm trong `core/` và không được chạm `app.getPath()`. Đường dẫn LUT cho MCP giải qua `projectsDirCandidates()` trong [`core/src/app-paths.ts`](../core/src/app-paths.ts), giống cách MCP đã tìm thư mục project.

9. **Asset dùng đường dẫn thật trên đĩa.** File LUT đóng gói theo app phải chạy được cả trong dev lẫn khi đã đóng gói asar — xem cách `findFfmpegPath()` xử lý `app.asar.unpacked` trong [`electron/export/ffmpeg-utils.ts`](../electron/export/ffmpeg-utils.ts). Đây là bẫy đã cắn một lần rồi.

---

## 3. Thứ tự thực hiện

```
F0 (LUT + WebGL + parity)  ──┬──>  F1 (registry, migration, thumbnail)
                             │
                             └──>  [chặn tất cả]
                                        │
                        ┌───────────────┼───────────────┐
                        ▼               ▼               ▼
                  F2 (thư viện UI)  F3 (áp dụng)   F4 (MCP/autopilot)
                        └───────────────┼───────────────┘
                                        ▼
                                  F5 (hiệu năng, QC, tài liệu)
```

F2, F3, F4 độc lập với nhau và chạy song song được — F4 không đi qua UI. F3-2 (adjustment layer) cần F3-1 xong trước.

---

## Sprint F0 — Một nguồn sự thật cho màu

**Mục tiêu:** một filter được định nghĩa **một lần** bằng file LUT, và cả preview lẫn export đều đọc chính file đó.

**Không có sprint nào sau đây được bắt đầu trước khi F0 xong.** Xây thư viện 100 filter trên nền hai công thức lệch nhau là nhân bản lỗi lên 100 lần.

### F0-1 · Định dạng LUT và loader thuần

**Phạm vi:** `core/src/lut.ts` (mới), `core/tests/lut.test.ts` (mới)

- Parser `.cube` (Adobe Cube LUT): đọc `LUT_3D_SIZE`, `DOMAIN_MIN/MAX`, bảng dữ liệu. Chỉ cần 3D LUT; 1D là tuỳ chọn.
- Trả về `{ size: number; data: Float32Array }` — RGB phẳng, `size³ * 3` phần tử.
- `applyLutToRgb(lut, r, g, b, intensity)`: nội suy tam tuyến tính, trộn tuyến tính với màu gốc theo `intensity` (0..1). Đây là hàm dùng chung cho test parity và cho thumbnail.
- Từ chối file hỏng bằng lỗi có thông điệp rõ ràng, không throw thô.

**Điều kiện chấp nhận**
- Parse được một file `.cube` size 33 thật.
- LUT identity (đầu vào = đầu ra) trả lại đúng màu gốc, sai số < 1/255.
- `intensity = 0` trả lại **chính xác** màu gốc.
- File thiếu `LUT_3D_SIZE`, số lượng dòng sai, hoặc giá trị ngoài `[0,1]` → lỗi mô tả được vấn đề.
- Không import gì ngoài chuẩn ES — `core/tests/pure-node-import.test.ts` vẫn xanh.

### F0-2 · Preview áp LUT bằng WebGL

**Phạm vi:** `frontend/views/editor/preview/LutCanvas.tsx` (mới) + điểm nối trong `ProgramMonitor.tsx`

- Một `<canvas>` WebGL2 vẽ frame hiện tại (từ `<video>` hoặc `<img>`) qua fragment shader áp LUT 3D (`sampler3D`, hoặc texture 2D dạng tile nếu WebGL1).
- **Chỉ thay thế đường vẽ khi clip có filter.** Clip không filter vẫn đi đường `<video>`/`<img>` + CSS như cũ — không được làm chậm trường hợp phổ biến nhất.
- Color correction (`clip.colorCorrection`) và các effect không phải filter **vẫn giữ nguyên đường CSS** ở sprint này. Thứ tự áp phải ghi rõ trong comment và giữ khớp với export.
- Giải phóng texture/context khi clip đổi. Kiểm bằng `WEBGL_lose_context` hoặc đếm texture — rò rỉ GPU trong một NLE là lỗi chí mạng.

**Điều kiện chấp nhận**
- Clip có filter hiển thị đúng màu; clip không filter đi đúng đường cũ (chứng minh bằng test hoặc bằng ảnh chụp so sánh trong PR).
- Tua/scrub không rò texture: mở 20 clip có filter rồi kiểm số WebGL resource không tăng tuyến tính.
- Máy không hỗ trợ WebGL2 → fallback về CSS xấp xỉ hiện tại **kèm cảnh báo một lần**, không màn hình đen.
- Không thêm bất kỳ subscribe nào vào `currentTime` ngoài các ref đã có (bẫy #2).

### F0-3 · Export dùng `lut3d`

**Phạm vi:** `electron/export/effects-filter.ts`, `electron/export/__tests__/`

- Filter LUT sinh ra `lut3d=file='<path>'`, trộn cường độ bằng `blend` hoặc `lut3d` + `mix` tuỳ phiên bản ffmpeg (kiểm tra bản đang dùng, ghi rõ trong PR).
- Đường dẫn file LUT phải escape đúng cho filtergraph ffmpeg trên Windows (dấu `\`, `:` trong `C:\`). Đây là chỗ dễ sai nhất của ticket này.
- Giữ nguyên đường cũ cho các effect không phải filter (`blur`, `glow`, `vignette`, `grain`, `sharpen`).

**Điều kiện chấp nhận**
- Chuỗi filtergraph sinh ra được test bằng snapshot, gồm cả ca đường dẫn Windows có khoảng trắng.
- `intensity = 0` không sinh node `lut3d` nào (không tốn thời gian encode cho một no-op).
- Export thật một clip 2 giây có filter chạy trót lọt trên máy Windows của dự án.

### F0-4 · Test parity preview ↔ export

**Phạm vi:** `core/tests/lut-parity.test.ts` (mới)

- Với mỗi filter trong registry: lấy một bảng màu mẫu (khoảng 32 màu phủ đều không gian RGB), chạy qua `applyLutToRgb` của core, so với kết quả ffmpeg `lut3d` trên cùng bảng màu đó (render một ảnh PNG 32×1 rồi đọc lại).
- Sai số tối đa cho phép: **2/255 mỗi kênh**. Nếu vượt, test đỏ và filter đó không được phát hành.
- Test này cần ffmpeg; nếu môi trường CI không có, `skipIf` nhưng **phải chạy được ở máy dev** và ghi hướng dẫn trong test.

**Điều kiện chấp nhận**
- Test tồn tại, chạy được cục bộ, và đỏ khi cố tình sửa lệch một công thức.
- Ngưỡng 2/255 được viết kèm lý do trong comment.

---

## Sprint F1 — Mô hình dữ liệu và catalog

**Mục tiêu:** filter trở thành dữ liệu, không còn là `enum` phải sửa code mỗi lần thêm.

### F1-1 · Tách filter khỏi `effectTypeValues`

**Phạm vi:** `core/src/project-model.ts`, `core/src/filters.ts` (mới), migration

Hiện `lut-*` nằm chung enum với `blur`/`glow`. Enum không mở rộng được lên hàng chục filter, và mỗi lần thêm là một lần sửa schema — tức là một lần phá tương thích file.

- Thêm trường mới trên clip: `filter?: { id: string; intensity: number }` (một filter mỗi clip).
- `filters.ts`: registry `FilterDefinition { id, name, category, tags, lutPath, thumbnailPath, description, isNew?, popularity? }`.
- Registry **phải nằm trong `core/`**, không phải `frontend/`: MCP server import trực tiếp từ `core/` và cần đúng danh sách này để autopilot chọn filter (bẫy #8). `description` là câu mô tả nhìn ra được, viết cho agent đọc — Sprint F4 dùng nó.
- **Migration:** clip đang mang effect `lut-*` phải được chuyển sang `clip.filter` khi mở project, giữ nguyên `intensity`. Effect `lut-*` cũ vẫn phải đọc được (đừng xoá khỏi enum ở sprint này) nhưng không còn được tạo mới.

**Điều kiện chấp nhận**
- Project cũ trong `.kailaedit-data/projects/` mở lên vẫn thấy đúng filter, đúng cường độ.
- Test migration: timeline có `effects: [{ type: 'lut-vintage', params: { intensity: 60 } }]` → sau khi mở có `clip.filter = { id: 'vintage', intensity: 60 }` và không còn effect đó.
- Thêm một filter mới **không cần sửa file schema nào**.

### F1-2 · Danh mục, tag, và bộ filter khởi điểm

**Phạm vi:** `core/src/filters.ts`, `resources/luts/` (mới)

- Danh mục thiết kế: `featured`, `new`, `portrait`, `landscape`, `mono`, `retro`, `night`, `food`, `movie`. Danh mục là dữ liệu, không hardcode trong UI.
- Chuyển 7 filter hiện có thành file `.cube` sao cho **khớp với hình ảnh hiện tại** (dựng LUT từ chính chuỗi ffmpeg cũ bằng một script one-off, đừng chỉnh tay bằng mắt).
- Bổ sung tối thiểu 15 filter mới phủ đủ các danh mục.
- Đóng gói: file `.cube` phải đi kèm app và giải được đường dẫn khi đã asar-pack (bẫy #8).

**Điều kiện chấp nhận**
- Mở project cũ có `lut-vintage`: khung hình **không đổi màu** so với trước migration (so ảnh chụp trong PR).
- `pnpm build:dir` rồi chạy app đóng gói, filter vẫn áp được — không chỉ chạy trong dev.
- Tổng dung lượng LUT thêm vào < 5 MB (33³ `.cube` nén tốt; nếu vượt, dùng size 17).

### F1-3 · Thumbnail thật

**Phạm vi:** script sinh thumbnail + `resources/filter-thumbs/`

- Một ảnh mẫu chung, áp từng LUT bằng `applyLutToRgb`, xuất PNG ~120×120.
- Script chạy được lại (`scripts/build-filter-thumbs.ts`), không commit ảnh sinh bằng tay.
- Xoá `SWATCH` gradient trong `EditorLibraryPanel.tsx`.

**Điều kiện chấp nhận**
- Thumbnail sinh ra từ chính LUT sẽ được áp, nên không thể lệch với kết quả thật.
- Thêm filter mới → chạy script → có thumbnail, không phải vẽ tay.

---

## Sprint F2 — Thư viện Filters chuẩn mực

**Mục tiêu:** tìm được filter trong 10 giây khi có 50+ filter.

### F2-1 · Sidebar danh mục + lưới thumbnail

**Phạm vi:** `frontend/views/editor/FiltersLibrary.tsx` (mới, tách khỏi `EffectLibrary`)

- Cột trái: danh sách danh mục, có trạng thái chọn. Cột phải: lưới thumbnail 4 cột, tên filter dưới ảnh.
- Tab `effects` và `adjust` **giữ nguyên** `EffectLibrary` cũ — chỉ tab `filters` chuyển sang component mới.
- Lưới phải ảo hoá hoặc lazy-load ảnh nếu > 60 mục.

**Điều kiện chấp nhận**
- Cuộn mượt với 100 filter giả lập (đo bằng React Profiler, ghi số trong PR).
- Không có chuỗi hiển thị nào hardcode — tất cả qua i18n (bẫy #4).

### F2-2 · Tìm kiếm và Favorites

- Ô tìm kiếm lọc theo `name` + `tags`, không phân biệt hoa thường và dấu tiếng Việt.
- Favorites lưu trong app settings (không phải trong project — favorite là sở thích của người dùng, không thuộc về file dự án).
- Danh mục "Favorites" nằm trên cùng sidebar.

**Điều kiện chấp nhận**
- Gõ "chân dung" tìm ra filter có tag `portrait` (bảng đồng nghĩa tối thiểu cho vi/en).
- Favorite sống sót qua khởi động lại app.
- Test đơn vị cho hàm lọc, không phải test UI.

### F2-3 · Hover preview

- Rê chuột lên thumbnail → khung preview áp tạm filter đó lên frame hiện tại; rời chuột thì trả lại.
- Debounce ~120 ms để lướt chuột qua lưới không gây nháy.
- **Không được ghi vào store.** Đây là trạng thái xem thử, không phải một sửa đổi — nếu nó vào store thì undo stack sẽ đầy rác.

**Điều kiện chấp nhận**
- Rê chuột qua 20 thumbnail liên tiếp: undo stack không tăng thêm mục nào.
- Rời chuột luôn trả về đúng trạng thái trước đó, kể cả khi rời nhanh.

---

## Sprint F3 — Áp dụng và tinh chỉnh

### F3-1 · Áp filter và slider cường độ

- Click thumbnail → áp cho mọi clip đang chọn. Không có clip nào được chọn → lưới xám và có tooltip giải thích (hành vi hiện tại đã đúng, giữ nguyên).
- Kéo-thả thumbnail lên clip trên timeline → áp cho clip đó. Dùng lại đường `dataTransfer` hiện có nhưng key riêng (`filterId`), đừng nhồi vào `effectType`.
- Slider cường độ 0–100 hiện ngay dưới lưới khi clip đang chọn đã có filter.
- Filter thứ hai áp lên cùng clip sẽ **thay thế** filter cũ, không cộng dồn (và cộng dồn LUT là vô nghĩa về mặt màu).

**Điều kiện chấp nhận**
- Áp filter là **một** mục undo, không phải hai.
- Áp cho 10 clip cùng lúc cũng chỉ là một mục undo.
- Kéo-thả lên clip không làm clip đó bị chọn lại hay bị di chuyển.

### F3-2 · Filter trên adjustment layer

- Adjustment layer (`assetType: 'adjustment'`) đã tồn tại. Filter đặt trên adjustment layer áp cho **mọi clip nằm dưới nó** trong khoảng thời gian nó phủ.
- Export phải áp đúng thứ tự: filter của clip trước, filter của adjustment layer sau.

**Điều kiện chấp nhận**
- Test core: một adjustment layer phủ 2 clip → cả 2 clip nhận filter khi render.
- Parity preview/export cho ca này (chạy lại F0-4 với adjustment layer).

---

## Sprint F4 — MCP và Autopilot

**Mục tiêu:** agent grade được timeline mà không cần người chạm chuột, và **nhìn thấy** kết quả nó vừa làm.

Sprint này phụ thuộc F0 (parity) và F1 (registry trong `core/`). Không phụ thuộc F2/F3 — bề mặt agent không đi qua UI, nên F4 có thể chạy song song với F2.

### F4-1 · Op `set_filter` / `remove_filter`

**Phạm vi:** `core/src/edit-patch.ts`, `core/tests/edit-patch-filters.test.ts` (mới)

```ts
{ op: 'set_filter', clipId: string, filterId: string, intensity?: number }   // 0–100, mặc định 100
{ op: 'remove_filter', clipId: string }
```

- `filterId` không có trong registry → lỗi **nêu tên id sai và gợi ý id gần đúng nhất**. Agent sửa được lỗi có gợi ý; lỗi trống thì nó đoán mò và thử lại vô ích.
- `intensity` ngoài 0–100 → lỗi, không kẹp im lặng. Agent cần biết nó sai.
- Áp cho clip không phải hình (audio) → lỗi rõ ràng, không no-op im lặng.
- Nối vào bộ đếm mô tả patch giống `setTransitionCount` ở [`edit-patch.ts:430`](../core/src/edit-patch.ts) để dòng tóm tắt tiếng Việt nêu được "đặt N filter".

**Điều kiện chấp nhận**
- Test cho từng ca lỗi ở trên, mỗi ca kiểm **nội dung** thông điệp, không chỉ kiểm là có ném lỗi.
- Áp filter qua patch cho ra state **giống hệt** áp qua UI (so sánh hai `EditorState`) — nếu hai đường lệch nhau thì một trong hai sẽ mục ruỗng.
- `edit_undo` hoàn tác được một patch có `set_filter`.

### F4-2 · Tool `filter_list`

**Phạm vi:** `packages/kailaedit-mcp/src/server.ts`

- Tool mới trả về registry: `id`, `name`, `category`, `tags`, và một câu mô tả ngắn nhìn ra được (`"warm, lifted blacks, low saturation"`).
- Hỗ trợ lọc theo `category` và `query` để agent không phải nuốt cả trăm mục vào context.
- **Mô tả phải viết cho agent đọc, không phải cho người ngắm.** `"Vintage"` là vô dụng; `"faded warm cast, crushed contrast, 1970s film"` mới chọn được.

**Điều kiện chấp nhận**
- Agent chỉ dùng `filter_list` + `set_filter` là grade được, không cần hỏi người.
- Không tool nào khác phải đổi chữ ký.

### F4-3 · Filter hiện trong mô tả timeline

**Phạm vi:** `core/src/timeline-summary.ts`, nhánh `timeline_describe` trong `server.ts`

- Mỗi clip nêu filter đang áp và cường độ: `filter: vintage (70%)`. Không có thì bỏ hẳn dòng, đừng in `filter: none` cho mọi clip — lãng phí context.
- `timelineSummary` thêm một dòng tổng: bao nhiêu clip đã grade, bao nhiêu chưa.

**Điều kiện chấp nhận**
- Agent phân biệt được clip đã grade và chưa grade **chỉ bằng** `timeline_describe`, không phải render ảnh ra xem.
- Test snapshot cho một timeline có filter và một timeline không.

### F4-4 · QC cho filter

**Phạm vi:** `core/src/qc-check.ts`

Hai loại vấn đề mới:

| Type | Severity | Khi nào |
|---|---|---|
| `UNKNOWN_FILTER` | error | `clip.filter.id` không có trong registry |
| `MISSING_LUT` | error | Registry có id nhưng file `.cube` không tồn tại trên đĩa |

- Workflow agent dừng khi QC có error (hành vi hiện có), nên hai loại này phải **thật sự là lỗi chặn** — không phải warning cho vui.
- Thông điệp nêu tên clip và tên filter, giống văn phong các issue sẵn có.

**Điều kiện chấp nhận**
- Test cho cả hai ca, kiểm cả `severity` và `clipId`.
- Comment giải thích **vì sao** đây là error chứ không phải warning — theo đúng lối viết đã có ở `qc-check.ts` về clip sinh ra (`isGeneratedClip`).

### F4-5 · Skill autopilot mẫu

**Phạm vi:** `.claude/skills/grade-timeline/` + `docs/skills/grade-timeline.md`

Theo đúng khuôn của skill [`cut-silence`](../.claude/skills/cut-silence.md) đã có:

1. `timeline_describe` → tìm clip chưa grade
2. `filter_list` → chọn theo yêu cầu người dùng ("làm ấm lên", "kiểu phim thập niên 70")
3. `render_preview` một clip mẫu → **tự kiểm bằng mắt**
4. `ask_confirm` trước khi áp hàng loạt
5. `edit_apply` với các op `set_filter`
6. `qc_check` → xác nhận không sinh lỗi mới

**Điều kiện chấp nhận**
- Chạy được thật trên project mẫu, từ đầu đến cuối, không cần can thiệp tay.
- Skill **bắt buộc** dừng ở `ask_confirm` trước khi grade quá 5 clip. Grade hàng loạt là thao tác thẩm mỹ, khó hoàn tác bằng mắt, và người dùng phải được nhìn thử một mẫu trước.
- Thêm vào `scripts/eval-skills.ts` một scenario có invariant kiểm được bằng máy (số clip có filter sau khi chạy).

### F4-6 · `render_preview` chứng minh được filter

**Phạm vi:** test trong `packages/kailaedit-mcp/`

- Render một clip có filter, đọc pixel trung tâm, so với kết quả `applyLutToRgb` của core trong cùng ngưỡng 2/255 của F0-4.
- Đây là mắt của agent. Nếu nó nói dối thì autopilot grade mù.

**Điều kiện chấp nhận**
- Test tồn tại và đỏ khi cố tình bỏ node `lut3d` khỏi filtergraph.

---

## Sprint F5 — Hiệu năng, QC, hoàn thiện

### F5-1 · Ngân sách hiệu năng

Đo và ghi số vào PR:

| Chỉ số | Ngưỡng |
|---|---|
| Mở tab Filters (50 filter) | < 150 ms tới khung hình đầu |
| Rê chuột qua lưới | không rớt dưới 50 fps |
| Áp filter cho 1 clip | < 80 ms tới khi preview cập nhật |
| Export 1 phút 1080p có filter | không chậm hơn 20% so với không filter |

### F5-2 · Xử lý lỗi

- Thiếu file LUT (asset hỏng, cài đặt lỗi) → filter hiện dấu cảnh báo trong panel thuộc tính, clip vẫn render **không có filter**, không màn hình đen, không crash export.
- Project tham chiếu `filter.id` không còn tồn tại (người dùng downgrade app) → giữ nguyên id trong file, cảnh báo một lần, render không filter. **Không được im lặng xoá dữ liệu người dùng.**

### F5-3 · Tài liệu

- Cập nhật `docs/skills/video-editor-development.md`: cách thêm một filter mới (thả `.cube` vào đâu, chạy script gì, sửa registry ra sao) — và nhắc rằng thêm filter là **ba** việc: LUT, thumbnail, mô tả cho agent.
- Ghi rõ thứ tự áp màu: `colorCorrection` → `filter` → `effects`, và nơi thứ tự đó được thi hành ở **cả ba** phía (WebGL, ffmpeg export, ffmpeg `render_preview`).
- Cập nhật tài liệu MCP: hai op mới và tool `filter_list`, kèm ví dụ patch chạy được.

---

## 5. Giao thức kiểm chứng

Mỗi PR phải trả lời được:

1. `pnpm typecheck` sạch? (dán output)
2. `npx vitest run core electron shared frontend` xanh? (dán dòng tổng kết)
3. Test mới nằm ở file nào, và **nó đỏ khi nào**? Một test không bao giờ đỏ được là một test vô dụng.
4. Với ticket đụng tới màu: ảnh chụp preview và frame export cùng một thời điểm, đặt cạnh nhau.
5. Với ticket đụng tới UI: ảnh chụp trước/sau.
6. Điều kiện chấp nhận nào **không** đạt, và vì sao.

---

## 6. Rủi ro đã biết

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| WebGL preview là việc lớn hơn ước lượng | F0 trượt lịch, kéo theo mọi sprint | Làm F0-2 trước tiên và cắt phạm vi: chỉ lớp video chính, không mask, không transition |
| ffmpeg trên máy người dùng không có `lut3d` | Export mất filter | Kiểm tra `ffmpeg -filters` khi khởi động, cảnh báo sớm; ffmpeg-static đã kèm nên rủi ro thấp |
| Dung lượng LUT làm phình bộ cài | Bản build nặng | LUT size 17 thay vì 33 nếu vượt ngân sách; đo ở F1-2 |
| Migration làm hỏng project cũ | Mất việc của người dùng | F1-1 phải test trên project thật trong `.kailaedit-data/projects/`; không xoá enum cũ ở sprint này |
| Filter cộng dồn với `colorCorrection` cho kết quả bất ngờ | Người dùng chỉnh mãi không ra màu mong muốn | Chốt và tài liệu hoá thứ tự áp ngay ở F0, đừng để mỗi nơi tự quyết |
| Registry nằm nhầm ở `frontend/` | MCP không import được, F4 phải làm lại từ đầu | Ràng buộc đã ghi trong F1-1; reviewer kiểm ngay ở PR đó, đừng để tới F4 mới phát hiện |
| Agent grade hàng loạt rồi người dùng không thích | Mất việc, khó hoàn tác bằng mắt | `ask_confirm` bắt buộc trước khi vượt 5 clip (F4-5); một patch = một mục undo (F3-1) |
| Mô tả filter viết cho người ngắm, không cho agent đọc | Autopilot chọn filter ngẫu nhiên, người dùng mất tin | F4-2 yêu cầu mô tả nhìn ra được; review từng chuỗi, không auto-generate |

---

## 7. Việc đang mở, không thuộc plan này nhưng chạm vào cùng vùng mã

Hai lỗi đã biết trong hệ transitions/timeline, đang có ticket riêng. Agent làm filter **không sửa chúng**, nhưng nên biết để không nhầm lẫn nguyên nhân khi thấy hành vi lạ:

1. Phần lớn lời gọi `packTrack1` không truyền danh sách transitions → transition trên track chính có thể tự huỷ khi kéo clip hoặc thêm asset.
2. Transition có thể tồn tại dưới dạng bản ghi trong khi hai clip không còn chồng nhau; `pruneOrphanTransitions` tồn tại nhưng chưa được gọi ở đâu trong code sản phẩm.
