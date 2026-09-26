import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useRealtimeEvent } from '../realtime/context'
import { readStored, writeStored } from '../storage'

// Must match maxPgnBytes and maxLibrarySize in server/pgnImport.ts.
const maxPgnImportBytes = 50 * 1024 * 1024
const maxLibrarySize = 20_000
// Files up to this size are loaded into the text box for review; bigger ones
// upload directly (a 50 MB textarea would freeze the browser).
const maxReviewBytes = 1024 * 1024
const pollIntervalMs = 3000
const jobStorageKey = 'chess-training-import-job'

type ImportJob = {
  id: string
  status: 'processing' | 'complete' | 'failed'
  totalGames: number
  processed: number
  imported: number
  duplicates: number
  invalid: number
  skippedFull: number
  invalidSamples: string[]
  error: string | null
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function summary(job: ImportJob) {
  if (job.status === 'failed') return `The import stopped: ${job.error ?? 'unknown error'}. ${job.imported.toLocaleString()} games were added before it stopped.`
  const parts = [`${job.imported.toLocaleString()} ${job.imported === 1 ? 'game' : 'games'} added to the library.`]
  if (job.duplicates) parts.push(`${job.duplicates.toLocaleString()} duplicate${job.duplicates === 1 ? '' : 's'} skipped.`)
  if (job.invalid) parts.push(`${job.invalid.toLocaleString()} unreadable game${job.invalid === 1 ? '' : 's'} skipped.`)
  if (job.skippedFull) parts.push(`${job.skippedFull.toLocaleString()} not imported because the library is full (${maxLibrarySize.toLocaleString()} games).`)
  return parts.join(' ')
}

// Uploads with XMLHttpRequest because fetch can't report upload progress.
function upload(body: XMLHttpRequestBodyInit, onProgress: (percent: number) => void) {
  return new Promise<ImportJob>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/games/import')
    request.setRequestHeader('Content-Type', 'text/plain')
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    request.onerror = () => reject(new Error('The upload failed. Check your connection and try again.'))
    request.onload = () => {
      let result: ImportJob & { error?: string }
      try {
        result = JSON.parse(request.responseText) as ImportJob & { error?: string }
      } catch {
        reject(new Error('The server returned an invalid response.'))
        return
      }
      if (request.status < 200 || request.status >= 300) reject(new Error(result.error ?? 'PGN import failed.'))
      else resolve(result)
    }
    request.send(body)
  })
}

