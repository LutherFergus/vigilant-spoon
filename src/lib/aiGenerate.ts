/**
 * AI image generation (Imagine-style batch).
 *
 * Goal: flat-color illustration with clean black outlines separating regions —
 * artwork used as a *proof* for a pin, NOT a pin product photo, NOT a sticker
 * mockup. Downstream tools handle outline extract + vector quantize.
 */

import pinheadsStyle from '../data/pinheads-style.json'

export type PinheadsTheme =
  | 'attitude'
  | 'patriotism'
  | 'scally'
  | 'horror'
  | 'animals'
  | 'holiday'
  | 'sports'

export type Framing = 'full-body' | 'torso' | 'scene'

export type AiGenerateOptions = {
  prompt: string
  width?: number
  height?: number
  seed?: number
  themes?: PinheadsTheme[]
  framing?: Framing
}

export type AiCandidate = {
  id: string
  image: HTMLImageElement
  objectUrl: string
  prompt: string
  finalPrompt: string
  seed: number
  index: number
}

export type AiGenerateResult = {
  image: HTMLImageElement
  objectUrl: string
  prompt: string
  finalPrompt: string
}

export const PINHEADS_THEMES: Array<{ id: PinheadsTheme; label: string }> = [
  { id: 'attitude', label: 'Attitude' },
  { id: 'patriotism', label: 'Patriotism' },
  { id: 'scally', label: 'Scally / Hooligan' },
  { id: 'horror', label: 'Horror' },
  { id: 'animals', label: 'Attitude animals' },
  { id: 'holiday', label: 'Holiday' },
  { id: 'sports', label: 'Sports' },
]

export const FRAMING_OPTIONS: Array<{ id: Framing; label: string; hint: string }> = [
  { id: 'full-body', label: 'Full body', hint: 'Head to toe character' },
  { id: 'torso', label: 'Torso', hint: 'Waist-up / ¾ figure' },
  { id: 'scene', label: 'Scene', hint: 'Character + props / setting' },
]

/** Default batch size — fewer slots = fewer free-host failures */
export const DEFAULT_BATCH_COUNT = 6

const THEME_HINTS: Record<PinheadsTheme, string> = {
  attitude: 'tough swagger, rebellious humor',
  patriotism: 'patriotic Americana, red white blue',
  scally: 'scally flat cap hooligan culture',
  horror: 'horror mascot with attitude, macabre humor',
  animals: 'tough anthropomorphic animal mascot',
  holiday: 'holiday character with attitude, not cutesy',
  sports: 'sports swagger mascot',
}

const FRAMING_HINTS: Record<Framing, string> = {
  'full-body': 'full body figure head to feet, not a headshot',
  torso: 'torso three-quarter figure head to waist, not a headshot',
  scene: 'full character with props, not a face crop',
}

/**
 * Style lock for proof art: flat fills + outlines that separate colors.
 * Avoid “enamel pin / sticker / product” language — models over-bake that in.
 * Keep short so free hosts don’t stall batches.
 */
function buildStyleLock(framing: Framing): string {
  return [
    '2D flat color character illustration',
    FRAMING_HINTS[framing],
    'flat solid color fills only, no gradients',
    'clean even black outline lines separating each color region',
    'limited palette, hard edges, high contrast',
    'cel shaded graphic design art, not a photo',
    'plain solid background white or black',
    'no stickers, no badges as products, no pins, no metal, no mockups',
    'no photorealism, no pencil sketch, no watercolor',
  ].join(', ')
}

export function getPinheadsStyleBias(): string {
  return pinheadsStyle.promptBias
}

export function getPinheadsCatalogStats() {
  return pinheadsStyle.stats
}

export function buildPinheadsPrompt(
  userPrompt: string,
  themes: PinheadsTheme[] = ['attitude'],
  framing: Framing = 'full-body',
): string {
  const unique = [...new Set(themes.length ? themes : (['attitude'] as PinheadsTheme[]))]
  if (!unique.includes('attitude')) unique.unshift('attitude')
  const themeText = unique.map((t) => THEME_HINTS[t]).join('; ')
  return [userPrompt.trim(), buildStyleLock(framing), `mood: ${themeText}`]
    .filter(Boolean)
    .join(', ')
}

/** Small tiles for batch pick — faster + fewer free-tier timeouts. */
export const DEFAULT_GEN_SIZE = 512

function buildImageGenUrl(finalPrompt: string, opts: AiGenerateOptions): string {
  const width = opts.width ?? DEFAULT_GEN_SIZE
  const height = opts.height ?? DEFAULT_GEN_SIZE
  const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000)
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    seed: String(seed),
    nologo: 'true',
  })
  // Keep path length under control — free hosts choke on huge URLs
  const clipped =
    finalPrompt.length > 420 ? finalPrompt.slice(0, 420) : finalPrompt
  return `/api/image-gen/${encodeURIComponent(clipped)}?${params.toString()}`
}

