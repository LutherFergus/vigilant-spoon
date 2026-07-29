import type { DualOutputSettings } from '../lib/pipeline'

type Props = {
  settings: DualOutputSettings
  onChange: (next: DualOutputSettings) => void
  disabled?: boolean
  live?: boolean
}

export function DualControls({ settings, onChange, disabled, live }: Props) {
  const patchOutline = (partial: Partial<DualOutputSettings['outline']>) => {
    onChange({ ...settings, outline: { ...settings.outline, ...partial } })
  }
  const patchVector = (partial: Partial<DualOutputSettings['vector']>) => {
    onChange({ ...settings, vector: { ...settings.vector, ...partial } })
  }

  return (
    <div className="live-controls">
      {live ? (
        <div className="live-banner">
          <span className="live-dot" aria-hidden />
          Live — sliders update outline & vector
        </div>
      ) : null}

      <h2>Outline · color separators</h2>
      <div className="field">
        <label>
          <span>Detail</span>
          <span className="value">{settings.outline.sensitivity}</span>
        </label>
        <input
          type="range"
          min={10}
          max={90}
          step={1}
          value={settings.outline.sensitivity}
          disabled={disabled}
          onChange={(e) => patchOutline({ sensitivity: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <label>
          <span>Stroke weight</span>
          <span className="value">{settings.outline.thickness}px</span>
        </label>
        <input
          type="range"
          min={1}
          max={6}
          step={1}
          value={settings.outline.thickness}
          disabled={disabled}
          onChange={(e) => patchOutline({ thickness: Number(e.target.value) })}
        />
      </div>

      <h2>Vector · flat quantize</h2>
      <div className="field">
        <label>
          <span>Colors</span>
          <span className="value">{settings.vector.colorCount}</span>
        </label>
        <input
          type="range"
          min={2}
          max={16}
          step={1}
          value={settings.vector.colorCount}
          disabled={disabled}
          onChange={(e) => patchVector({ colorCount: Number(e.target.value) })}
        />
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.vector.snapToPms}
          disabled={disabled}
          onChange={(e) => patchVector({ snapToPms: e.target.checked })}
        />
        <span>Snap to PMS enamel chart</span>
      </label>
      <div className="field">
        <label>
          <span>Smoothness</span>
          <span className="value">{settings.vector.smoothness}</span>
        </label>
        <input
          type="range"
          min={0}
          max={5}
          step={1}
          value={settings.vector.smoothness}
          disabled={disabled}
          onChange={(e) => patchVector({ smoothness: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <label>
          <span>Cleanup</span>
          <span className="value">
            {(settings.vector.minRegionRatio * 10000).toFixed(1)}
          </span>
        </label>
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={Math.round(settings.vector.minRegionRatio * 10000)}
          disabled={disabled}
          onChange={(e) =>
            patchVector({ minRegionRatio: Number(e.target.value) / 10000 })
          }
        />
      </div>
      <p className="hint tight">Higher cleanup merges tiny speckles before tracing.</p>
    </div>
  )
}
