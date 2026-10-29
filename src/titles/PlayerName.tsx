import { chessTitles } from '../../shared/titles.ts'
import { useTitle } from './context'

// A member's name with their title, if any, in front of it ("IM Name").
export function PlayerName({ userId, name }: { userId: string | null | undefined; name: string }) {
  const title = useTitle(userId)
  return <>{title && <abbr className="player-title" title={chessTitles[title]}>{title}</abbr>}{name}</>
}
