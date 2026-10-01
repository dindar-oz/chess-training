import { badgeDefinitions } from '../../shared/badges.ts'
import { useBadges } from '../badges/context'
import { badgeImages } from '../badges/images'
import { MainNav } from '../components/MainNav'
import { PageHeader } from '../components/PageHeader'
import type { AppView, AuthUser } from '../types'

type AwardsViewProps = {
  user: AuthUser
  onNavigate: (view: AppView) => void
  onLogout: () => void
}

export function AwardsView({ user, onNavigate, onLogout }: AwardsViewProps) {
  const { earned, loaded } = useBadges()
  const earnedById = new Map(earned.map((badge) => [badge.id, badge]))
  return <main className="app-shell awards-screen">
    <PageHeader eyebrow="REPLAY LAB / AWARDS" user={user} onLogout={onLogout} />
    <MainNav view="awards" isAdmin={user.role === 'admin'} onNavigate={onNavigate} />
    {loaded && <p className="badge-progress">{earned.length} of {badgeDefinitions.length} badges earned</p>}
    <section className="badge-grid">
      {badgeDefinitions.map((badge) => {
        const record = earnedById.get(badge.id)
        return <div key={badge.id} className={`badge-card ${record ? 'earned' : 'locked'}`}>
          <img src={badgeImages[badge.id]} alt={`${badge.name} badge`} className="badge-image" />
          <h3>{badge.name}</h3>
          <p>{record ? badge.description : badge.hint}</p>
          {record && <span className="badge-earned-date">Earned {new Date(record.earnedAt).toLocaleDateString()}</span>}
        </div>
      })}
    </section>
  </main>
}
