# Contributing to KailaEdit

Thanks for taking the time to contribute!

> 📖 **Comprehensive Guides**:
> - [English Contributing Guidelines (Full)](en/developer-guide/05-contributing.md)
> - [Hướng dẫn đóng góp chi tiết (Tiếng Việt)](vi/developer-guide/05-contributing.md)
> - [Complete Documentation Hub](README.md)

---

## Getting started (development)

Prereqs:
- Node.js 20+
- pnpm
- Git

Setup:
```bash
pnpm install
```

Run:
```bash
pnpm dev
```

Debug:
```bash
pnpm dev:debug
```

Typecheck:
```bash
pnpm typecheck
```

## What we accept right now

- Bug fixes and small improvements
- Documentation updates
- Small, targeted UI fixes

**Frontend policy:** the frontend is under active refactor. Please avoid large UI/state rewrites for now — open an issue first so we can align on the target direction.

## Proposing larger work

Before starting a larger change (especially frontend architecture/state), please open an issue with:
- The problem you’re trying to solve
- The proposed approach (1–2 paragraphs is fine)
- Scope (areas/files likely to change)
- Any UX or compatibility impact

Wait for maintainer alignment before investing in a major refactor.

## Checks

At minimum, run:

- Type checking:
```bash
pnpm typecheck
```

- Frontend build:
```bash
pnpm build:frontend
```
