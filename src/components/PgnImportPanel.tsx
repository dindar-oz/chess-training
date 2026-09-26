import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { readApiResponse } from '../types'
import type { GameRecord } from '../types'

// Must match maxPgnBytes in server.ts.
const maxPgnImportBytes = 1 * 1024 * 1024

export function PgnImportPanel({ onImported }: { onImported: (games: GameRecord[]) => void }) {
  const [importText, setImportText] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [importing, setImporting] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState('')
  const [fileLoadVersion, setFileLoadVersion] = useState(0)

  async function importGames() {
    if (!importText.trim()) {
      setImportMessage('Paste a PGN before importing.')
      return
    }
    setImporting(true)
    try {
      const response = await fetch('/api/games/import', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: importText })
      const result = await readApiResponse<{ imported?: GameRecord[]; duplicates?: number }>(response)
      if (!response.ok) throw new Error(result.error ?? 'PGN import failed.')
      const importedGames = result.imported ?? []
      onImported(importedGames)
      setImportText('')
      const duplicateMessage = result.duplicates ? ` ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} skipped.` : ''
      setImportMessage(`${importedGames.length} ${importedGames.length === 1 ? 'game' : 'games'} added to the library.${duplicateMessage}`)
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'That PGN could not be parsed.')
    } finally {
      setImporting(false)
    }
  }

  function handlePgnFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setSelectedFileName(file.name)
    if (file.size > maxPgnImportBytes) {
      setImportText('')
      setImportMessage(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. PGN imports are limited to 1 MB.`)
      input.value = ''
      return
    }
    void file.text()
      .then((text) => {
        setImportText(text)
        setFileLoadVersion((version) => version + 1)
        setImportMessage(`${file.name} loaded. Review the PGN, then import it.`)
      })
      .catch(() => setImportMessage(`Could not read ${file.name}.`))
      .finally(() => { input.value = '' })
  }

  return <section className="import-panel"><div><p className="section-label">EXPAND THE LIBRARY</p><h2>Import PGN games</h2><p>Paste one or more complete PGN games, or load a PGN collection (up to 1 MB) from your computer.</p></div><div className="import-form"><textarea key={fileLoadVersion} value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="[Event &quot;Game one&quot;]&#10;1. e4 e5 ...&#10;&#10;[Event &quot;Game two&quot;]&#10;1. d4 d5 ..." aria-label="PGN text" /><div className="import-actions"><label className="file-button"><span className="button-icon" aria-hidden="true">↑</span> Choose PGN<input type="file" accept=".pgn,.txt,text/plain" onChange={handlePgnFile} /></label><button className="primary-button" disabled={importing} onClick={() => void importGames()}><span className="button-icon" aria-hidden="true">＋</span> {importing ? 'Importing...' : 'Import games'}</button></div>{importing && <div className="import-progress" aria-live="polite"><div className="import-progress-label"><strong>Processing games into the database</strong><span>Please wait</span></div><div className="import-progress-track"><span style={{ width: '100%' }} /></div></div>}{selectedFileName && <p className="selected-file">Selected: {selectedFileName} · {importText.length.toLocaleString()} characters loaded</p>}{importMessage && <p className="import-message">{importMessage}</p>}</div></section>
}