export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode generated image'))
    img.src = url
  })
}

// Must exceed proxy timeout; free hosts commonly need 40–60s each
const PER_IMAGE_TIMEOUT_MS = 100_000

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function generateOne(
  opts: AiGenerateOptions & { seed: number; index: number },
): Promise<AiCandidate> {
  const prompt = opts.prompt.trim()
  const themes = opts.themes ?? ['attitude']
  const framing = opts.framing ?? 'full-body'
  const finalPrompt = buildPinheadsPrompt(prompt, themes, framing)
  const url = buildImageGenUrl(finalPrompt, opts)

  const res = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(PER_IMAGE_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `Image ${opts.index + 1} failed (${res.status})${detail ? `: ${detail.slice(0, 80)}` : ''}`,
    )
  }
  const blob = await res.blob()
  // Proxy may return text errors with 200 in edge cases — guard
  if (blob.type.includes('text') || blob.size < 800) {
    throw new Error(`Image ${opts.index + 1} returned non-image data`)
  }
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = await loadImageFromUrl(objectUrl)
    return {
      id: `c-${opts.seed}-${opts.index}`,
      image,
      objectUrl,
      prompt,
      finalPrompt,
      seed: opts.seed,
      index: opts.index,
    }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    throw err
  }
}

/** Single image (legacy). */
export async function generateAiImage(
  opts: AiGenerateOptions,
): Promise<AiGenerateResult> {
  const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000)
  const c = await generateOne({ ...opts, seed, index: 0 })
  return {
    image: c.image,
    objectUrl: c.objectUrl,
    prompt: c.prompt,
    finalPrompt: c.finalPrompt,
  }
}

export type BatchProgress = {
  /** Jobs finished (success or fail) */
  done: number
  total: number
  /** Successful images so far */
  ok: number
  failed: number
}

/**
 * Generate a batch of candidates for pick-one workflow.
 * Uses a worker pool so each image reports progress immediately
 * (not only after a whole wave of 3 finishes). Per-image timeout
 * prevents one hung request from freezing the whole batch.
 */
export async function generateAiBatch(
  opts: AiGenerateOptions & {
    count?: number
    concurrency?: number
    onProgress?: (p: BatchProgress) => void
    onCandidate?: (candidate: AiCandidate) => void
  },
): Promise<AiCandidate[]> {
  const prompt = opts.prompt.trim()
  if (!prompt) throw new Error('Enter a prompt to generate images')

  const count = Math.max(1, Math.min(16, opts.count ?? DEFAULT_BATCH_COUNT))
  // Sequential-ish: 1 at a time is most reliable on free hosts
  const concurrency = Math.max(1, Math.min(2, opts.concurrency ?? 1))
  const baseSeed = opts.seed ?? Math.floor(Math.random() * 1_000_000)
  const maxAttempts = 3

  type Job = AiGenerateOptions & { seed: number; index: number }
  const queue: Job[] = Array.from({ length: count }, (_, index) => ({
    ...opts,
    prompt,
    seed: baseSeed + index * 9973 + (index * 17) % 1000,
    index,
  }))

  const results: AiCandidate[] = []
  let done = 0
  let failed = 0
  let cursor = 0

  const report = () => {
    opts.onProgress?.({
      done,
      total: count,
      ok: results.length,
      failed,
    })
  }

  async function runJob(job: Job): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Stagger requests so free tier doesn't rate-limit the whole batch
        if (attempt > 0) await sleep(800 + attempt * 700)
        else if (job.index > 0) await sleep(350)

        const candidate = await generateOne({
          ...job,
          seed: job.seed + attempt * 41_111,
        })
        results.push(candidate)
        opts.onCandidate?.(candidate)
        done++
        report()
        return
      } catch (err) {
        lastError = err
      }
    }
    console.warn('Batch image failed:', job.index, lastError)
    failed++
    done++
    report()
  }

  report()

  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const i = cursor++
      await runJob(queue[i])
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, count) }, () =>
    worker(),
  )
  await Promise.all(workers)

  if (results.length === 0) {
    throw new Error(
      'All image generations failed or timed out. Try again — free image hosts can stall.',
    )
  }

  return results.sort((a, b) => a.index - b.index)
}

export function revokeCandidates(candidates: AiCandidate[]) {
  for (const c of candidates) {
    URL.revokeObjectURL(c.objectUrl)
  }
}
