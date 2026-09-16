### Which file do I download? / Tải file nào?

| Your computer / Máy của bạn | Download / Tải về |
|---|---|
| **Windows** 10 or 11 | `...-win-x64-Setup.exe` |
| **Mac with Apple chip** — M1, M2, M3, M4<br>*Mac chip Apple (M1–M4)* | `...-mac-arm64.dmg` |
| **Mac with Intel chip** — any Mac sold before 2021<br>*Mac chip Intel (máy trước 2021)* | `...-mac-x64.dmg` |
| **Linux** 64-bit | `...-linux-x86_64.AppImage` or `...-linux-amd64.deb` |
| **Linux** ARM | `...-linux-arm64.AppImage` or `...-linux-arm64.deb` |

> Not sure which Mac you have? Click the  menu → **About This Mac**. If the Chip line says **Apple M1/M2/M3/M4**, take `mac-arm64`. If it says **Intel**, take `mac-x64`.
>
> *Không rõ máy Mac của bạn loại nào? Bấm menu  → **About This Mac**. Dòng Chip ghi **Apple M...** thì tải `mac-arm64`, ghi **Intel** thì tải `mac-x64`.*

---

### First launch / Lần mở đầu tiên

KailaEdit is not code-signed yet, so every platform warns once. *KailaEdit chưa được ký số nên hệ điều hành sẽ cảnh báo ở lần đầu.*

**Windows** — SmartScreen shows "Windows protected your PC": click **More info** → **Run anyway**.

**macOS** — the app is blocked, often with *"KailaEdit is damaged and can't be opened"*. Nothing is damaged; that is the message macOS uses for unsigned downloads. Drag the app to **Applications**, then run this once in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/KailaEdit.app
```

*Ứng dụng không hỏng — đó là thông báo macOS dùng cho app tải về chưa ký. Kéo app vào **Applications** rồi chạy lệnh trên trong Terminal một lần duy nhất.*

**Linux** — `chmod +x` the AppImage, or install the .deb with `sudo apt install ./<file>.deb`.

Full instructions: [English](https://github.com/KailaHQ/KailaEdit/blob/main/docs/en/user-guide/01-getting-started.md) · [Tiếng Việt](https://github.com/KailaHQ/KailaEdit/blob/main/docs/vi/user-guide/01-getting-started.md)
