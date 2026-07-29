import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { DualControls } from './components/DualControls'
import { Dropzone } from './components/Dropzone'
import { PaletteMerge } from './components/PaletteMerge'
import { PmsChartModal } from './components/PmsChartModal'
import { Preview, type PreviewTab } from './components/Preview'
import { PromptProducer } from './components/PromptProducer'
import type { PmsOverrides } from './lib/colorVectorize'
import {
  createDualOutputs,
  DEFAULT_DUAL_SETTINGS,
  remergeVector,
  revokeDualUrls,
  type DualOutputResult,
  type DualOutputSettings,
} from './lib/pipeline'
import { getPmsChartSize } from './lib/pms'
import { loadImageFromFile } from './lib/vectorize'

type Mode = 'prompt' | 'studio'

export default function App() {
  const [mode, setMode] = useState<Mode>('studio')
  const [settings, setSettings] = useState<DualOutputSettings>(DEFAULT_DUAL_SETTINGS)
  const [sourceName, setSourceName] = useState('artwork')
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null)
  const [result, setResult] = useState<DualOutputResult | null>(null)
  const [merges, setMerges] = useState<Array<[number, number]>>([])
  const [pmsOverrides, setPmsOverrides] = useState<PmsOverrides>({})
  const [chartOpen, setChartOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<PreviewTab>('proof')
  const [isPending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [liveBusy, setLiveBusy] = useState(false)

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const sourceImageRef = useRef(sourceImage)
  sourceImageRef.current = sourceImage
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveGen = useRef(0)

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
      revokeDualUrls(result)
      if (liveTimer.current) clearTimeout(liveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runPipeline = useCallback(
    async (
      image: HTMLImageElement,
      nextSettings: DualOutputSettings,
      nextMerges: Array<[number, number]>,
      nextOverrides: PmsOverrides,
      opts?: { quiet?: boolean },
    ) => {
      if (!opts?.quiet) setBusy(true)
      else setLiveBusy(true)
      setError(null)
      const gen = ++liveGen.current
      try {
        await new Promise((r) => setTimeout(r, 8))
        const next = await createDualOutputs(
          image,
          nextSettings,
          nextMerges,
          nextOverrides,
        )
        if (gen !== liveGen.current) {
          revokeDualUrls(next)
          return
        }
        startTransition(() => {
          setResult((prev) => {
            revokeDualUrls(prev)
            return next
          })
        })
      } catch (err) {
        if (gen === liveGen.current) {
          setError(err instanceof Error ? err.message : 'Processing failed')
        }
      } finally {
        if (gen === liveGen.current) {
          setBusy(false)
          setLiveBusy(false)
        }
      }
    },
    [],
  )

  const scheduleLivePipeline = useCallback(
    (nextSettings: DualOutputSettings) => {
      if (!sourceImageRef.current) return
      if (liveTimer.current) clearTimeout(liveTimer.current)
      liveTimer.current = setTimeout(() => {
        const img = sourceImageRef.current
        if (!img) return
        setMerges([])
        setPmsOverrides({})
        void runPipeline(img, nextSettings, [], {}, { quiet: true })
      }, 300)
    },
    [runPipeline],
  )

  const onSettingsChange = useCallback(
    (next: DualOutputSettings) => {
      setSettings(next)
      scheduleLivePipeline(next)
    },
    [scheduleLivePipeline],
  )

  const onFile = useCallback(
    async (file: File) => {
      setError(null)
      try {
        const img = await loadImageFromFile(file)
        const url = URL.createObjectURL(file)
        setSourceUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return url
        })
        setSourceImage(img)
        setSourceName(file.name.replace(/\.[^.]+$/, '') || 'artwork')
        setMerges([])
        setPmsOverrides({})
        setMode('studio')
        setViewMode('proof')
        await runPipeline(img, settingsRef.current, [], {})
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load image')
      }
    },
    [runPipeline],
  )

  const refreshVector = useCallback(
    async (
      nextMerges: Array<[number, number]>,
      nextOverrides: PmsOverrides,
      nextSettings: DualOutputSettings = settings,
    ) => {
      if (!result) return
      setLiveBusy(true)
      setError(null)
      try {
        const next = await remergeVector(
          result,
          nextMerges,
          nextSettings.vector.smoothness,
          nextSettings.vector.snapToPms,
          nextOverrides,
        )
        startTransition(() => {
          setResult(next)
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Palette update failed')
      } finally {
        setLiveBusy(false)
      }
    },
    [result, settings],
  )

  const onMergesChange = useCallback(
    async (nextMerges: Array<[number, number]>) => {
      setMerges(nextMerges)
      await refreshVector(nextMerges, pmsOverrides)
    },
    [pmsOverrides, refreshVector],
  )

  const onOverridePms = useCallback(
    async (paletteIndex: number, pmsCode: string) => {
      const next = { ...pmsOverrides, [paletteIndex]: pmsCode }
      setPmsOverrides(next)
      await refreshVector(merges, next)
    },
    [merges, pmsOverrides, refreshVector],
  )

  const downloadOutline = useCallback(() => {
    if (!result) return
    downloadBlob(result.outline.pngBlob, `${sourceName}-outline.png`)
  }, [result, sourceName])

  const downloadVector = useCallback(() => {
    if (!result) return
    downloadBlob(result.vector.svgBlob, `${sourceName}-vector.svg`)
  }, [result, sourceName])

  const downloadProof = useCallback(() => {
    if (!result) return
    downloadBlob(result.proof.pngBlob, `${sourceName}-proof.png`)
  }, [result, sourceName])

  const statusText = useMemo(() => {
    if (error) return error
    if (busy || isPending || liveBusy) return 'Updating outline, vector & proof…'
    if (!sourceImage) return 'Upload art to build outline · vector · proof plates'
    if (!result) return 'Processing…'
    const pmsCount = result.vector.palette.filter((c) => c.pmsCode).length
    return `Proof ready · ${result.vector.palette.length} fills · ${pmsCount} PMS · ${result.vector.regionCount} shapes`
  }, [busy, error, isPending, liveBusy, result, sourceImage])

  return (
    <div className="app">
      <header className="top-bar">
        <div className="brand-block">
          <p className="eyebrow">Outline · Vector · Proof</p>
          <h1 className="brand">Pin Proof Studio</h1>
        </div>
        <nav className="stepper" aria-label="Mode">
          <button
            type="button"
            className={`step ${mode === 'studio' ? 'active' : ''}`}
            onClick={() => setMode('studio')}
          >
            Studio
          </button>
          <button
            type="button"
            className={`step ${mode === 'prompt' ? 'active' : ''}`}
            onClick={() => setMode('prompt')}
          >
            Prompt producer
          </button>
        </nav>
      </header>

      <p className={`status-bar ${error ? 'error' : ''}`}>{statusText}</p>

      {mode === 'prompt' ? (
        <div className="studio studio-prompt">
          <aside className="panel sidebar">
            <h2>External generator</h2>
            <PromptProducer />
          </aside>
          <section className="panel main-stage">
            <div className="empty-state hero-empty">
              <h3>Generate elsewhere</h3>
              <p>
                Copy a prompt → make art in Grok / Midjourney / Flux / ChatGPT → come back
                to <strong>Studio</strong> and upload. We turn it into outline, flat vector,
                and a combined proof (fills + lines).
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setMode('studio')}
              >
                Go to Studio →
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="studio studio-refine">
          <aside className="panel sidebar">
            <h2>Source art</h2>
            <Dropzone onFile={onFile} disabled={busy} />
            <p className="hint">
              Upload concept art (from your external generator). Pipeline: outline plate →
              flat fills → combined proof.
            </p>

            {sourceImage && (
              <>
                <DualControls
                  settings={settings}
                  onChange={onSettingsChange}
                  disabled={busy && !liveBusy}
                  live
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-block chart-btn"
                  onClick={() => setChartOpen(true)}
                >
                  PMS chart ({getPmsChartSize()})
                </button>
                {result && (
                  <PaletteMerge
                    palette={result.vector.palette}
                    merges={merges}
                    onChangeMerges={onMergesChange}
                    onOverridePms={onOverridePms}
                    disabled={busy || liveBusy}
                  />
                )}
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={downloadProof}
                    disabled={!result || busy}
                  >
                    Download proof PNG
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-block"
                    onClick={downloadOutline}
                    disabled={!result || busy}
                  >
                    Download outline
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-block"
                    onClick={downloadVector}
                    disabled={!result || busy}
                  >
                    Download vector SVG
                  </button>
                </div>
              </>
            )}
          </aside>

          <section className="panel main-stage">
            {sourceImage ? (
              <>
                <div className="meta-bar">
                  <div className="segmented" role="tablist" aria-label="Preview">
                    {(
                      [
                        ['proof', 'Proof'],
                        ['outline', 'Outline'],
                        ['vector', 'Vector'],
                        ['source', 'Source'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        className={`seg ${viewMode === id ? 'active' : ''}`}
                        onClick={() => setViewMode(id)}
                        disabled={id !== 'source' && !result}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {(liveBusy || busy) && (
                    <span className="pill-live">
                      <span className="live-dot" /> Updating
                    </span>
                  )}
                </div>
                <Preview
                  viewMode={viewMode}
                  sourceUrl={sourceUrl}
                  result={result}
                  busy={(busy || isPending) && !result}
                />
              </>
            ) : (
              <div className="empty-state hero-empty">
                <h3>Editor, not generator</h3>
                <p>
                  Build a prompt in <strong>Prompt producer</strong>, generate art elsewhere,
                  then upload here. Output plates: outline · flat vector · combined proof —
                  same path as your elephant jack-in-the-box set.
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setMode('prompt')}
                >
                  Open prompt producer
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      <PmsChartModal
        open={chartOpen}
        title="Enamel pin PMS chart"
        onClose={() => setChartOpen(false)}
        onPick={() => setChartOpen(false)}
      />
    </div>
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
