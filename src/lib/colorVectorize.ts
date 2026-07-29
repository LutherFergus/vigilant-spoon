import { extractColorContours, pathToSvgD, simplifyPath, smoothPath } from './contours'
import type { Point } from './contours'
import { findPmsByCode, nearestPms, snapPaletteToPms } from './pms'
import { denoiseLabels, extractPalette, quantizeImage } from './quantize'
import { labelRegions, mergeSmallRegions } from './regions'
import type { PaletteColor, Rgb } from './types'
import { colorDistance, rgbToHex } from './types'

export type ColorVectorSettings = {
  colorCount: number
  /** Relative min region size as fraction of image area (0.00005–0.01). */
  minRegionRatio: number
  smoothness: number
  maxDim: number
  /** Snap fills to nearest Pantone Solid Coated (PMS) colors. */
  snapToPms: boolean
}

export const DEFAULT_COLOR_VECTOR_SETTINGS: ColorVectorSettings = {
  // Pinheads masters usually land ~6–10 solid fills
  colorCount: 8,
  // Light cleanup — keep small features (stars, eyes) pourable but kill dust
  minRegionRatio: 0.00035,
  // Minimal smoothing so hard metal-ready edges stay sharp
  smoothness: 0,
  maxDim: 1200,
  snapToPms: true,
}

/** Manual per-slot PMS overrides: palette index → PMS code like "185 C". */
export type PmsOverrides = Record<number, string>

export type ColorVectorState = {
  widthPx: number
  heightPx: number
  labels: Uint16Array
  /** Pre-PMS quantized palette (after merges averaged). */
  palette: Rgb[]
  mergeMap: number[]
}

export type ColorVectorResult = {
  svg: string
  svgBlob: Blob
  svgUrl: string
  widthPx: number
  heightPx: number
  palette: PaletteColor[]
  regionCount: number
  state: ColorVectorState
}

/**
 * Scale source into working ImageData. Does NOT punch the subject away —
 * background removal happens after quantize via edge-connected white only.
 */
