import { useMemo, useState } from 'react'
import {
  PROMPT_FRAMING,
  PROMPT_MOODS,
  buildFullExport,
  buildNegativePrompt,
  buildPositivePrompt,
  type PromptFraming,
  type PromptMood,
} from '../lib/promptProducer'

export function PromptProducer() {
  const [subject, setSubject] = useState('')
  const [framing, setFraming] = useState<PromptFraming>('full-body')
  const [moods, setMoods] = useState<PromptMood[]>(['attitude'])
  const [extra, setExtra] = useState('')
  const [copied, setCopied] = useState<'positive' | 'negative' | 'full' | null>(null)

  const positive = useMemo(
    () => buildPositivePrompt({ subject, framing, moods, extra }),
    [subject, framing, moods, extra],
  )
  const negative = useMemo(() => buildNegativePrompt(), [])
  const full = useMemo(
    () => buildFullExport({ subject, framing, moods, extra }),
    [subject, framing, moods, extra],
  )

  const toggleMood = (id: PromptMood) => {
    if (id === 'none') {
      setMoods([])
      return
    }
    setMoods((prev) => {
      const withoutNone = prev.filter((m) => m !== 'none')
      if (withoutNone.includes(id)) return withoutNone.filter((m) => m !== id)
      return [...withoutNone, id]
    })
  }

  const copy = async (text: string, kind: 'positive' | 'negative' | 'full') => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1600)
    } catch {
      // Fallback for older contexts
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1600)
    }
  }

  return (
    <div className="prompt-producer">
      <p className="hint">
        Build a prompt for <strong>Grok / Midjourney / Flux / ChatGPT</strong>, generate there,
        then come back here and <strong>upload</strong> the image to make outline, vector, and
        proof plates.
      </p>

      <div className="field">
        <label htmlFor="pp-subject">
          <span>Subject</span>
        </label>
        <textarea
          id="pp-subject"
          rows={3}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. angry elephant jack-in-the-box, flat cap, spring popping from circus box…"
        />
      </div>

      <p className="section-label">Framing</p>
      <div className="segmented wrap-seg" role="group" aria-label="Framing">
        {PROMPT_FRAMING.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`seg ${framing === f.id ? 'active' : ''}`}
            onClick={() => setFraming(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="section-label">Mood (optional)</p>
      <div className="theme-grid">
        {PROMPT_MOODS.filter((m) => m.id !== 'none').map((m) => (
          <button
            key={m.id}
            type="button"
            className={`chip ${moods.includes(m.id) ? 'chip-on' : ''}`}
            onClick={() => toggleMood(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="pp-extra">
          <span>Extra notes</span>
        </label>
        <textarea
          id="pp-extra"
          rows={2}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="Optional: colors, props, text to avoid…"
        />
      </div>

      <p className="section-label">Positive prompt</p>
      <pre className="prompt-box">{positive || 'Add a subject to build the prompt…'}</pre>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!positive}
        onClick={() => copy(positive, 'positive')}
      >
        {copied === 'positive' ? 'Copied ✓' : 'Copy positive prompt'}
      </button>

      <p className="section-label">Negative prompt</p>
      <pre className="prompt-box compact">{negative}</pre>
      <button
        type="button"
        className="btn btn-secondary btn-block"
        onClick={() => copy(negative, 'negative')}
      >
        {copied === 'negative' ? 'Copied ✓' : 'Copy negative prompt'}
      </button>

      <button
        type="button"
        className="btn btn-secondary btn-block"
        disabled={!full}
        onClick={() => copy(full, 'full')}
      >
        {copied === 'full' ? 'Copied ✓' : 'Copy both (full export)'}
      </button>
    </div>
  )
}
