// Training levels derived from total XP. Each level needs 100 XP more than the
// one before: level 2 at 100 XP, level 3 at 300, level 4 at 600, level 5 at 1000.

const xpStep = 100

// Total XP needed to reach `level` (level 1 starts at 0).
export function xpForLevel(level: number) {
  return (xpStep * level * (level - 1)) / 2
}

export function levelProgress(xp: number) {
  let level = 1
  while (xp >= xpForLevel(level + 1)) level += 1
  const floor = xpForLevel(level)
  const next = xpForLevel(level + 1)
  return { level, xpIntoLevel: xp - floor, xpForNext: next - floor, xpToNext: next - xp }
}
