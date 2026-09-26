import { useState } from 'react'
import { MainNav } from '../components/MainNav'
import { PageHeader } from '../components/PageHeader'
import type { AppView, AuthUser, GameFilter, GameRecord } from '../types'

const gamesPerPage = 20

type LibraryViewProps = {
  user: AuthUser
  games: GameRecord[]
  sessionCount: number
  searchQuery: string
  gameFilter: GameFilter
  gamePage: number
  onSearchChange: (query: string) => void
  onFilterChange: (filter: GameFilter) => void
  onPageChange: (page: number) => void
  onTrain: (gameId: string) => void
  onDeleteGame: (gameId: string) => Promise<void>
  onNavigate: (view: AppView) => void
  onLogout: () => void
}

export function LibraryView(props: LibraryViewProps) {
  const { user, games, gameFilter, searchQuery } = props
  const [deleteError, setDeleteError] = useState('')
  const isAdmin = user.role === 'admin'
  const filteredGames = games.filter((game) => {
    const haystack = `${game.title} ${game.white} ${game.black} ${game.event}`.toLocaleLowerCase()
    const matchesQuery = haystack.includes(searchQuery.toLocaleLowerCase())
    const matchesFilter = gameFilter === 'all' || (gameFilter === 'decisive' ? game.result !== '1/2-1/2' && game.result !== '*' : game.result === '1/2-1/2')
    return matchesQuery && matchesFilter
  })
  const totalGamePages = Math.max(1, Math.ceil(filteredGames.length / gamesPerPage))
  const gamePage = Math.min(props.gamePage, totalGamePages)
  const visibleGames = filteredGames.slice((gamePage - 1) * gamesPerPage, gamePage * gamesPerPage)
  const paginationItems: Array<number | 'ellipsis'> = totalGamePages <= 7
    ? Array.from({ length: totalGamePages }, (_, index) => index + 1)
    : [
      1,
      ...(gamePage > 4 ? ['ellipsis' as const] : []),
      ...Array.from({ length: 3 }, (_, index) => gamePage - 1 + index).filter((page) => page > 1 && page < totalGamePages),
      ...(gamePage < totalGamePages - 3 ? ['ellipsis' as const] : []),
      totalGamePages,
    ]

  async function deleteGame(game: GameRecord) {
    if (!window.confirm(`Delete "${game.title}" from the game library? Past training sessions keep their records.`)) return
    setDeleteError('')
    try {
      await props.onDeleteGame(game.id)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete the game.')
    }
  }

  return <main className="app-shell library-screen">
    <PageHeader eyebrow="REPLAY LAB / LIBRARY" title={<>Study the<br /><em>great games.</em></>} user={user} onLogout={props.onLogout} meta={<>{games.length} GAMES <strong>{props.sessionCount} SESSIONS</strong><strong>{user.elo} ELO</strong><strong>{user.xp} XP</strong></>} />
    <MainNav view="library" isAdmin={isAdmin} onNavigate={props.onNavigate} />
    <section className="library-toolbar">
      <div><p className="section-label">GAME DATABASE</p><h2>{filteredGames.length} games ready to study</h2></div>
      <div className="library-controls"><input value={searchQuery} onChange={(event) => props.onSearchChange(event.target.value)} placeholder="Search players or events" aria-label="Search games" /><div className="filter-group"><button className={gameFilter === 'all' ? 'selected' : ''} onClick={() => props.onFilterChange('all')}>All</button><button className={gameFilter === 'decisive' ? 'selected' : ''} onClick={() => props.onFilterChange('decisive')}>Decisive</button><button className={gameFilter === 'draw' ? 'selected' : ''} onClick={() => props.onFilterChange('draw')}>Draws</button></div></div>
    </section>
    {deleteError && <p className="admin-error">{deleteError}</p>}
    <div className="games-table-wrap"><table className="games-table"><thead><tr><th>Game</th><th>Event</th><th>Date</th><th>Result</th><th>Length</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visibleGames.map((game) => <tr key={game.id}><td><strong>{game.title}</strong><span>{game.white} vs {game.black}</span></td><td>{game.event}</td><td>{game.date}</td><td><b className="result-badge">{game.result}</b></td><td>{game.plyCount} plies</td><td><div className="row-actions"><button className="table-action" onClick={() => props.onTrain(game.id)}><span className="button-icon" aria-hidden="true">↗</span> Train</button>{isAdmin && <button className="table-action danger" onClick={() => void deleteGame(game)}>Delete</button>}</div></td></tr>)}</tbody></table></div>
    {filteredGames.length === 0 && <div className="empty-library">No games match this search.</div>}
    {filteredGames.length > 0 && <nav className="pagination" aria-label="Game library pages"><button className="page-button" disabled={gamePage === 1} onClick={() => props.onPageChange(gamePage - 1)}>← Previous</button><div className="page-numbers">{paginationItems.map((item, index) => item === 'ellipsis' ? <span className="page-ellipsis" key={`ellipsis-${index}`}>...</span> : <button key={item} className={`page-button ${item === gamePage ? 'current' : ''}`} aria-current={item === gamePage ? 'page' : undefined} onClick={() => props.onPageChange(item)}>{item}</button>)}</div><button className="page-button" disabled={gamePage === totalGamePages} onClick={() => props.onPageChange(gamePage + 1)}>Next →</button></nav>}
    {isAdmin && <p className="library-admin-hint">To add games, go to the <button className="text-button" onClick={() => props.onNavigate('admin')}>Admin panel →</button></p>}
  </main>
}
