/**
 * How KomfyEdit identifies itself to Windows.
 *
 * Windows groups taskbar buttons by AppUserModelID, and the grouping decides
 * which icon the button draws. All three behaviours below were observed on a
 * real desktop while chasing an app that kept showing the Electron logo:
 *
 *   no id at all   the button belongs to the running exe, so an unpackaged run
 *                  is "electron.exe" and shows Electron's icon — whatever icon
 *                  its own window carries.
 *   the app's id   a dev run is folded into the installed KomfyEdit's button
 *                  and inherits that app's icon.
 *   an id of its   nothing to inherit from, so Windows falls back to the
 *   own            icon embedded in the RUNNING EXE — not the window's icon.
 *
 * That last line was wrong for a long time: it claimed Windows falls back to
 * the window icon. Measured 12/09/2026 — Alt+Tab showed the app's "K" while the
 * taskbar button showed Electron's atom, and neither KomfyEdit shortcut
 * declares an AppUserModelID. So an unregistered id sends the button to the
 * executable's own icon, and only Alt+Tab keeps reading the window.
 *
 * The packaged build is therefore correct by accident rather than by design:
 * its fallback is KomfyEdit.exe, which carries the icon. A dev run falls back
 * to node_modules/electron/dist/electron.exe, which carries Electron's — which
 * is what scripts/patch-dev-icon.cjs exists to fix.
 *
 * So a packaged run must claim `appId` — notifications, jump lists and the
 * installer's shortcut are all filed under it — and a dev run must claim
 * something else, or it borrows an identity that is not its own.
 */

/** Must match `appId` in electron-builder.yml. */
export const APP_USER_MODEL_ID = 'com.kailaedit.app'

/** What a dev run calls itself, so it stands beside the installed app. */
export const DEV_APP_USER_MODEL_ID = `${APP_USER_MODEL_ID}.dev`

export function resolveAppUserModelId(isPackaged: boolean): string {
  return isPackaged ? APP_USER_MODEL_ID : DEV_APP_USER_MODEL_ID
}
