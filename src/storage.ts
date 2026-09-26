// localStorage can be unavailable (private windows, blocked site data), so every
// access falls back quietly; nothing stored here is required for the app to work.
export function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage is a convenience only.
  }
}
