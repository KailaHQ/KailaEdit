import { session } from 'electron'
import { isDev } from './config'

// Enforce Content Security Policy via response headers (tamper-proof from renderer)
export function setupCSP(): void {
  // The editor is fully offline: media comes from local files only, so no remote
  // img-src/media-src origins are allowed. Google Fonts is the sole outbound origin.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      // 'wasm-unsafe-eval' lets WebAssembly compile (and nothing else — no eval): without it
      // onnxruntime-web cannot start, so the smart brush's Segment Anything and the preview
      // matte both failed and the smart brush silently fell back to selecting by colour.
      isDev ? "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'" : "script-src 'self' 'wasm-unsafe-eval'",
      isDev
        ? "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
        : "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self'",
      "img-src 'self' data: blob: file:",
      "media-src 'self' blob: file:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
}
