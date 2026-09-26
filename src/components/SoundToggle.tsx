import { useEffect, useState } from 'react'
import { isSoundEnabled, onSoundSettingChange, setSoundEnabled } from '../sounds'

export function SoundToggle() {
  const [on, setOn] = useState(isSoundEnabled)
  useEffect(() => onSoundSettingChange(setOn), [])
  return <button className="header-link sound-toggle" onClick={() => setSoundEnabled(!on)} aria-pressed={on} title={on ? 'Turn sounds off' : 'Turn sounds on'}>
    <span aria-hidden="true">{on ? '🔊' : '🔇'}</span> {on ? 'SOUND ON' : 'SOUND OFF'}
  </button>
}
