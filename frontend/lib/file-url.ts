/**
 * A path that is not absolute does not name a file on disk — it names an asset
 * shipped inside the app, like `stickers/fire.png`. Those live under `public/`,
 * so the renderer reaches them relative to the page. Sending one through
 * `file://` resolves it against the root of the drive instead, which loads
 * nothing and shows nothing: that is why a sticker was missing from the
 * preview even though its clip sat on the timeline.
 */
function isBundledAssetPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return false
  if (/^[a-zA-Z]:\//.test(normalized)) return false
  return true
}

function encodePathSegments(path: string): string {
  return path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

/**
 * Converts a filesystem path to a properly encoded URL the renderer can load.
 *
 *   /Users/me/my file.mp4   → file:///Users/me/my%20file.mp4
 *   C:\Users\me\video#1.mp4 → file:///C%3A/Users/me/video%231.mp4
 *   stickers/fire.png       → ./stickers/fire.png
 */
export function pathToFileUrl(filePath: string): string {
  if (!filePath) return ''
  if (filePath.startsWith('data:') || filePath.startsWith('blob:') || filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath
  }
  const normalized = filePath.replace(/\\/g, '/')

  if (isBundledAssetPath(filePath)) {
    return './' + encodePathSegments(normalized)
  }

  // Ensure leading slash (Windows drive letters like C:/ need one prepended)
  const withLeadingSlash = normalized.startsWith('/') ? normalized : '/' + normalized

  return 'file://' + encodePathSegments(withLeadingSlash)
}
