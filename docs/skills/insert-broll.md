# Skill: B-roll Copilot — Gợi ý và chèn clip minh hoạ (KE-904)

## Mục tiêu
Tự động phát hiện các đoạn nói chuyện liên tục kéo dài (>5–7 giây) thiếu sự thay đổi góc máy hay hình ảnh minh họa (Talking Head Fatigue). Hệ thống trích xuất từ khoá chủ đề từ lời thoại để gợi ý tìm kiếm tư liệu và hỗ trợ chèn clip B-roll lên track overlay (V2/V3) với hiệu ứng fade in / fade out mượt mà, tự động tắt âm lượng để không lấn át tiếng nói chính.

## Công cụ MCP liên quan
- **`suggest_broll`**: Quét timeline transcript/subtitles và danh sách clip hiện có để xác định các khoảng thời gian cần chèn B-roll, trích xuất danh sách từ khoá và gợi ý câu prompt tư liệu.
  ```json
  {
    "projectId": "project-1",
    "minDuration": 5.0,
    "maxDuration": 8.0
  }
  ```
  Kết quả trả về:
  ```json
  {
    "total": 2,
    "opportunities": [
      {
        "id": "broll-opp-1",
        "startTime": 4.5,
        "endTime": 8.5,
        "duration": 4.0,
        "contextText": "hôm nay mình sẽ hướng dẫn các bạn cách thiết kế giao diện ứng dụng",
        "keywords": ["thiết kế", "giao diện", "ứng dụng"],
        "suggestedPrompt": "B-roll minh hoạ: thiết kế, giao diện, ứng dụng"
      }
    ]
  }
  ```

- **`edit_propose`**: Hỗ trợ thao tác `insert_broll`:
  ```json
  {
    "op": "insert_broll",
    "assetPath": "/path/to/broll-app-ui.mp4",
    "startTime": 4.5,
    "duration": 4.0,
    "fadeIn": 0.25,
    "fadeOut": 0.25,
    "muteAudio": true
  }
  ```

## Quy tắc xếp B-roll trên Timeline
1. **Track đè (Overlay track)**: Luôn chèn lên track video overlay (V2 hoặc V3), tuyệt đối không chèn trực tiếp lên track chính V1 làm đứt đoạn video người nói.
2. **Âm thanh**: Mặc định đặt `muteAudio: true` và `volume: 0` để tránh tiếng ồn môi trường của clip B-roll lấn át giọng thuyết minh trên V1.
3. **Chuyển cảnh mượt mà**: Tự động áp dụng fade in / fade out nhẹ (0.2s–0.3s) ở hai đầu clip B-roll nhằm tránh hiện tượng giật khung hình khi xuất hiện hoặc biến mất.
4. **Căn chỉnh khung hình**: Đảm bảo transform scale và position phù hợp với tỷ lệ khung hình hiện tại của timeline (16:9 hoặc 9:16).

## Quy trình làm việc chuẩn của CoEdit
1. Gọi `timeline_describe` để nắm cấu trúc track và các clip đang có.
2. Gọi `suggest_broll` để nhận danh sách các vị trí cần hình ảnh minh họa kèm từ khóa.
3. Thông báo cho người dùng về các vị trí cần bổ sung B-roll hoặc tự động chèn các tư liệu có sẵn trong project assets bằng `edit_propose` với thao tác `insert_broll`.
4. Gọi `render_preview` để người dùng xem thử đoạn B-roll đè lên giọng nói.
5. Kiểm tra `qc_check` và chốt bằng `edit_apply`.
