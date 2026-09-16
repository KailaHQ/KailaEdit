# Releasing & Auto-Updates

KailaEdit ships installers through **GitHub Releases**, and the app checks for new versions itself using [`electron-updater`](https://www.electron.build/auto-update). This page covers how a release is cut, what CI produces, and how the in-app updater behaves.

---

## 🚀 Cutting a Release

The single source of truth for the version number is the `version` field in `package.json`. The tag must match it — CI refuses to build otherwise, because a mismatch produces installers whose update metadata points at a version nobody can find.

```bash
# 1. Bump "version" in package.json (e.g. 1.0.0 -> 1.0.1)
# 2. Commit the bump
git commit -am "Release v1.0.1"

# 3. Tag and push
git tag v1.0.1
git push origin main --tags
```

Pushing a `v*` tag triggers [`.github/workflows/release.yml`](../../../.github/workflows/release.yml):

| Stage | What it does |
|---|---|
| **verify** | Checks the tag against `package.json`, then runs `pnpm typecheck` and `pnpm test:run` |
| **build** | Packages on four runners in parallel (see the matrix below) |
| **publish** | Uploads every installer plus the `latest*.yml` update manifests to a **draft** GitHub Release |

### Dry Runs

Triggering the workflow manually (**Actions → Release → Run workflow**) builds every platform but publishes nothing. The installers are attached to the workflow run itself, so you can download and test them without minting a version or touching the Releases page. Use this to validate a packaging change before tagging.

The tag/version check is skipped on a manual run — outside a tag push `GITHUB_REF_NAME` is the branch name, which will never look like a version.

---

### Draft or Published

By default the workflow leaves the release as a **draft**, visible only to repository collaborators and invisible to `electron-updater`. Nothing reaches users until you publish it by hand.

To skip that review step, tag with `-Live`:

```powershell
.\publish-release.ps1 next "Hotfix for the export crash" -Live
```

The switch travels to CI inside the annotated tag message as `[live]`; the workflow reads it and flips `publish.releaseType` in `electron-builder.yml` from `draft` to `release` before building. Anything without the marker stays a draft, and the marker is read on a best-effort basis so a failure to read it also lands on draft.

Use `-Live` only for releases you are confident in. A published release cannot be recalled from clients that have already started downloading it, and unlike a draft there is no moment to notice that, say, the Linux job dropped its `latest-linux.yml`.

The draft is **not** published automatically. Open the Releases tab, confirm every artifact is present, then click **Publish release** — clients only see the new version after that. A bad release that is already public cannot be recalled from machines that have started downloading it.

---

## 🏗️ Build Matrix

| Job | Runner | Artifacts (for version 1.2.0) |
|---|---|---|
| `windows-x64` | `windows-latest` | `KailaEdit-1.2.0-win-x64-Setup.exe` |
| `macos-arm64-and-x64` | `macos-latest` | `KailaEdit-1.2.0-mac-arm64.dmg` / `.zip` (Apple Silicon), `KailaEdit-1.2.0-mac-x64.dmg` / `.zip` (Intel) |
| `linux-x64` | `ubuntu-latest` | `KailaEdit-1.2.0-linux-x86_64.AppImage`, `KailaEdit-1.2.0-linux-amd64.deb` |
| `linux-arm64` | `ubuntu-24.04-arm` | `KailaEdit-1.2.0-linux-arm64.AppImage`, `KailaEdit-1.2.0-linux-arm64.deb` |

Because the version is part of the filename, there is no stable `releases/latest/download/...` link to hand out. Point people at the Releases page instead, and GitHub will offer them the newest assets.

The macOS names must keep the literal string `arm64`. `MacUpdater.filterFilesForArch` picks between the two builds by searching for it in the filename, so a friendlier label like `mac-mx` would leave an Intel Mac free to auto-update itself onto an Apple Silicon build it cannot run. The arch tokens elsewhere (`x86_64` for AppImage, `amd64` for deb) are the conventions those formats expect, and electron-builder chooses them.

The macOS `.zip` files are not redundant: `electron-updater` installs macOS updates from the zip, not the dmg. Removing them breaks updating on macOS.

---

## 🧩 Why macOS Builds Both Architectures in One Job

macOS has a **single** `latest-mac.yml` covering both architectures. `MacUpdater` decides between the arm64 and the x64 zip by looking for `arm64` in the filenames listed inside it, and that file only lists both when **one** `electron-builder` invocation produces both. Splitting macOS into two jobs would make the second job overwrite the first job's `latest-mac.yml`, silently removing one architecture's update channel.

Linux is the opposite case: `electron-builder` emits a separate `latest-linux-arm64.yml`, so each architecture gets its own manifest and building on a native arm64 runner is both cheaper and safer than cross-packing.

### The FFmpeg Consequence

Because the Intel macOS app is cross-packed on an Apple Silicon runner, it inherits a problem: `ffmpeg-static` downloads exactly **one** binary at install time, chosen by the *build machine's* architecture. Left alone, the Intel build would ship an arm64 FFmpeg and fail at every export on real Intel Macs — with nothing in CI to catch it.

[`scripts/ffmpeg-per-arch.cjs`](../../../scripts/ffmpeg-per-arch.cjs) runs as an `afterPack` hook. It fetches the FFmpeg binary matching the architecture being packed and swaps it into the app bundle, and does nothing when the packed architecture already matches the builder. It aborts the build on a short or failed download rather than let an installer ship with a broken exporter.

`@resvg/resvg-js` has the same platform-and-architecture split, solved differently: `pnpm.supportedArchitectures.cpu` in `package.json` lists both `x64` and `arm64` so pnpm installs both native packages.

---

## 🔄 How the In-App Updater Behaves

All of it lives in [`electron/updater.ts`](../../../electron/updater.ts).

- **Packaged builds only.** `electron-builder` writes the publish target into `app-update.yml` inside the packaged app, and that file is the only place `electron-updater` reads it from. A dev run has no such file, so every entry point returns early. This is deliberate, not an oversight.
- **Silent check 8 seconds after launch.** If there is no update, nothing is shown at all.
- **Downloads are opt-in** (`autoDownload = false`). When an update exists the app asks first: **Download / Release notes / Later**. Downloading without asking is unkind on a metered connection, and worse while someone is exporting a video.
- **Install is opt-in too.** Once downloaded, the app offers **Restart now** or **Install on quit** (`autoInstallOnAppQuit`).
- **Manual check** via **Help → Check for Updates...**. Unlike the startup check, this one also reports when you are already up to date, and surfaces errors.
- Download progress appears on the taskbar / dock via `setProgressBar`.

Every prompt is a native `dialog` built in the main process, so the renderer has nothing to draw.

---

## 🔏 Code Signing Status

KailaEdit is currently **not code-signed**. CI sets `CSC_IDENTITY_AUTO_DISCOVERY: false` so builds do not fail looking for credentials. What that means per platform:

| Platform | Installation | Auto-update |
|---|---|---|
| **Windows** | SmartScreen warns; users click *More info → Run anyway* | ✅ Works |
| **Linux** | Unaffected | ✅ Works (AppImage) |
| **macOS** | Gatekeeper blocks; users must right-click → Open on first launch | ❌ **Does not work** — `electron-updater` refuses to install unsigned builds |

macOS users therefore have to download each new `.dmg` manually until a Developer ID certificate is in place.

### Hardened Runtime must stay off until then

`mac.hardenedRuntime` is set to `false` on purpose. arm64 binaries must carry a signature, so with no certificate electron-builder falls back to an **ad-hoc** signature (`macPackager.ts`, `fallBackToAdhoc`). An ad-hoc signature has no Team ID, and Hardened Runtime enforces library validation — a process may only load libraries signed by the same team. KailaEdit loads `@resvg/resvg-js`'s native `.node` binding and spawns the bundled ffmpeg, both signed separately, so the app is killed at launch on Apple Silicon. macOS shows the generic *"Check with the developer to make sure KailaEdit works with this version of macOS"* dialog; the crash report underneath names the real cause:

```
Termination Reason: Namespace DYLD, Code 1, Library missing
Library not loaded: @rpath/Electron Framework.framework/Electron Framework
Reason: ... code signature ... not valid for use in process:
        mapping process and mapped file (non-platform) have different Team IDs
```

with `"codeSigningTeamID" : ""` — the empty Team ID of an ad-hoc signature. That "different Team IDs" wording is library validation talking, and library validation is only switched on by Hardened Runtime.

Hardened Runtime exists to satisfy notarization; without a Developer ID it buys nothing. `resources/entitlements.mac.plist` already carries the three entitlements that build will need (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`), so turning it back on is a one-line change made together with `notarize: true`.

Enabling signing means adding a Windows code-signing certificate (or Azure Trusted Signing) and an Apple Developer ID plus notarization, then wiring the secrets into `release.yml`.

---

## 🛠️ Building Locally

```bash
pnpm build:dir     # Unpacked app in release/, fastest for a smoke test
pnpm build         # Full installers for the current platform, no publishing
pnpm release       # Full installers AND publish — CI uses this path
```

`pnpm release` requires a `GH_TOKEN` and will push artifacts to a GitHub Release, so avoid it locally unless that is exactly what you intend.
