import { useEffect, useState } from 'react'
import type { ChallengeHistoryEntry } from './types'

// Past challenges; reloads whenever `refreshKey` changes (e.g. a challenge completed).
export function ChallengeHistory({ refreshKey, onOpen }: { refreshKey: string; onOpen: (challengeId: string) => void }) {
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
      return <button className="history-row history-button" key={entry.id} onClick={() => onOpen(entry.id)}>
        <div><strong>{entry.status === 'void' ? 'Voided challenge' : entry.gameTitle ?? 'Challenge'}</strong><span>{new Date(entry.completedAt ?? entry.createdAt).toLocaleDateString()} · {entry.baseSeconds / 60}+{entry.incrementSeconds} · {entry.players} players</span></div>
        <div><strong>{entry.rank ?? '—'}</strong><span>PLACE</span></div>
        <div><strong>{entry.accuracy === null ? '—' : `${Math.round(entry.accuracy)}%`}</strong><span>ACCURACY</span></div>
        <div><strong className={delta === null ? '' : delta >= 0 ? 'rating-gain' : 'rating-loss'}>{delta === null ? '—' : delta >= 0 ? `+${delta}` : delta}</strong><span>RATING</span></div>
      </button>
    })}</div>}
  </section>
}
