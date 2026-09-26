import { useState } from 'react'
import { formatTimeControl, maxBaseMinutes, maxIncrementSeconds, sameTimeControl, timeControlPresets } from '../timeControl'
import type { TimeControl } from '../timeControl'

type TimeControlPickerProps = {
  value: TimeControl | null
  onChange: (value: TimeControl | null) => void
  allowUntimed?: boolean
}

function clampInteger(value: string, min: number, max: number) {
  const parsed = Math.round(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : min
}

export function TimeControlPicker({ value, onChange, allowUntimed = true }: TimeControlPickerProps) {
  const isPreset = value === null || timeControlPresets.some((preset) => sameTimeControl(preset, value))
  const [customOpen, setCustomOpen] = useState(!isPreset)
  const custom = value ?? { baseSeconds: 10 * 60, incrementSeconds: 0 }

  return <div className="time-control-picker">
    <p className="section-label">TIME CONTROL</p>
    <div className="filter-group time-control-options">
      {allowUntimed && <button className={value === null && !customOpen ? 'selected' : ''} onClick={() => { setCustomOpen(false); onChange(null) }}>Untimed</button>}
      {timeControlPresets.map((preset) => <button key={formatTimeControl(preset)} className={!customOpen && sameTimeControl(preset, value) ? 'selected' : ''} onClick={() => { setCustomOpen(false); onChange(preset) }}>{formatTimeControl(preset)}</button>)}
      <button className={customOpen ? 'selected' : ''} onClick={() => { setCustomOpen(true); onChange(custom) }}>Custom</button>
    </div>
    {customOpen && <div className="custom-time-control">
      <label>MINUTES<input type="number" min={1} max={maxBaseMinutes} value={custom.baseSeconds / 60} onChange={(event) => onChange({ ...custom, baseSeconds: clampInteger(event.target.value, 1, maxBaseMinutes) * 60 })} /></label>
      <span aria-hidden="true">+</span>
      <label>INCREMENT (SEC)<input type="number" min={0} max={maxIncrementSeconds} value={custom.incrementSeconds} onChange={(event) => onChange({ ...custom, incrementSeconds: clampInteger(event.target.value, 0, maxIncrementSeconds) })} /></label>
    </div>}
  </div>
}
