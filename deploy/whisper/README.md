# Hướng dẫn triển khai Dịch vụ Nhận dạng Lời nói Whisper (KailaEdit)
# Deploying Standalone Whisper Speech Recognition Service

Tài liệu hướng dẫn triển khai dịch vụ bóc băng / nhận dạng lời nói độc lập cho KailaEdit theo chuẩn OpenAI Audio API (`POST /v1/audio/transcriptions`).

---

## 1. Các chế độ hỗ trợ (Supported Modes)

| Chế độ | Mô tả | Chi phí / Yêu cầu phần cứng |
|---|---|---|
| **Self-hosted Docker (GPU NVIDIA)** | Chạy `faster-whisper-server` trên Docker (WSL2 trên Windows hoặc Linux có card NVIDIA). Tốc độ cực nhanh. | Miễn phí, cần GPU NVIDIA (GTX 1060 trở lên, VRAM >= 4GB). |
| **Self-hosted macOS (Apple Silicon)** | Chạy script `run-mac.sh` trên Mac Mx (M1, M2, M3, M4) tận dụng Metal và Neural Engine. | Miễn phí, cần máy Mac chip Apple Silicon. |
| **OpenAI Cloud API** | Gọi trực tiếp OpenAI Whisper Cloud (`https://api.openai.com/v1`). | Cần OpenAI API Key (~$0.006 / phút âm thanh). |
| **Groq Cloud API** | Gọi trực tiếp Groq Whisper Cloud (`https://api.groq.com/openai/v1`). Tốc độ siêu thanh. | Cần Groq API Key (có gói miễn phí). |

---

## 2. Triển khai với Docker trên Windows (WSL2) hoặc Linux (NVIDIA GPU)

1. Yêu cầu: Đã cài đặt Docker Desktop (trên Windows bật WSL2 backend) và [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
2. Mở terminal tại thư mục `deploy/whisper/`:
   ```bash
   docker compose -f docker-compose.gpu.yml up -d
   ```
3. Kiểm tra container đang chạy:
   ```bash
   docker compose -f docker-compose.gpu.yml logs -f
   ```
4. Khi dịch vụ đã sẵn sàng, endpoint sẽ là:
   `http://localhost:8000/v1`

---

## 3. Chạy trên macOS Apple Silicon (M1/M2/M3/M4)

1. Mở Terminal tại thư mục `deploy/whisper/`.
2. Cấp quyền thực thi và chạy:
   ```bash
   chmod +x run-mac.sh
   ./run-mac.sh
   ```
3. Script sẽ tự động tạo môi trường ảo Python và khởi chạy server trên cổng `8000`.
4. Endpoint sẽ là:
   `http://localhost:8000/v1`

---

## 4. Cấu hình trong KailaEdit

1. Mở KailaEdit -> Bấm nút **Cài đặt** (Settings).
2. Chuyển sang thẻ **Nhận dạng giọng nói (Speech)**.
3. Chọn một trong hai tùy chọn:
   - **Self-hosted Whisper Service**: Nhập Endpoint `http://localhost:8000/v1` (hoặc IP máy chủ trong mạng LAN `http://192.168.x.x:8000/v1`). Không cần API Key.
   - **OpenAI Cloud API**: Nhập API Key (ví dụ `sk-...`). Endpoint mặc định là `https://api.openai.com/v1`.
4. Bấm nút **Kiểm tra kết nối** (Health Check). Khi thấy thông báo màu xanh "Kết nối thành công", bấm **Lưu** (Save).
5. Trong trình dựng video:
   - Vào tab **Captions** trên thanh công cụ bên trái -> Chọn **Auto captions**.
   - Bấm nút **Tạo phụ đề tự động** để bóc băng và tự động đưa các câu phụ đề lên Timeline!
