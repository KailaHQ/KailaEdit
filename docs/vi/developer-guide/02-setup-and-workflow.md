# Thiết lập môi trường phát triển & Quy trình làm việc

Tài liệu này hướng dẫn chi tiết cách thiết lập môi trường lập trình cục bộ, chạy mã nguồn ở chế độ phát triển, gỡ lỗi (debug) và đóng gói bản cài đặt hoàn chỉnh cho KailaEdit.

---

## 💻 Yêu cầu môi trường

Trước khi bắt đầu, hãy đảm bảo máy tính của bạn đã cài đặt:
- **Node.js**: Phiên bản `v20.x` hoặc `v22.x` (Khuyên dùng bản LTS).
- **pnpm**: Trình quản lý gói siêu nhanh và tiết kiệm dung lượng (`corepack enable` hoặc `npm install -g pnpm`).
- **Git**: Quản lý phiên bản mã nguồn.
- **Công cụ biên dịch C/C++** (Tùy chọn, chỉ cần nếu cài thêm native modules):
  - Windows: Visual Studio C++ Desktop Development tools.
  - macOS: Xcode Command Line Tools (`xcode-select --install`).
  - Linux: Gói `build-essential`.

---

## 📦 Các bước cài đặt & Khởi động

1. **Sao chép mã nguồn về máy**:
   ```bash
   git clone https://github.com/KailaHQ/KailaEdit.git kailaedit
   cd kailaedit
   ```

2. **Cài đặt các gói phụ thuộc (Dependencies)**:
   ```bash
   pnpm install
   ```

3. **Chạy ứng dụng ở chế độ lập trình (Hot Reload)**:
   ```bash
   pnpm dev
   ```
   Lệnh này sẽ khởi động song song máy chủ Vite HMR cho giao diện React và mở cửa sổ ứng dụng Electron. Bất kỳ thay đổi nào trong mã nguồn giao diện sẽ cập nhật tức thì trên màn hình.

4. **Chạy chế độ Debug chuyên sâu**:
   ```bash
   pnpm dev:debug
   ```
   Lệnh này mở thêm cổng gỡ lỗi từ xa (remote debugging inspector) cho tiến trình Electron chính.

---

## 🛠️ Danh mục các câu lệnh hữu ích

| Lệnh | Chức năng |
|---|---|
| `pnpm dev` | Chạy ứng dụng lập trình với tính năng Vite HMR và Electron. |
| `pnpm dev:debug` | Chạy chế độ lập trình kèm cổng gỡ lỗi Electron Inspector. |
| `pnpm typecheck` | Kiểm tra lỗi kiểu dữ liệu TypeScript (`tsc --noEmit`) trên `frontend/` và `shared/`. |
| `pnpm build:frontend` | Biên dịch bản build giao diện tối ưu hóa cho môi trường phát hành. |
| `pnpm build:dir` | Đóng gói thư mục ứng dụng dạng giải nén (kiểm tra nhanh đóng gói mà không cần nén bộ cài). |
| `pnpm build` | Biên dịch và tạo bộ cài đặt hoàn chỉnh cho hệ điều hành hiện tại (`.exe`, `.dmg`, `.AppImage`). |
| `pnpm eval:skills` | Chạy bộ kiểm thử tự động đánh giá các kỹ năng AI (Skill Evaluation Suite). |

---

## 🔍 Quy tắc kiểm tra kiểu dữ liệu (Typechecking)

Tiến trình chính của Electron được đóng gói thông qua esbuild, do đó lệnh `pnpm typecheck` chỉ kiểm tra mã trong `frontend/` và `shared/`. Để kiểm tra tính hợp lệ về kiểu dữ liệu cho toàn bộ các file của tiến trình Electron, hãy chạy:

```bash
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop electron/*.ts electron/ipc/*.ts electron/export/*.ts
```

---

[← Quay lại: 01. Tổng quan kiến trúc](01-architecture-overview.md) · [Tiếp theo: 03. Quản lý State & Editor Store →](03-state-and-editor-store.md)
