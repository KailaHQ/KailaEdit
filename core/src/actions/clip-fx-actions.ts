/**
 * Clip FX, Matte, Media, and Cinematic Actions
 *
 * Facade re-exporting modular action handlers:
 * - clip-matte-actions: mask, chroma key, auto/custom matte, stroke, blend mode, stabilization
 * - clip-filter-effect-actions: filters (LUTs) and video effects
 * - clip-media-actions: stickers, sound effects (SFX), and B-roll insertion
 * - clip-cinematic-actions: freeze frame, punch-in, highlight short, templates
 */

export * from './clip-matte-actions'
export * from './clip-filter-effect-actions'
export * from './clip-media-actions'
export * from './clip-cinematic-actions'
