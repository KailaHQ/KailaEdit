/**
 * What the two Remove BG edge sliders mean.
 *
 * This lives in core, shared by the preview shader and the export filtergraph, because
 * the two used to define them independently and ended up moving in OPPOSITE directions:
 *
 * - Preview ran `smoothstep(clean, 1 - feather, alpha)`. Raising `featherEdge` lowered the
 *   top of the band, so alpha 0.5 snapped to 1.0 — the edge got HARDER and the subject
 *   grew. Measured at `featherEdge: 50`, alpha 0.4 came out at 0.90.
 * - Export ran `erosion` (a morphological shrink, N whole pixels) for clean and
 *   `gblur` for feather. Raising `featherEdge` there widened the transition band from
 *   2.18% of the frame to 3.76% — the edge got SOFTER, as the name says.
 *
 * So the same slider sharpened what you were looking at and softened what you shipped,
 * and neither behaviour matched its label. Both sides now derive their numbers here.
 *
 * Neither control does anything at 0, which is what every existing project uses.
 */

/** The alpha range that survives `cleanEdge`, as a 0..1 band. */
export interface MatteAlphaBand {
  /** Alpha at or below this becomes fully transparent. */
  lo: number
  /** Alpha at or above this becomes fully opaque. */
  hi: number
}

/**
 * How `cleanEdge` remaps alpha.
 *
 * It raises the floor: everything below `lo` is background, and what is left is stretched
 * back over the full range. That both removes the halo of half-transparent background
 * clinging to the subject AND narrows the transition — on a real 1080x1920 matte the
 * model leaves a band about 11 pixels wide, and this is the control that tightens it.
 *
 * `hi` stays at 1 so the subject's own solid interior is never touched.
 *
 * Deliberately a pointwise function of alpha, so the preview can apply it per fragment
 * and ffmpeg can apply it as a `lut`, with no spatial term to disagree about.
 */
export function matteAlphaBand(cleanEdge: number | undefined): MatteAlphaBand {
  const clean = Math.max(0, Math.min(100, cleanEdge ?? 0)) / 100
  const lo = clean * 0.5
  return { lo, hi: 1 }
}

/**
 * How `featherEdge` softens, in pixels of the matte.
 *
 * Softening is genuinely spatial — a pointwise curve can sharpen an existing gradient but
 * can never spread a hard edge over more pixels — so this is a real blur on both sides.
 * The scale is the one the export filtergraph already used, so exports of existing
 * projects are unchanged.
 */
export function matteFeatherSigma(featherEdge: number | undefined): number {
  const feather = Math.max(0, Math.min(100, featherEdge ?? 0))
  return feather / 10
}

/** Whether `cleanEdge` would change anything, i.e. whether it is worth applying at all. */
export function hasMatteClean(cleanEdge: number | undefined): boolean {
  return matteAlphaBand(cleanEdge).lo > 0
}

/** Whether `featherEdge` would change anything. */
export function hasMatteFeather(featherEdge: number | undefined): boolean {
  return matteFeatherSigma(featherEdge) > 0
}

/**
 * The remap itself, for tests and for anything that needs it on the CPU.
 *
 * The shader and the ffmpeg `lut` both compute this same expression; keeping a reference
 * implementation here is what lets a test assert they agree.
 */
export function applyMatteAlphaBand(alpha: number, band: MatteAlphaBand): number {
  const span = Math.max(1e-6, band.hi - band.lo)
  return Math.max(0, Math.min(1, (alpha - band.lo) / span))
}
