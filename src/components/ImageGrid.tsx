import type { AiCandidate } from '../lib/aiGenerate'

type Props = {
  candidates: AiCandidate[]
  selectedId: string | null
  onSelect: (c: AiCandidate) => void
  generating?: boolean
  progress?: { done: number; total: number; ok: number; failed: number } | null
  batchTotal?: number
}

export function ImageGrid({
  candidates,
  selectedId,
  onSelect,
  generating,
  progress,
  batchTotal = 12,
}: Props) {
  const total = progress?.total ?? batchTotal
  const ok = candidates.length
  const pendingSlots = generating
    ? Math.max(0, total - (progress?.done ?? 0))
    : 0

  if (generating && candidates.length === 0) {
    return (
      <div className="grid-loading">
        <div className="spinner" aria-hidden />
        <p>
          Generating concepts…
          {progress ? (
            <span className="progress-count">
              {' '}
              {progress.ok} ready · {progress.done}/{progress.total} tried
            </span>
          ) : null}
        </p>
        <div className="skeleton-grid">
          {Array.from({ length: total }, (_, i) => (
            <div key={i} className="skeleton-tile" />
          ))}
        </div>
      </div>
    )
  }

  if (!candidates.length && !generating) {
    return (
      <div className="empty-state">
        <h3>Pick a concept</h3>
        <p>Generate a batch of ideas, then tap the one that could be a pin.</p>
      </div>
    )
  }

  return (
    <div className="pick-stage">
      <div className="pick-head">
        <div>
          <h3>Choose a concept</h3>
          <p className="pick-sub">
            {ok} ready
            {generating && progress
              ? ` · ${progress.done}/${progress.total} tried`
              : ''}
            {' · '}
            tap one for live outline &amp; vector
          </p>
        </div>
        {generating && progress ? (
          <span className="pill-live">
            {progress.ok} ready · {progress.done}/{progress.total}
            {progress.failed > 0 ? ` · ${progress.failed} failed` : ''}
          </span>
        ) : null}
      </div>
      <div className="image-grid" role="listbox" aria-label="Generated concepts">
        {candidates.map((c) => {
          const selected = c.id === selectedId
          return (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={`grid-tile ${selected ? 'selected' : ''}`}
              onClick={() => onSelect(c)}
            >
              <img src={c.objectUrl} alt={`Concept ${c.index + 1}`} />
              <span className="grid-badge">#{c.index + 1}</span>
              {selected ? <span className="grid-check" aria-hidden>✓</span> : null}
            </button>
          )
        })}
        {Array.from({ length: pendingSlots }, (_, i) => (
          <div key={`pending-${i}`} className="skeleton-tile" aria-hidden />
        ))}
      </div>
    </div>
  )
}
