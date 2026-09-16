# Skill: Auto Highlight & Hook 3s Optimization (KE-903)

## Mục tiêu
Tự động phân tích transcript của video dài (podcast, talkshow, bài giảng) để trích xuất 3 đến 5 đoạn highlight tiềm năng nhất (thời lượng 25s – 60s), tối ưu hóa tỷ lệ khung hình 9:16 dọc cho Shorts/Reels/TikTok và tạo Title Card Hook 3 giây đầu giật tít để giữ chân người xem.

## Công cụ MCP liên quan
- **`extract_highlights`**: Đọc transcript từ project / file media hoặc tham số đầu vào, phân tích qua OpenAI Chat Completion LLM (`gpt-4o-mini`) theo 5 tiêu chí viral để xếp hạng và sinh hook candidate.
- **`edit_propose`**: Hỗ trợ thao tác `create_highlight_short`:
  ```json
  {
    "op": "create_highlight_short",
    "sourceClipId": "clip-v1",
    "startTime": 15.0,
    "endTime": 45.0,
    "hookText": "Bí mật 90% người không biết!",
    "hookPreset": "headline-alert",
    "targetDimensions": { "width": 1080, "height": 1920 }
  }
  ```

## 5 Tiêu chí Viral Highlight
1. **Hook mở đầu gây tò mò / giật mình**: Đặt vấn đề bất ngờ trong 3 giây đầu.
2. **Quan điểm trái chiều / Tranh luận gay gắt**: Giữ chân người xem vào phần bình luận.
3. **Số liệu / Kết quả gây sốc**: Dẫn chứng bằng con số cụ thể.
4. **Phát ngôn súc tích, dễ trích dẫn**: Thích hợp làm trích dẫn viral trên mạng xã hội.
5. **Đoạn mạch câu trọn vẹn**: Không bị cụt đầu hoặc đứt đuôi.

## Quy trình làm việc chuẩn của CoEdit
1. Gọi `timeline_describe` để lấy danh sách clip video trên timeline.
2. Gọi `extract_highlights` để lấy danh sách các đoạn viral nhất cùng `hookText`.
3. Đề xuất lựa chọn cho người dùng hoặc gọi `edit_propose` với `create_highlight_short`.
4. Gọi `render_preview` để xem trước video dọc 9:16 kèm Hook Text 3s.
5. Kiểm tra `qc_check` và áp dụng bằng `edit_apply`.
