# Máy chủ MCP & Kỹ năng AI (Skills)

<p align="center">
  <img src="../../images/editpilot-architecture.png" alt="Kiến trúc Model Context Protocol trong KailaEdit" width="85%">
</p>

KailaEdit tích hợp sẵn một máy chủ Model Context Protocol (MCP) nội bộ tại thư mục `packages/kailaedit-mcp/`. Cơ chế này cho phép các tác tử AI (AI Agents) thao tác trực tiếp trên timeline video mà không cần tương tác qua giao diện hay can thiệp vào tệp hệ thống.

---

## 🛠️ Bộ công cụ MCP (MCP Toolset)

Máy chủ MCP cung cấp các nhóm công cụ phân cấp rõ ràng:

### 1. Nhóm công cụ Đọc dữ liệu (Read Tools)
- `timeline_describe`: Trả về toàn bộ cấu trúc timeline, các track, clip, khoảng thời gian và các khoảng trống.
- `timeline_summary`: Tóm tắt ngắn gọn trạng thái timeline nhằm tiết kiệm token cho mô hình AI.
- `media_list` & `media_probe`: Liệt kê tài nguyên và trích xuất thông số kỹ thuật (độ phân giải, fps, codec, kênh âm thanh).
- `subtitle_list`: Lấy danh sách các câu phụ đề kèm mốc thời gian.

### 2. Nhóm công cụ Đo lường (Measure Tools)
- `observe_silence`: Sử dụng bộ lọc `silencedetect` của FFmpeg để phát hiện chính xác các khoảng lặng hoặc ngập ngừng.
- `observe_scenes`: Phát hiện điểm chuyển cảnh dựa trên sự biến thiên ánh sáng khung hình (`select='gt(scene,0.4)'`).
- `observe_loudness`: Đo lường cường độ âm thanh tích hợp theo chuẩn EBU R128 (LUFS).

### 3. Nhóm công cụ Chỉnh sửa (Edit Tools)
- `edit_propose`: Kiểm tra tính hợp lệ của chuỗi thao tác và tạo ra bản mô tả thay đổi (diff).
- `render_preview`: Tạo video xem trước chất lượng thấp để người dùng duyệt nhanh.
- `qc_check`: Kiểm định chất lượng, đảm bảo không có bất kỳ vi phạm cấu trúc nào trên timeline.
- `edit_apply`: Áp dụng chính thức bản vá `EditPatch` vào dự án.
- `edit_undo`: Hoàn tác bản vá vừa áp dụng.

---

## 🧩 Giao thức `EditPatch`

Mọi thay đổi trên timeline của AI đều được chuẩn hóa thành các thao tác nguyên tử (atomic operations) định nghĩa tại `core/src/edit-patch.ts`:

```ts
export type EditPatchOperation =
  | { type: 'split_clip'; clipId: string; splitTime: number }
  | { type: 'cut_range'; startTime: number; endTime: number; trackIndices?: number[] }
  | { type: 'move_clip'; clipId: string; targetTrackIndex: number; targetStartTime: number }
  | { type: 'update_clip'; clipId: string; updates: Partial<TimelineClip> }
  | { type: 'insert_clip'; assetId: string; trackIndex: number; startTime: number; duration?: number }
  | { type: 'delete_clip'; clipId: string }
  | { type: 'add_filter'; clipId: string; filterId: string; intensity?: number }
  | { type: 'add_subtitle'; text: string; startTime: number; duration: number }
```

### Quy tắc bất di bất dịch: Mọi tính năng mới đều phải có công cụ MCP tương ứng!
Khi bạn bổ sung một tính năng biên tập mới trên giao diện:
1. Bổ sung thao tác tương ứng vào `editPatchOperationSchema` trong `core/src/edit-patch.ts`.
2. Lập trình bộ xử lý trong hàm `executePatchOperations` và `describePatch`.
3. Bổ sung luật kiểm tra tính hợp lệ trong `validateEditPatch`.
4. Cập nhật `timeline_describe` để AI có thể nhìn thấy thuộc tính mới này.
5. Viết bài test kiểm thử trong `core/tests/edit-patch.test.ts`.

---

## 🧪 Bộ kiểm thử tự động kỹ năng AI (`pnpm eval:skills`)

Để đảm bảo các bản cập nhật mã nguồn không làm suy giảm độ chính xác của trợ lý AI, KailaEdit trang bị bộ kiểm thử tự động:

```bash
pnpm eval:skills
```

Lệnh này chạy qua toàn bộ các kịch bản mẫu và kiểm tra các bất biến kỹ thuật:
- **Tỉ lệ rút ngắn thời lượng**: Đảm bảo cắt lọc khoảng lặng đạt tỉ lệ mong đợi (ví dụ: rút ngắn từ 15%–30%).
- **Không sinh clip siêu nhỏ**: Tất cả các đoạn cắt sinh ra phải có độ dài $\ge 0.5s$.
- **Tính liền mạch của Track chính**: Không được để xảy ra bất kỳ khoảng đen ngắt quãng nào trên Track V1.
- **Không vi phạm QC**: Lệnh `qc_check` phải trả về 0 lỗi.

---

[← Quay lại: 03. Quản lý State & Editor Store](03-state-and-editor-store.md) · [Tiếp theo: 05. Hướng dẫn đóng góp →](05-contributing.md)
