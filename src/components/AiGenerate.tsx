import { useMemo, useState } from 'react'
import {
  DEFAULT_BATCH_COUNT,
  FRAMING_OPTIONS,
  PINHEADS_THEMES,
  getPinheadsCatalogStats,
  type Framing,
  type PinheadsTheme,
} from '../lib/aiGenerate'

type Props = {
  onGenerate: (opts: {
    prompt: string
    themes: PinheadsTheme[]
    framing: Framing
    count: number
  }) => void
  disabled?: boolean
}

const EXAMPLES = [
  {
    prompt: 'skeleton minuteman in tricorne, blue coat red trim, musket, full body pose',
    themes: ['attitude', 'patriotism'] as PinheadsTheme[],
    framing: 'full-body' as Framing,
  },
  {
    prompt: 'krampus face and claws emerging through a large red number 13 with holly',
    themes: ['attitude', 'horror', 'holiday'] as PinheadsTheme[],
    framing: 'torso' as Framing,
  },
  {
    prompt: 'tough raccoon character in newsboy cap, full body stance, waving',
    themes: ['attitude', 'animals'] as PinheadsTheme[],
    framing: 'full-body' as Framing,
  },
]

export function AiGenerate({ onGenerate, disabled }: Props) {
  const [prompt, setPrompt] = useState('')
  const [themes, setThemes] = useState<PinheadsTheme[]>(['attitude'])
  const [framing, setFraming] = useState<Framing>('full-body')
  const [count, setCount] = useState(DEFAULT_BATCH_COUNT)
  const stats = useMemo(() => getPinheadsCatalogStats(), [])

  const toggleTheme = (id: PinheadsTheme) => {
    setThemes((prev) => {
      if (id === 'attitude') return prev.includes('attitude') ? prev : ['attitude', ...prev]
      if (prev.includes(id)) {
        const next = prev.filter((t) => t !== id)
        return next.includes('attitude') ? next : ['attitude', ...next]
      }
      return [...prev, id]
    })
  }

  return (
    <div className="ai-generate">
      <div className="field">
        <label htmlFor="ai-prompt">
          <span>Describe the pin idea</span>
        </label>
        <textarea
          id="ai-prompt"
          rows={3}
          value={prompt}
          disabled={disabled}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the character or scene — full body or torso…"
        />
      </div>
      <p className="hint tight">
        We generate <strong>flat-color proof art</strong> (solid fills + clean outlines). Not a
        pin photo, not a sticker mockup — art you later refine into a pin proof.
      </p>

      <p className="section-label">Framing</p>
      <div className="segmented" role="group" aria-label="Framing">
        {FRAMING_OPTIONS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`seg ${framing === f.id ? 'active' : ''}`}
            disabled={disabled}
            title={f.hint}
            onClick={() => setFraming(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <p className="hint tight">
        {FRAMING_OPTIONS.find((f) => f.id === framing)?.hint}. Avoid tight headshots.
      </p>

      <p className="section-label">Mood</p>
      <div className="theme-grid" aria-label="Mood themes">
        {PINHEADS_THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chip ${themes.includes(t.id) ? 'chip-on' : ''}`}
            disabled={disabled || t.id === 'attitude'}
            onClick={() => toggleTheme(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="field">
        <label>
          <span>Batch size</span>
          <span className="value">{count}</span>
        </label>
        <input
          type="range"
          min={4}
          max={9}
          step={1}
          value={count}
          disabled={disabled}
          onChange={(e) => setCount(Number(e.target.value))}
        />
      </div>
      <p className="hint tight">
        Default 6 — free image hosts drop slots if we hammer them. One-at-a-time with
        retries is slower but more reliable.
      </p>

      <div className="example-row">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.prompt}
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => {
              setPrompt(ex.prompt)
              setThemes(ex.themes)
              setFraming(ex.framing)
            }}
          >
            {ex.prompt.split(',')[0]}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={disabled || !prompt.trim()}
        onClick={() =>
          onGenerate({
            prompt: prompt.trim(),
            themes,
            framing,
            count,
          })
        }
      >
        {disabled ? 'Generating…' : `Generate ${count} concepts`}
      </button>
      <p className="hint center-hint">
        Imagine batch → pick → outline & vector · mood library {stats.products} refs
      </p>
    </div>
  )
}
