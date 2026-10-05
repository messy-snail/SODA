/**
 * Flags for search results, by ISO 3166-1 alpha-2 code.
 *
 * Unlike stations/flags.ts, a search can name any country, so every 4:3 flag in flag-icons
 * (MIT, see THIRD_PARTY_NOTICES.md) is emitted as its own small asset. Only the URLs reach
 * the bundle; a flag downloads when a result row shows it.
 */
const FILES = import.meta.glob('../../node_modules/flag-icons/flags/4x3/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

const BY_CODE = new Map(
  Object.entries(FILES).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.svg'.length).toUpperCase(),
    url,
  ]),
)

/** URL of the country's flag, or null when flag-icons has none for the code. */
export function countryFlagUrl(iso2: string): string | null {
  return iso2 ? (BY_CODE.get(iso2.toUpperCase()) ?? null) : null
}
