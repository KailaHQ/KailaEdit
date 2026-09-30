import { describe, expect, it } from 'vitest'
import { decodeRegionMask, encodeRegionMask, smartSelect } from '../src/smart-select'
import { rasterizeStrokes } from '../src/custom-matte'

const W = 96
const H = 64

function frame(fill: (x: number, y: number) => [number, number, number]) {
  const rgba = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fill(x, y)
      const i = (y * W + x) * 4
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255
    }
  }
  return rgba
}

function dot(x: number, y: number, radius = 2) {
  const seeds = new Uint8Array(W * H)
  for (let j = -radius; j <= radius; j++) {
    for (let i = -radius; i <= radius; i++) {
      if (i * i + j * j <= radius * radius) seeds[(y + j) * W + (x + i)] = 255
    }
  }
  return seeds
}

const inDisc = (x: number, y: number, cx: number, cy: number, r: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r

function score(mask: Uint8Array, truth: (x: number, y: number) => boolean) {
  let inside = 0
  let insideHit = 0
  let outsideHit = 0
  let outside = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const on = mask[y * W + x] > 127
      if (truth(x, y)) { inside++; if (on) insideHit++ } else { outside++; if (on) outsideHit++ }
    }
  }
  return { recall: insideHit / inside, leak: outsideHit / outside }
}

describe('smartSelect', () => {
  it('grows a few painted points into the whole orange, shading and highlight included', () => {
    const truth = (x: number, y: number) => inDisc(x, y, 48, 32, 20)
    const rgba = frame((x, y) => {
      if (!truth(x, y)) return [70 + ((x + y) % 3), 110, 130] // a plain, slightly noisy backdrop
      // Orange, lit from the upper left: lighter there, darker toward the lower right.
      const light = 1.1 - ((x - 28) + (y - 12)) / 180
      const r = Math.min(255, 235 * light)
      const g = Math.min(255, 125 * light)
      const b = Math.min(255, 25 * light)
      return [r, g, b]
    })
    const mask = smartSelect({ width: W, height: H, rgba, seeds: dot(42, 30) })
    const { recall, leak } = score(mask, truth)
    expect(recall).toBeGreaterThan(0.93)
    expect(leak).toBeLessThan(0.02)
  })

  it('selects a whole person, in every colour they wear, when the subject matte is known', () => {
    // A figure in three colours beside a second, separate figure.
    const person = (x: number, y: number) =>
      inDisc(x, y, 30, 14, 7) || (x >= 20 && x <= 40 && y >= 22 && y <= 62)
    const other = (x: number, y: number) => x >= 66 && x <= 88 && y >= 20 && y <= 60
    const rgba = frame((x, y) => {
      if (inDisc(x, y, 30, 14, 7)) return [222, 170, 140] // skin
      if (x >= 20 && x <= 40 && y >= 22 && y <= 40) return [190, 40, 40] // shirt
      if (x >= 20 && x <= 40 && y > 40 && y <= 62) return [40, 60, 170] // trousers
      if (other(x, y)) return [60, 160, 70]
      return [235, 235, 225]
    })
    const subject = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) subject[y * W + x] = person(x, y) || other(x, y) ? 255 : 0

    const withMatte = smartSelect({ width: W, height: H, rgba, seeds: dot(30, 30), subject })
    const found = score(withMatte, person)
    expect(found.recall).toBeGreaterThan(0.95)
    // The second figure is a different subject: it is not swept in.
    expect(withMatte[40 * W + 77]).toBe(0)

    // Without the matte the same points can only follow the shirt's colour.
    const colourOnly = smartSelect({ width: W, height: H, rgba, seeds: dot(30, 30) })
    expect(score(colourOnly, person).recall).toBeLessThan(0.6)
  })

  it('does not run away through a soft outline: it backs off instead of taking the whole frame', () => {
    const rgba = frame((x, y) => {
      const v = 30 + (x + y) * 1.4 // one long ramp over everything, with no outline anywhere
      return [v, v, v]
    })
    const mask = smartSelect({ width: W, height: H, rgba, seeds: dot(48, 32) })
    let on = 0
    for (const v of mask) if (v > 127) on++
    expect(on).toBeLessThan(W * H * 0.75)
  })

  it('returns nothing when nothing is painted', () => {
    const rgba = frame(() => [10, 10, 10])
    expect(smartSelect({ width: W, height: H, rgba, seeds: new Uint8Array(W * H) }).every(v => v === 0)).toBe(true)
  })
})

