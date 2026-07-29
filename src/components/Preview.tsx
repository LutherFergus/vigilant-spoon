import { useEffect, useState } from 'react'
import type { DualOutputResult } from '../lib/pipeline'

export type PreviewTab = 'source' | 'outline' | 'vector' | 'proof'

type Props = {
  viewMode: PreviewTab
  sourceUrl: string | null
  result: DualOutputResult | null
  busy: boolean
}

export function Preview({ viewMode, sourceUrl, result, busy }: Props) {
  const [vectorUrl, setVectorUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!result) {
      setVectorUrl(null)
      return
    }
    setVectorUrl(result.vector.svgUrl)
  }, [result])

  if (!sourceUrl && !result) {
    return (
      <div className="preview-stage">
        <div className="empty-state">
          <h3>Upload artwork</h3>
          <p>
            Drop a concept image. We’ll build outline, flat color vector, and a combined
            proof (fills + lines) — like your elephant jack-in-the-box plates.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`preview-stage ${viewMode === 'proof' ? 'proof-stage' : 'checker'}`}
      aria-busy={busy}
    >
      {viewMode === 'source' && sourceUrl ? (
        <img src={sourceUrl} alt="Source artwork" />
      ) : viewMode === 'outline' && result ? (
        <img src={result.outline.pngUrl} alt="Outline plate" />
      ) : viewMode === 'vector' && vectorUrl ? (
        <img src={vectorUrl} alt="Flat color vector" />
      ) : viewMode === 'proof' && result ? (
        <img src={result.proof.pngUrl} alt="Combined pin proof" />
      ) : (
        <div className="empty-state">
          <h3>Processing</h3>
          <p>Building outline, vector, and proof…</p>
        </div>
      )}
    </div>
  )
}
