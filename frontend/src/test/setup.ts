import { beforeEach } from 'vitest'

// Stores persist to localStorage, so what one test saves the next one would load. Whether
// that happens depends on the Node version (newer ones shadow jsdom's storage with their
// own, which does nothing without a file), so every test starts from an empty one.
beforeEach(() => {
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    // No usable storage in this runtime: nothing can leak either.
  }
})