export function scaleToCanvas(
  source: HTMLImageElement | ImageBitmap,
  maxDim: number,
): ImageData {
  const srcW = 'naturalWidth' in source ? source.naturalWidth : source.width
  const srcH = 'naturalHeight' in source ? source.naturalHeight : source.height
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH))
  const w = Math.max(32, Math.round(srcW * scale))
  const h = Math.max(32, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  // Opaque white underlay so JPEG edges don't get weird alpha
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * After quantize: clear backdrop colors connected to the image border.
 * Handles Pinheads-style plain white OR plain black studio backgrounds.
 * Interior whites/blacks (eyes, metal-look fills) stay if not edge-connected.
 */
export function clearEdgeConnectedBackground(
  labels: Uint16Array,
  palette: Rgb[],
  width: number,
  height: number,
): Uint16Array {
  const bgColors = new Set<number>()
  for (let i = 0; i < palette.length; i++) {
    const { r, g, b } = palette[i]
    const min = Math.min(r, g, b)
    const max = Math.max(r, g, b)
    const chroma = max - min
    // Paper white / cream
    if (min >= 242 && chroma <= 20) bgColors.add(i)
    // Studio pure black backdrop (not mid-grays used as fills)
    if (max <= 18 && chroma <= 12) bgColors.add(i)
  }
  if (bgColors.size === 0) return labels

  const out = new Uint16Array(labels)
  const n = width * height
  const seen = new Uint8Array(n)
  const stack: number[] = []

  const tryPush = (i: number) => {
    if (i < 0 || i >= n || seen[i]) return
    const v = out[i]
    if (v === 0xffff || !bgColors.has(v)) return
    seen[i] = 1
    stack.push(i)
  }

  for (let x = 0; x < width; x++) {
    tryPush(x)
    tryPush((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    tryPush(y * width)
    tryPush(y * width + width - 1)
  }

  while (stack.length) {
    const i = stack.pop()!
    out[i] = 0xffff
    const x = i % width
    const y = (i / width) | 0
    if (x > 0) tryPush(i - 1)
    if (x < width - 1) tryPush(i + 1)
    if (y > 0) tryPush(i - width)
    if (y < height - 1) tryPush(i + width)
  }
  return out
}

function processContour(points: Point[], smoothness: number): Point[] {
  const epsilon = 0.4 + (5 - Math.min(5, smoothness)) * 0.1
  let pts = simplifyPath(points, epsilon)
  if (smoothness > 0) {
    pts = smoothPath(pts, smoothness)
    pts = simplifyPath(pts, Math.max(0.2, epsilon * 0.5))
  }
  return pts
}

function applyMergeMap(labels: Uint16Array, mergeMap: number[]): Uint16Array {
  const out = new Uint16Array(labels.length)
  for (let i = 0; i < labels.length; i++) {
    const v = labels[i]
    out[i] = v === 0xffff ? 0xffff : mergeMap[v] ?? v
  }
  return out
}

function buildMergeMap(colorCount: number, merges: Array<[number, number]>): number[] {
  const map = Array.from({ length: colorCount }, (_, i) => i)
  const find = (i: number): number => {
    let x = i
    while (map[x] !== x) x = map[x]
    return x
  }
  for (const [a, b] of merges) {
    if (a < 0 || b < 0 || a >= colorCount || b >= colorCount) continue
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) map[ra] = rb
  }
  for (let i = 0; i < colorCount; i++) map[i] = find(i)
  return map
}

function averageMergedPalette(palette: Rgb[], labels: Uint16Array, mergeMap: number[]): Rgb[] {
  const pix = palette.map(() => ({ r: 0, g: 0, b: 0, n: 0 }))
  for (let i = 0; i < labels.length; i++) {
    const v = labels[i]
    if (v === 0xffff) continue
    const t = mergeMap[v]
    pix[t].r += palette[v].r
    pix[t].g += palette[v].g
    pix[t].b += palette[v].b
    pix[t].n += 1
  }
  return palette.map((c, i) => {
    if (pix[i].n > 0) {
      return {
        r: Math.round(pix[i].r / pix[i].n),
        g: Math.round(pix[i].g / pix[i].n),
        b: Math.round(pix[i].b / pix[i].n),
      }
    }
    return { ...c }
  })
}

function resolvePaletteColors(
  basePalette: Rgb[],
  usedIndices: number[],
  snapToPms: boolean,
  overrides: PmsOverrides,
): { fillRgb: Rgb[]; meta: PaletteColor[] } {
  const fillRgb = basePalette.map((c) => ({ ...c }))
  const meta: PaletteColor[] = basePalette.map((c, index) => ({
    ...c,
    hex: rgbToHex(c),
    index,
  }))

  if (snapToPms) {
    const snapped = snapPaletteToPms(basePalette, { unique: true })
    for (let i = 0; i < basePalette.length; i++) {
      fillRgb[i] = snapped[i].rgb
      meta[i] = {
        ...snapped[i].rgb,
        hex: snapped[i].match.pms.hex,
        index: i,
        pmsCode: snapped[i].match.pms.code,
        pmsName: snapped[i].match.pms.name,
        pmsDeltaE: Math.round(snapped[i].match.deltaE * 10) / 10,
      }
    }
  } else {
    for (let i = 0; i < basePalette.length; i++) {
      const match = nearestPms(basePalette[i])
      meta[i] = {
        ...basePalette[i],
        hex: rgbToHex(basePalette[i]),
        index: i,
        pmsCode: match.pms.code,
        pmsName: match.pms.name,
        pmsDeltaE: Math.round(match.deltaE * 10) / 10,
      }
    }
  }

  for (const [key, code] of Object.entries(overrides)) {
    const index = Number(key)
    if (!Number.isFinite(index) || index < 0 || index >= basePalette.length) continue
    const pms = findPmsByCode(code)
    if (!pms) continue
    fillRgb[index] = { r: pms.r, g: pms.g, b: pms.b }
    meta[index] = {
      r: pms.r,
      g: pms.g,
      b: pms.b,
      hex: pms.hex,
      index,
      pmsCode: pms.code,
      pmsName: pms.name,
      pmsDeltaE: 0,
    }
  }

  const usedMeta = usedIndices
    .filter((i) => i >= 0 && i < meta.length)
    .sort((a, b) => a - b)
    .map((i) => meta[i])

  return { fillRgb, meta: usedMeta }
}

function stateToSvg(
  labels: Uint16Array,
  fillRgb: Rgb[],
  metaByIndex: Map<number, PaletteColor>,
  widthPx: number,
  heightPx: number,
  smoothness: number,
): { svg: string; regionCount: number } {
  const contoursByColor = extractColorContours(labels, widthPx, heightPx)
  const { regions } = labelRegions(labels, widthPx, heightPx)

  const legend = [...metaByIndex.values()]
    .map(
      (c) =>
        `  ${c.pmsName ?? c.hex} → ${c.hex}${
          c.pmsDeltaE != null ? ` (ΔE ${c.pmsDeltaE})` : ''
        }`,
    )
    .join('\n')

  // Dominant edge color as underlay so no checkerboard holes show through
  let underlay = '#ffffff'
  const edgeCounts = new Map<number, number>()
  for (let x = 0; x < widthPx; x++) {
    const t = labels[x]
    const b = labels[(heightPx - 1) * widthPx + x]
    if (t !== 0xffff) edgeCounts.set(t, (edgeCounts.get(t) ?? 0) + 1)
    if (b !== 0xffff) edgeCounts.set(b, (edgeCounts.get(b) ?? 0) + 1)
  }
  for (let y = 0; y < heightPx; y++) {
    const l = labels[y * widthPx]
    const r = labels[y * widthPx + widthPx - 1]
    if (l !== 0xffff) edgeCounts.set(l, (edgeCounts.get(l) ?? 0) + 1)
    if (r !== 0xffff) edgeCounts.set(r, (edgeCounts.get(r) ?? 0) + 1)
  }
  let bestEdge = -1
  let bestEdgeN = 0
  for (const [idx, n] of edgeCounts) {
    if (n > bestEdgeN) {
      bestEdgeN = n
      bestEdge = idx
    }
  }
  if (bestEdge >= 0 && fillRgb[bestEdge]) {
    underlay = rgbToHex(fillRgb[bestEdge])
  }

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="${widthPx}" height="${heightPx}">`,
    `<!-- PMS Solid Coated palette\n${legend}\n-->`,
    `<rect id="underlay" width="${widthPx}" height="${heightPx}" fill="${underlay}"/>`,
    '<g id="fills">',
  ]

  for (const [colorIndex, contours] of contoursByColor) {
    const fill = rgbToHex(fillRgb[colorIndex] ?? { r: 128, g: 128, b: 128 })
    const meta = metaByIndex.get(colorIndex)
    const pmsAttr = meta?.pmsCode ? ` data-pms="${meta.pmsCode}"` : ''
    for (const contour of contours) {
      const pts = processContour(contour, smoothness)
      const d = pathToSvgD(pts)
      if (!d) continue
      parts.push(`<path fill="${fill}" stroke="none"${pmsAttr} d="${d}" />`)
    }
  }
  parts.push('</g></svg>')

  return { svg: parts.join('\n'), regionCount: regions.length }
}

async function packResult(
  svg: string,
  widthPx: number,
  heightPx: number,
  palette: PaletteColor[],
  regionCount: number,
  state: ColorVectorState,
): Promise<ColorVectorResult> {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  return {
    svg,
    svgBlob,
    svgUrl: URL.createObjectURL(svgBlob),
    widthPx,
    heightPx,
    palette,
    regionCount,
    state,
  }
}

function assemble(
  labels: Uint16Array,
  basePalette: Rgb[],
  widthPx: number,
  heightPx: number,
  smoothness: number,
  snapToPms: boolean,
  overrides: PmsOverrides,
  state: ColorVectorState,
): Promise<ColorVectorResult> {
  const used = new Set<number>()
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== 0xffff) used.add(labels[i])
  }
  const usedIndices = [...used]
  const { fillRgb, meta } = resolvePaletteColors(
    basePalette,
    usedIndices,
    snapToPms,
    overrides,
  )
  const metaByIndex = new Map(meta.map((c) => [c.index, c]))
  const { svg, regionCount } = stateToSvg(
    labels,
    fillRgb,
    metaByIndex,
    widthPx,
    heightPx,
    smoothness,
  )
  return packResult(svg, widthPx, heightPx, meta, regionCount, state)
}


/**
 * Near-black pixels are treated as outline ink — reassign them to neighboring
 * fill colors so the vector plate is *all areas except outline*, fully covered.
 */
function peelOutlineInkToNeighborFills(
  labels: Uint16Array,
  palette: Rgb[],
  width: number,
  height: number,
  passes = 4,
): Uint16Array {
  const isInk = (idx: number) => {
    if (idx === 0xffff) return true
    const c = palette[idx]
    if (!c) return false
    return Math.max(c.r, c.g, c.b) <= 42
  }

  let cur = new Uint16Array(labels)
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint16Array(cur)
    let changed = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (!isInk(cur[i])) continue
        const counts = new Map<number, number>()
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const v = cur[ny * width + nx]
            if (v === 0xffff || isInk(v)) continue
            counts.set(v, (counts.get(v) ?? 0) + 1)
          }
        }
        let best = -1
        let bestN = 0
        for (const [v, n] of counts) {
          if (n > bestN) {
            bestN = n
            best = v
          }
        }
        if (best >= 0) {
          next[i] = best
          changed++
        }
      }
    }
    cur = next
    if (!changed) break
  }
  return cur
}

/**
 * Flat color vectorization — full coverage of every image area except outline ink.
 * No transparent holes in the subject / scene.
 */
export async function vectorizeColors(
  source: HTMLImageElement | ImageBitmap,
  settings: ColorVectorSettings,
  merges: Array<[number, number]> = [],
  overrides: PmsOverrides = {},
): Promise<ColorVectorResult> {
  const imageData = scaleToCanvas(source, settings.maxDim)
  const { width, height } = imageData
  // Extra fill colors help cover small regions without leaving gaps
  const palette = extractPalette(imageData, Math.max(settings.colorCount, 6))
  let labels = quantizeImage(imageData, palette)
  // Outline ink (near-black) becomes neighboring fills so vector = solid areas only
  labels = peelOutlineInkToNeighborFills(labels, palette, width, height, 5)
  labels = denoiseLabels(labels, width, height, 3)
  // Do NOT punch edge backgrounds — user wants ALL areas filled

  const minArea = Math.max(
    8,
    Math.round(width * height * settings.minRegionRatio),
  )
  labels = mergeSmallRegions(labels, width, height, minArea)
  // Second peel after merge (merge can reintroduce black islands)
  labels = peelOutlineInkToNeighborFills(labels, palette, width, height, 2)
  labels = denoiseLabels(labels, width, height, 1)

  const mergeMap = buildMergeMap(palette.length, merges)
  const mergedLabels = applyMergeMap(labels, mergeMap)
  const mergedPalette = averageMergedPalette(palette, labels, mergeMap)

  return assemble(
    mergedLabels,
    mergedPalette,
    width,
    height,
    settings.smoothness,
    settings.snapToPms,
    overrides,
    {
      widthPx: width,
      heightPx: height,
      labels,
      palette,
      mergeMap,
    },
  )
}

/**
 * Re-run SVG assembly after palette merges / PMS overrides without re-quantizing.
 */
export async function applyPaletteMerges(
  state: ColorVectorState,
  merges: Array<[number, number]>,
  smoothness: number,
  snapToPms: boolean,
  overrides: PmsOverrides = {},
): Promise<ColorVectorResult> {
  const mergeMap = buildMergeMap(state.palette.length, merges)
  const mergedLabels = applyMergeMap(state.labels, mergeMap)
  const mergedPalette = averageMergedPalette(state.palette, state.labels, mergeMap)
  return assemble(
    mergedLabels,
    mergedPalette,
    state.widthPx,
    state.heightPx,
    smoothness,
    snapToPms,
    overrides,
    { ...state, mergeMap },
  )
}

export function suggestMerges(palette: PaletteColor[]): Array<[number, number, number]> {
  const pairs: Array<[number, number, number]> = []
  for (let i = 0; i < palette.length; i++) {
    for (let j = i + 1; j < palette.length; j++) {
      pairs.push([palette[i].index, palette[j].index, colorDistance(palette[i], palette[j])])
    }
  }
  return pairs.sort((a, b) => a[2] - b[2])
}
