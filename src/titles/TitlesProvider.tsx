import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { useRealtimeEvent } from '../realtime/context'
import { TitlesContext } from './context'

type TitlesProviderProps = {
  children: ReactNode
  // An admin changed something on the player's own account, such as their ELO.
  onAccountChanged: () => void
}

// Loads members' titles on every (re)connection; the server pushes the whole list
// again whenever an admin changes one.
export function TitlesProvider({ children, onAccountChanged }: TitlesProviderProps) {
  const [titles, setTitles] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    void fetch('/api/titles')
      .then((response) => response.ok ? response.json() as Promise<Record<string, string>> : null)
      .then((result) => { if (result) setTitles(result) })
      .catch(() => undefined)
  }, [])

  useRealtimeEvent('hello', load)
  useRealtimeEvent('titles', (data) => setTitles(data as Record<string, string>))
  useRealtimeEvent('account_updated', onAccountChanged)

  return <TitlesContext.Provider value={titles}>{children}</TitlesContext.Provider>
}
