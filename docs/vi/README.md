# Tài liệu KailaEdit (Tiếng Việt)

Chào mừng bạn đến với trung tâm tài liệu tiếng Việt của **KailaEdit** — phần mềm biên tập video desktop mã nguồn mở, hoạt động 100% offline và tích hợp trợ lý AI thông qua giao thức Model Context Protocol (MCP).

---

## 🧭 Mục lục điều hướng

### 📖 Hướng dẫn sử dụng (User Guide)
Dành cho người sáng tạo nội dung, biên tập viên video và người dùng mới bắt đầu.

1. **[01. Bắt đầu](user-guide/01-getting-started.md)**: Yêu cầu hệ thống, tải & cài đặt, tạo project đầu tiên, nhập media.
2. **[02. Giao diện & Không gian làm việc](user-guide/02-interface-and-workspace.md)**: Khay tài nguyên Media, Màn hình Monitor kép (Clip/Timeline), bảng Inspector, Thư viện đa năng, Cài đặt ứng dụng & Cài đặt dự án.
3. **[03. Timeline & Công cụ cắt ghép](user-guide/03-timeline-and-editing.md)**: Thao tác multi-track, công cụ dao cạo (Blade), Ripple, Roll, Slip, Slide, hít nam châm (Snapping), menu xử lý khoảng trống (Gap Actions Popover), tạo hoạt ảnh Keyframe (`◆`), thư viện chuyển cảnh (Transitions), chế độ hòa trộn (Blend Modes) và nhãn dán trang trí (Stickers).
4. **[04. Chỉnh màu, Hiệu ứng & Adjustment Layer](user-guide/04-color-effects-filters.md)**: Thư viện bộ lọc 3D LUT phong phú (tìm kiếm, yêu thích, xem trước tức thì, chỉnh cường độ, áp dụng cho tất cả), WebGL Shader GPU chuẩn màu 1:1 với FFmpeg, chỉnh màu 8 thông số, nhập LUT `.cube` ngoài và chuyên đề **Lớp điều chỉnh (Adjustment Layer)**.
5. **[05. Âm thanh & Phụ đề](user-guide/05-audio-and-subtitles.md)**: Tùy chỉnh volume clip, Audio Boost (+24dB), Audio Limiter chống rè méo tiếng, Audio Ducking tự động né tiếng, tạo phụ đề tự động bằng AI Whisper ngoại tuyến (100% offline), mẫu chữ (Text Presets) và nhập/xuất tệp SRT.
6. **[06. Xuất video](user-guide/06-export-and-delivery.md)**: Xuất video bằng FFmpeg offline, codec H.264/ProRes/VP9, tăng tốc phần cứng GPU (NVENC, QuickSync, VideoToolbox), quy trình Proxy & Render Cache dựng 4K/8K siêu mượt, hàng đợi xuất file (Render Queue) và mốc phân đoạn (Chapter Markers).
7. **[07. Trợ lý AI CoEdit](user-guide/07-coedit-ai-assistant.md)**: Kết nối các mô hình AI (Claude Code, Antigravity, Codex) qua giao thức MCP, đồng bộ trực tiếp giao diện (Live UI Sync), cắt lọc khoảng lặng, trích xuất khoảnh khắc đắt giá (Auto Highlights), gợi ý B-Roll thông minh (B-Roll Copilot), bóc băng Whisper và bảng tra cứu 22 công cụ MCP.

---

### 💻 Hướng dẫn nhà phát triển (Developer Guide)
Dành cho các kỹ sư phần mềm muốn tìm hiểu kiến trúc hoặc đóng góp mã nguồn.

1. **[01. Tổng quan kiến trúc](developer-guide/01-architecture-overview.md)**: Mô hình 2 tầng Electron + React 18, cầu nối IPC định kiểu chặt chẽ với Zod, quy trình FFmpeg pipeline.
2. **[02. Thiết lập môi trường phát triển](developer-guide/02-setup-and-workflow.md)**: Cài đặt công cụ, chạy dev mode, debug, kiểm tra kiểu (typecheck), build đóng gói cài đặt.
3. **[03. Quản lý State & Editor Store](developer-guide/03-state-and-editor-store.md)**: Kiến trúc Zustand store, memoized selectors, domain actions, snapshot history undo/redo.
4. **[04. Máy chủ MCP & Kỹ năng AI](developer-guide/04-mcp-server-and-skills.md)**: Giao thức Model Context Protocol trong KailaEdit, cơ chế `EditPatch`, bộ test tự động `eval:skills`.
5. **[05. Hướng dẫn đóng góp (Contributing)](developer-guide/05-contributing.md)**: Quy chuẩn code, tạo issue, quy trình gửi Pull Request, văn hóa cộng đồng.
6. **[06. Phát hành & Tự động cập nhật](developer-guide/06-releasing-and-updates.md)**: Phát hành theo tag lên GitHub Releases, ma trận build bốn runner, và cơ chế cập nhật trong app.

---

## ⚖️ Ghi nhận nguồn gốc & Điều khoản sử dụng

- **Ghi nhận nguồn gốc (Acknowledgements)**: Mã nguồn của KailaEdit có tham khảo và kế thừa nền tảng kiến trúc từ dự án [LTX Desktop](https://github.com/Lightricks/LTX-Desktop) của Lightricks Ltd. (phát hành theo giấy phép Apache-2.0). Mọi thông tin ghi nhận quyền tác giả gốc được lưu giữ nguyên vẹn trong [NOTICES.md](../../NOTICES.md) và [LICENSE.txt](../../LICENSE.txt).
- **Miễn phí phi thương mại (Free for Non-Commercial Use)**: KailaEdit được phát hành hoàn toàn miễn phí cho mục đích sử dụng cá nhân, học tập, sáng tạo nội dung và nghiên cứu phi thương mại. Nghiêm cấm mọi hình thức thương mại hóa, bán lại hoặc thu phí mà không có sự cho phép trước bằng văn bản.
- **Giấy phép mã nguồn**: Phần mềm được phát hành theo giấy phép mã nguồn mở [Apache-2.0 License](../../LICENSE.txt).

---

[← Quay lại Cổng tài liệu tổng](../README.md) · [Read English Documentation →](../en/README.md)
