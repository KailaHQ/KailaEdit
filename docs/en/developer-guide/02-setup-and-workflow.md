# Development Setup & Workflow

This document guides engineers on setting up their local workstation, running the developer environment, and building release installers.

---

## 💻 Prerequisites

Ensure you have the following installed on your workstation:
- **Node.js**: `v20.x` or `v22.x` (LTS recommended)
- **pnpm**: Fast, disk-space efficient package manager (`corepack enable` or `npm install -g pnpm`)
- **Git**: For source version control
- **C/C++ Build Tools** (Optional, only needed if compiling native modules):
  - Windows: Visual Studio Build Tools with Desktop C++
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Linux: `build-essential`

---

## 📦 Getting Started

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/KailaHQ/KailaEdit.git kailaedit
   cd kailaedit
   ```

2. **Install Dependencies**:
   ```bash
   pnpm install
   ```

3. **Start Development Environment**:
   ```bash
   pnpm dev
   ```
   This concurrently spins up Vite's Hot Module Replacement (HMR) server for the React frontend and launches the Electron shell with source maps attached.

4. **Launch with Electron DevTools & Inspector**:
   ```bash
   pnpm dev:debug
   ```

---

## 🛠️ Key Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Starts Vite HMR and launches Electron. |
| `pnpm dev:debug` | Starts dev environment with remote Electron inspector port opened. |
| `pnpm typecheck` | Runs `tsc --noEmit` on `frontend/` and `shared/`. |
| `pnpm build:frontend` | Compiles production-ready frontend bundle via Vite. |
| `pnpm build:dir` | Packages an unpacked application directory (fastest way to test packaging). |
| `pnpm build` | Compiles and builds complete platform distribution installers (`.exe`, `.dmg`, `.AppImage`). |
| `pnpm eval:skills` | Executes the automated AI Skill Evaluation harness. |

---

## 🔍 Typechecking Rules

Because Electron code is compiled by esbuild during Vite builds, `pnpm typecheck` covers the `frontend/` and `shared/` workspaces. To explicitly typecheck the Electron main process:

```bash
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop electron/*.ts electron/ipc/*.ts electron/export/*.ts
```

---

[← Previous: 01. Architecture Overview](01-architecture-overview.md) · [Next: 03. State & Editor Store →](03-state-and-editor-store.md)
