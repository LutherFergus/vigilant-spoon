/**
 * Builds copy-paste prompts for external image generators.
 * Target: flat-color proof art (not pin products / stickers).
 */

export type PromptFraming = 'full-body' | 'torso' | 'scene' | 'object'

export type PromptMood =
  | 'attitude'
  | 'patriotism'
  | 'scally'
  | 'horror'
  | 'animals'
  | 'holiday'
  | 'sports'
  | 'none'

export const PROMPT_FRAMING: Array<{ id: PromptFraming; label: string; line: string }> = [
  {
    id: 'full-body',
    label: 'Full body',
    line: 'full body composition head to feet, complete figure visible, not a headshot',
  },
  {
    id: 'torso',
    label: 'Torso',
    line: 'three-quarter torso from head to waist, shoulders and chest visible, not a tight face crop',
  },
  {
    id: 'scene',
    label: 'Scene',
    line: 'character with supporting props or setting, readable full subject, not a face-only crop',
  },
  {
    id: 'object',
    label: 'Object / icon',
    line: 'centered object or icon composition, full item visible with clear silhouette',
  },
]

export const PROMPT_MOODS: Array<{ id: PromptMood; label: string; line: string }> = [
  { id: 'none', label: 'None', line: '' },
  { id: 'attitude', label: 'Attitude', line: 'tough swagger, rebellious humor' },
  { id: 'patriotism', label: 'Patriotism', line: 'patriotic Americana, red white and blue' },
  { id: 'scally', label: 'Scally', line: 'scally flat cap hooligan culture' },
  { id: 'horror', label: 'Horror', line: 'horror with attitude, macabre humor' },
  { id: 'animals', label: 'Animals', line: 'tough anthropomorphic animal character' },
  { id: 'holiday', label: 'Holiday', line: 'holiday character with attitude, not cutesy' },
  { id: 'sports', label: 'Sports', line: 'sports swagger, bold athletic energy' },
]

/** Style block for external generators — proof art, not product. */
export const STYLE_BLOCK = [
  '2D flat color character illustration',
  'flat solid color fills only, no gradients',
  'clean even black outline lines separating each color region',
  'limited bold palette, hard edges, high contrast',
  'cel style graphic design art',
  'plain solid white or black background',
  'not a photo, not pencil sketch, not watercolor',
  'not a sticker product, not an enamel pin photo, not metal, not a 3d mockup',
].join(', ')

export const NEGATIVE_BLOCK = [
  'headshot',
  'close-up face only',
  'photorealistic',
  'photo of enamel pin',
  'metal product mockup',
  '3d render',
  'sticker mockup',
  'pencil sketch',
  'crosshatching',
  'watercolor',
  'soft gradients',
  'blurry',
  'watermark',
].join(', ')

export type PromptBuildOptions = {
  subject: string
  framing: PromptFraming
  moods: PromptMood[]
  extra?: string
}

export function buildPositivePrompt(opts: PromptBuildOptions): string {
  const subject = opts.subject.trim()
  if (!subject) return ''

  const framing = PROMPT_FRAMING.find((f) => f.id === opts.framing)?.line ?? ''
  const moodLines = opts.moods
    .map((id) => PROMPT_MOODS.find((m) => m.id === id)?.line)
    .filter(Boolean) as string[]
  const mood = moodLines.length ? `mood: ${moodLines.join('; ')}` : ''
  const extra = opts.extra?.trim() ?? ''

  return [subject, framing, STYLE_BLOCK, mood, extra].filter(Boolean).join(', ')
}

export function buildNegativePrompt(): string {
  return NEGATIVE_BLOCK
}

export function buildFullExport(opts: PromptBuildOptions): string {
  const positive = buildPositivePrompt(opts)
  const negative = buildNegativePrompt()
  if (!positive) return ''
  return [
    '=== POSITIVE ===',
    positive,
    '',
    '=== NEGATIVE (if supported) ===',
    negative,
  ].join('\n')
}
