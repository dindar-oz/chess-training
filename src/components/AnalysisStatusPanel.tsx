import { useEffect, useState } from 'react'
import { readApiResponse } from '../types'

// What /api/admin/analysis reports (see analysisStatus() in server/analysis.ts).
type AnalysisStatus = {
  engine: string | null
  kind: 'native' | 'wasm' | null
  problem: string | null
  depth: number
  workers: number
  busyWorkers: number
  cpus: number
  waiting: number
  searches: number
  averageSeconds: number | null
  lastError: { message: string; at: string } | null
  hostingPlan: string | null
}

const refreshMs = 10_000

// The server's challenge analysis for admins: which engine runs it, on how
// many cores, and how fast it keeps up, refreshed while the page is open.
export function AnalysisStatusPanel() {
  const [status, setStatus] = useState<AnalysisStatus | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await fetch('/api/admin/analysis')
        const result = await readApiResponse<AnalysisStatus>(response)
        if (!response.ok) throw new Error(result.error ?? 'Could not load the analysis status.')
        if (!cancelled) {
          setStatus(result)
          setError('')
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load the analysis status.')
      }
    }
    void load()
    const timer = setInterval(() => void load(), refreshMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const limitedPlan = status?.hostingPlan && /^(free|shared)$/i.test(status.hostingPlan)
  return <section className="history-section analysis-status">
    <div className="section-heading"><div><p className="section-label">CHALLENGE ANALYSIS</p><h2>The server's engine.</h2></div></div>
    {error && <p className="admin-error">{error}</p>}
    {status && <>
      {status.problem && <p className="admin-error">{status.problem}</p>}
      <div className="stats-summary analysis-status-grid">
        <div><span>ENGINE</span><strong>{status.engine ?? 'Starting...'}</strong>{status.kind && <small>{status.kind === 'native' ? 'native' : 'WASM (slower)'}</small>}</div>
        <div><span>DEPTH</span><strong>{status.depth}</strong></div>
        <div><span>WORKERS BUSY</span><strong>{status.busyWorkers} / {status.workers}</strong><small>{status.cpus} CPU {status.cpus === 1 ? 'core' : 'cores'}</small></div>
        <div><span>SEARCHES WAITING</span><strong>{status.waiting}</strong></div>
        <div><span>AVERAGE SEARCH</span><strong>{status.averageSeconds === null ? '—' : `${status.averageSeconds} s`}</strong><small>{status.searches} since restart</small></div>
        {status.hostingPlan && <div><span>AZURE PLAN</span><strong>{status.hostingPlan}</strong></div>}
      </div>
      {limitedPlan && <p className="admin-error">Azure's {status.hostingPlan} tier limits how much CPU time the app may use per day, and depth-{status.depth} analysis uses a lot of it. If challenges stop being scored, lower ANALYSIS_DEPTH or move to a Basic plan.</p>}
      {status.lastError && <p className="results-note">Last failed search ({new Date(status.lastError.at).toLocaleString()}): {status.lastError.message}. Failed searches are retried after a minute.</p>}
      <p className="results-note">Every challenge move is searched once at depth {status.depth}, and players who play the same move in the same position share that result. Searches run while the game is played; if results still take long to appear after challenges, set ANALYSIS_DEPTH lower or give the server more CPU cores.</p>
    </>}
  </section>
}
