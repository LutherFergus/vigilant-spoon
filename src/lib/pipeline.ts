import {
  applyPaletteMerges,
  DEFAULT_COLOR_VECTOR_SETTINGS,
  vectorizeColors,
  type ColorVectorResult,
  type ColorVectorSettings,
  type PmsOverrides,
} from './colorVectorize'
import {
  DEFAULT_OUTLINE_SETTINGS,
  extractOutlinePng,
  type OutlineResult,
  type OutlineSettings,
} from './outline'

export type DualOutputSettings = {
  outline: OutlineSettings
  vector: ColorVectorSettings
}

export const DEFAULT_DUAL_SETTINGS: DualOutputSettings = {
  outline: { ...DEFAULT_OUTLINE_SETTINGS },
  vector: { ...DEFAULT_COLOR_VECTOR_SETTINGS },
}

export type ProofResult = {
  pngBlob: Blob
  pngUrl: string
  widthPx: number
  heightPx: number
}

export type DualOutputResult = {
  outline: OutlineResult
  vector: ColorVectorResult
  /** Flat fills + outline stacked — final pin proof. */
  proof: ProofResult
}

/**
 * Elephant jack-in-box style pipeline:
 * 1) Flat color vector from source
 * 2) Outline plate from source
 * 3) Proof = vector fills under outline lines
 */
export async function createDualOutputs(
  source: HTMLImageElement | ImageBitmap,
  settings: DualOutputSettings,
  merges: Array<[number, number]> = [],
  overrides: PmsOverrides = {},
): Promise<DualOutputResult> {
  const [vector, outline] = await Promise.all([
    vectorizeColors(source, settings.vector, merges, overrides),
    extractOutlinePng(source, {
      ...settings.outline,
      maxDim: Math.max(settings.outline.maxDim, settings.vector.maxDim, 1200),
    }),
  ])

  const proof = await compositeProof(vector.svgUrl, outline.pngUrl, {
    width: Math.max(vector.widthPx, outline.widthPx),
    height: Math.max(vector.heightPx, outline.heightPx),
  })

  return { outline, vector, proof }
}

/** Stack vector fills (bottom) + outline strokes (top) on white. */
export async function compositeProof(
  vectorSvgUrl: string,
  outlinePngUrl: string,
  size: { width: number; height: number },
): Promise<ProofResult> {
  const w = Math.max(32, size.width)
  const h = Math.max(32, size.height)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  const [fills, lines] = await Promise.all([
    loadHtmlImage(vectorSvgUrl),
    loadHtmlImage(outlinePngUrl),
  ])
  ctx.drawImage(fills, 0, 0, w, h)
  ctx.drawImage(lines, 0, 0, w, h)

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode proof PNG'))),
      'image/png',
    )
  })

  return {
    pngBlob,
    pngUrl: URL.createObjectURL(pngBlob),
    widthPx: w,
    heightPx: h,
  }
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load layer for proof'))
    img.src = url
  })
}

export async function remergeVector(
  previous: DualOutputResult,
  merges: Array<[number, number]>,
  smoothness: number,
  snapToPms: boolean,
  overrides: PmsOverrides = {},
): Promise<DualOutputResult> {
  const vector = await applyPaletteMerges(
    previous.vector.state,
    merges,
    smoothness,
    snapToPms,
    overrides,
  )
  URL.revokeObjectURL(previous.vector.svgUrl)
  URL.revokeObjectURL(previous.proof.pngUrl)

  const proof = await compositeProof(vector.svgUrl, previous.outline.pngUrl, {
    width: Math.max(vector.widthPx, previous.outline.widthPx),
    height: Math.max(vector.heightPx, previous.outline.heightPx),
  })

  return {
    outline: previous.outline,
    vector,
    proof,
  }
}

export function revokeDualUrls(result: DualOutputResult | null) {
  if (!result) return
  URL.revokeObjectURL(result.outline.pngUrl)
  URL.revokeObjectURL(result.vector.svgUrl)
  URL.revokeObjectURL(result.proof.pngUrl)
}
