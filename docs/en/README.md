# KailaEdit Documentation (English)

Welcome to the English documentation for **KailaEdit**, the offline desktop video editor with native AI agent integration.

---

## 🧭 Navigation

### 📖 User Guide
Step-by-step guides for video creators, editors, and enthusiasts.

1. **[01. Getting Started](user-guide/01-getting-started.md)**: System requirements, installation, creating projects, importing media.
2. **[02. Interface & Workspace](user-guide/02-interface-and-workspace.md)**: Asset browser, Source/Program dual monitors, inspector, Editor Library panel, App Preferences & Project Settings.
3. **[03. Timeline & Editing](user-guide/03-timeline-and-editing.md)**: Multi-track operations, blade, ripple, roll, slip, slide, magnetic snapping, Gap Actions Popover, Keyframe animation (`◆`), Transitions library, Blend Modes, and graphic Stickers.
4. **[04. Color, Effects & Adjustment Layers](user-guide/04-color-effects-filters.md)**: Curated 3D LUT Filters library (search, favorites, hover preview, intensity slider, apply-to-all), WebGL GPU shader preview with 1:1 FFmpeg parity, manual grading, custom `.cube` LUT imports, and Adjustment Layer deep dive.
5. **[05. Audio & Subtitles](user-guide/05-audio-and-subtitles.md)**: Volume control, Audio Boost (+24dB), Brickwall Limiter, Smart Audio Ducking, offline AI Whisper Auto-Transcription, Text Presets, and SRT import/export.
6. **[06. Export & Delivery](user-guide/06-export-and-delivery.md)**: Rendering with offline FFmpeg, H.264/ProRes/VP9, GPU Hardware Acceleration (NVENC, QuickSync, VideoToolbox), 4K/8K Proxy workflow & Render Cache, Batch Render Queue, and Chapter Markers.
7. **[07. CoEdit AI Assistant](user-guide/07-coedit-ai-assistant.md)**: Connecting local CLI models (Claude Code, Antigravity, Codex) via MCP, Live in-memory UI Sync, Auto Highlight Extraction, Contextual B-Roll Copilot, Whisper transcription, and complete 22 MCP Tools reference table.

---

### 💻 Developer Guide
Architecture, development practices, and contribution standards for engineers.

1. **[01. Architecture Overview](developer-guide/01-architecture-overview.md)**: Electron main process, React 18 renderer, Zod-typed IPC bridge, FFmpeg pipeline.
2. **[02. Development Setup](developer-guide/02-setup-and-workflow.md)**: Installing dependencies, running dev mode, debugging, building platform installers.
3. **[03. State & Editor Store](developer-guide/03-state-and-editor-store.md)**: Zustand store conventions, memoized selectors, domain actions, snapshot undo/redo.
4. **[04. MCP Server & Skills](developer-guide/04-mcp-server-and-skills.md)**: Model Context Protocol tools, `EditPatch` schema, invariant skill benchmark evaluation.
5. **[05. Contributing Guidelines](developer-guide/05-contributing.md)**: Code style, pull request workflow, issue templates, community standards.
6. **[06. Releasing & Auto-Updates](developer-guide/06-releasing-and-updates.md)**: Tag-driven GitHub Releases, the four-runner build matrix, and how the in-app updater behaves.

---

## ⚖️ Acknowledgements & Terms of Use

- **Acknowledgements**: KailaEdit's codebase references and adapts foundational architecture from [LTX Desktop](https://github.com/Lightricks/LTX-Desktop) by Lightricks Ltd. (licensed under Apache-2.0). Upstream notices and attribution are preserved in [NOTICES.md](../../NOTICES.md) and [LICENSE.txt](../../LICENSE.txt).
- **Free for Non-Commercial Use**: KailaEdit is provided completely free of charge for personal, research, and non-commercial workflows. Commercial distribution or monetization is prohibited without prior written permission.
- **License**: Core software is licensed under the [Apache-2.0 License](../../LICENSE.txt).

---

[← Back to Central Documentation Portal](../README.md) · [Xem phiên bản Tiếng Việt →](../vi/README.md)