describe('smartSelect with a rough subject matte', () => {
  it('drops the thin fringe of a rough matte and specks of background, keeping the body', () => {
    const body = (x: number, y: number) => x >= 30 && x <= 60 && y >= 10 && y <= 55
    const rgba = frame((x, y) => (body(x, y) ? [200, 150, 130] : [220, 200, 190]))
    const subject = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (body(x, y)) subject[y * W + x] = 255
    // A one-pixel bridge to a speck of background, as a soft first-pass matte leaves.
    for (let x = 61; x <= 70; x++) subject[30 * W + x] = 255
    for (let y = 26; y <= 34; y++) for (let x = 71; x <= 76; x++) subject[y * W + x] = 255
    const mask = smartSelect({ width: W, height: H, rgba, seeds: dot(45, 30), subject })
    expect(mask[30 * W + 74]).toBe(0) // the speck is not swept in
    expect(mask[30 * W + 45]).toBeGreaterThan(200) // the body is
    expect(score(mask, body).recall).toBeGreaterThan(0.93)
  })

  it('ignores a matte that claims almost the whole frame', () => {
    const rgba = frame((x, y) => (inDisc(x, y, 48, 32, 12) ? [230, 120, 20] : [60, 100, 140]))
    const subject = new Uint8Array(W * H).fill(255)
    const mask = smartSelect({ width: W, height: H, rgba, seeds: dot(48, 32), subject })
    expect(score(mask, (x, y) => inDisc(x, y, 48, 32, 12)).leak).toBeLessThan(0.02)
  })
})

describe('smartSelect: a patch of wall the matte let through', () => {
  it('removes a wall-coloured patch joined to the person, and keeps every colour of the person', () => {
    const person = (x: number, y: number) =>
      inDisc(x, y, 48, 16, 9) || (x >= 34 && x <= 62 && y >= 26 && y <= 62)
    // A patch of wall against the head, wide enough to survive a thin clean-up.
    const patch = (x: number, y: number) => x >= 8 && x <= 40 && y >= 2 && y <= 22 && !person(x, y)
    const rgba = frame((x, y) => {
      if (inDisc(x, y, 48, 16, 9)) return [40, 28, 26] // dark hair
      if (x >= 34 && x <= 62 && y >= 26 && y <= 40) return [215, 165, 140] // skin
      if (x >= 34 && x <= 62 && y > 40 && y <= 62) return [225, 232, 215] // pale shirt
      return [150 + (x % 5), 105 + (y % 4), 95] // warm brown wall, slightly noisy
    })
    const subject = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) subject[y * W + x] = person(x, y) || patch(x, y) ? 255 : 0

    const mask = smartSelect({ width: W, height: H, rgba, seeds: dot(48, 16, 3), subject })
    const found = score(mask, person)
    expect(found.recall).toBeGreaterThan(0.93)
    // The patch belongs to the wall: it is gone.
    let patchOn = 0
    let patchTotal = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (patch(x, y)) { patchTotal++; if (mask[y * W + x] > 127) patchOn++ }
    expect(patchOn / patchTotal).toBeLessThan(0.1)
  })
})

describe('stored selections', () => {
  it('survive encoding and come back as the same coverage', () => {
    const mask = new Uint8Array(W * H)
    for (let y = 10; y < 40; y++) for (let x = 20; x < 70; x++) mask[y * W + x] = x % 7 === 0 ? 128 : 255
    const region = encodeRegionMask(mask, W, H)
    expect(region.rle.length).toBeLessThan(2000)
    expect(Array.from(decodeRegionMask(region))).toEqual(Array.from(mask))
  })

  it('are what a smart stroke rasterizes to, at any size', () => {
    const mask = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) mask[y * W + x] = 255 // the left half
    const stroke = { mode: 'region-brush' as const, size: 5, points: [[0.1, 0.5] as [number, number]], paintedAt: 0, region: encodeRegionMask(mask, W, H) }
    const { brushMask } = rasterizeStrokes([stroke], 200, 100)
    expect(brushMask[50 * 200 + 20]).toBe(255)
    expect(brushMask[50 * 200 + 180]).toBe(0)
  })
})
