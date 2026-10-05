/** Fade out the pre-mount splash painted by index.html once the globe has drawn a frame. */
export function hideBootSplash(): void {
  // ``?splash=hold`` keeps the splash on screen so browser tests can photograph it.
  if (new URLSearchParams(location.search).get('splash') === 'hold') return
  const boot = document.getElementById('boot')
  if (!boot) return
  boot.classList.add('is-done')
  setTimeout(() => boot.remove(), 400)
}
