/**
 * One 256×256 grey H.264 keyframe, Annex B (SPS, PPS, IDR). Its picture is of no interest:
 * decoding it is only a reason to bring the hardware decoder up.
 */
const WARMUP_KEYFRAME_BASE64 =
  'AAAAAWdCwB7ZAQCGwEQAAAMABAAAAwAIPFi5IAAAAAFoy4PLIAAAAQYF//9s3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzE3MiBjMWM5OTMxIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MToweDExMSBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTggbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAWWIhAV8mKAAIFsnJycnJycnJycnJycnJyddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddeA'

/** The first hardware decoder of a process takes the better part of a second to come up. */
let warmup: Promise<void> | null = null

/**
 * Brings the hardware video decoder up ahead of need, by decoding one tiny frame.
 *
 * The first decoder a process creates pays for starting the GPU's decode path — about 0.7 s
 * here, and a project's first frame waited on it. Called while the home screen is up, the
 * cost is paid where nobody is looking. Safe to call repeatedly; never throws.
 */
export function warmUpVideoDecoder(): Promise<void> {
  if (warmup) return warmup
  warmup = (async () => {
    if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') return
    try {
      const config: VideoDecoderConfig = {
        codec: 'avc1.42c01e',
        codedWidth: 256,
        codedHeight: 256,
        hardwareAcceleration: 'prefer-hardware',
      }
      if (!(await VideoDecoder.isConfigSupported(config)).supported) return
      const bytes = Uint8Array.from(atob(WARMUP_KEYFRAME_BASE64), c => c.charCodeAt(0))
      await new Promise<void>((resolve) => {
        const decoder = new VideoDecoder({
          output: frame => frame.close(),
          error: () => resolve(),
        })
        decoder.configure(config)
        decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: 0, data: bytes }))
        decoder.flush()
          .catch(() => {})
          .finally(() => {
            try { decoder.close() } catch { /* already closed */ }
            resolve()
          })
      })
    } catch {
      // A machine that cannot warm up simply pays the cost later.
    }
  })()
  return warmup
}
