import { useEffect, useState } from 'react'
import type { ChallengeHistoryEntry } from './types'

// Past challenges; reloads whenever `refreshKey` changes (e.g. a challenge completed).
// A row opens the challenge's results; its Analyze button opens the analysis page.
export function ChallengeHistory({ refreshKey, onOpen, onAnalyze }: { refreshKey: string; onOpen: (challengeId: string) => void; onAnalyze: (challengeId: string) => void }) {
  const [entries, setEntries] = useState<ChallengeHistoryEntry[]>([])

  useEffect(() => {
    void fetch('/api/challenges/history')
      .then((response) => response.ok ? response.json() as Promise<ChallengeHistoryEntry[]> : [])
      .then((history) => setEntries(history))
  }, [refreshKey])

  return <section className="history-section challenge-history">
    <h2 className="centered-title">Past challenges</h2>
    {entries.length === 0 ? <div className="empty-library">No finished challenges yet.</div> : <div className="history-list">{entries.map((entry) => {
      const delta = entry.eloAfter !== null && entry.eloBefore !== null ? entry.eloAfter - entry.eloBefore : null
      return <div className="history-row history-button with-action" key={entry.id} role="button" tabIndex={0} onClick={() => onOpen(entry.id)}
        onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(entry.id) } }}>
        <div><strong>{entry.status === 'void' ? 'Voided challenge' : entry.gameTitle ?? 'Challenge'}</strong><span>{new Date(entry.completedAt ?? entry.createdAt).toLocaleDateString()} · {entry.baseSeconds / 60}+{entry.incrementSeconds} · {entry.players} players</span></div>
        <div><strong>{entry.rank ?? '—'}</strong><span>PLACE</span></div>
        <div><strong>{entry.accuracy === null ? '—' : `${Math.round(entry.accuracy)}%`}</strong><span>ACCURACY</span></div>
        <div><strong className={delta === null ? '' : delta >= 0 ? 'rating-gain' : 'rating-loss'}>{delta === null ? '—' : delta >= 0 ? `+${delta}` : delta}</strong><span>RATING</span></div>
        {entry.movesPlayed > 0 ? <button className="table-action secondary history-analyze" onClick={(event) => { event.stopPropagation(); onAnalyze(entry.id) }}>Analyze</button> : <span className="history-analyze" />}
      </div>
    })}</div>}
  </section>
}