export function PgnImportPanel({ onImportFinished }: { onImportFinished: () => void }) {
  const [importText, setImportText] = useState('')
  const [largeFile, setLargeFile] = useState<File | null>(null)
  const [selectedFileName, setSelectedFileName] = useState('')
  const [fileLoadVersion, setFileLoadVersion] = useState(0)
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [message, setMessage] = useState('')
  const jobRef = useRef<ImportJob | null>(null)
  const busy = uploadPercent !== null || job?.status === 'processing'
  const trackedJobId = job?.status === 'processing' ? job.id : job ? null : readStored<string | null>(jobStorageKey, null)

  // Also handles an import that finished while this panel was closed (no previous job).
  const applyJob = useCallback((next: ImportJob) => {
    const previous = jobRef.current
    jobRef.current = next
    setJob(next)
    if ((!previous || previous.status === 'processing') && next.status !== 'processing') {
      setMessage(summary(next))
      writeStored(jobStorageKey, null)
      onImportFinished()
    }
  }, [onImportFinished])

  useRealtimeEvent('import_progress', (data) => {
    const next = data as ImportJob
    if (jobRef.current?.id === next.id) applyJob(next)
  })

  // Polling backs up the live events and resumes an import started before this
  // panel was (re)opened.
  useEffect(() => {
    if (!trackedJobId) return
    let stopped = false
    const poll = () => {
      void fetch(`/api/games/import/${trackedJobId}`)
        .then((response) => response.ok ? response.json() as Promise<ImportJob> : null)
        .then((latest) => {
          if (stopped) return
          if (latest) applyJob(latest)
          else writeStored(jobStorageKey, null)
        })
        .catch(() => undefined)
    }
    if (!jobRef.current) poll()
    const timer = window.setInterval(poll, pollIntervalMs)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [applyJob, trackedJobId])

  async function importGames() {
    const body = largeFile ?? importText
    if (!largeFile && !importText.trim()) {
      setMessage('Paste a PGN or choose a file before importing.')
      return
    }
    setMessage('')
    setUploadPercent(0)
    try {
      const started = await upload(body, setUploadPercent)
      writeStored(jobStorageKey, started.id)
      applyJob(started)
      setImportText('')
      setLargeFile(null)
      setSelectedFileName('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'PGN import failed.')
    } finally {
      setUploadPercent(null)
    }
  }

  function handlePgnFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setSelectedFileName(file.name)
    setMessage('')
    if (file.size > maxPgnImportBytes) {
      setLargeFile(null)
      setMessage(`${file.name} is ${formatSize(file.size)}. PGN imports are limited to ${formatSize(maxPgnImportBytes)}.`)
      return
    }
    if (file.size > maxReviewBytes) {
      setImportText('')
      setLargeFile(file)
      setMessage(`${file.name} (${formatSize(file.size)}) is ready. It uploads directly, without a preview.`)
      return
    }
    setLargeFile(null)
    void file.text()
      .then((text) => {
        setImportText(text)
        setFileLoadVersion((version) => version + 1)
        setMessage(`${file.name} loaded. Review the PGN, then import it.`)
      })
      .catch(() => setMessage(`Could not read ${file.name}.`))
  }

  const processedPercent = job && job.totalGames > 0 ? Math.round((job.processed / job.totalGames) * 100) : 0
  return <section className="import-panel"><div><p className="section-label">EXPAND THE LIBRARY</p><h2>Import PGN games</h2><p>Paste PGN games, or choose a PGN collection of up to {formatSize(maxPgnImportBytes)} from your computer. The library holds up to {maxLibrarySize.toLocaleString()} games; large collections import in the background and can take several minutes.</p></div><div className="import-form">
    <textarea key={fileLoadVersion} value={importText} disabled={largeFile !== null || busy} onChange={(event) => setImportText(event.target.value)} placeholder={largeFile ? `${largeFile.name} will be uploaded directly.` : '[Event "Game one"]\n1. e4 e5 ...\n\n[Event "Game two"]\n1. d4 d5 ...'} aria-label="PGN text" />
    <div className="import-actions"><label className="file-button"><span className="button-icon" aria-hidden="true">↑</span> Choose PGN<input type="file" accept=".pgn,.txt,text/plain" disabled={busy} onChange={handlePgnFile} /></label><button className="primary-button" disabled={busy} onClick={() => void importGames()}><span className="button-icon" aria-hidden="true">＋</span> {busy ? 'Importing...' : 'Import games'}</button>{largeFile && !busy && <button className="text-button" onClick={() => { setLargeFile(null); setSelectedFileName(''); setMessage('') }}>Clear file</button>}</div>
    {uploadPercent !== null && <div className="import-progress" aria-live="polite"><div className="import-progress-label"><strong>Uploading {largeFile ? largeFile.name : 'PGN'}</strong><span>{uploadPercent}%</span></div><div className="import-progress-track"><span style={{ width: `${uploadPercent}%` }} /></div></div>}
    {job?.status === 'processing' && <div className="import-progress" aria-live="polite"><div className="import-progress-label"><strong>Importing {job.processed.toLocaleString()} of {job.totalGames.toLocaleString()} games · {job.imported.toLocaleString()} added</strong><span>{processedPercent}%</span></div><div className="import-progress-track"><span style={{ width: `${processedPercent}%` }} /></div><p className="import-progress-note">You can leave this page; the import continues on the server.</p></div>}
    {selectedFileName && !busy && <p className="selected-file">Selected: {selectedFileName}{largeFile ? ` · ${formatSize(largeFile.size)}` : ` · ${importText.length.toLocaleString()} characters loaded`}</p>}
    {message && <p className="import-message">{message}</p>}
    {job && job.status !== 'processing' && job.invalidSamples.length > 0 && <ul className="import-invalid">{job.invalidSamples.map((sample) => <li key={sample}>{sample}</li>)}{job.invalid > job.invalidSamples.length && <li>...and {(job.invalid - job.invalidSamples.length).toLocaleString()} more</li>}</ul>}
  </div></section>
}
