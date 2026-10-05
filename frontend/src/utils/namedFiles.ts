/** Mirrors `DEFAULT_NAME` in `src/soda/named_files.py`. */
export const DEFAULT_NAME = 'default'

/**
 * A server file named `default`, after an operator, or after a NORAD catalog number.
 *
 * Only logos carry `operator`; the model store rejects operator names.
 */
export interface NamedFile {
  name: string
  norad_id: number | null
  operator?: string | null
}

/**
 * The satellite's own file, else its operator's, else the shared default, else none.
 *
 * @param operator Operator slug from `operatorKey`. Callers without one (3D models) omit it.
 */
export function resolveNamed<T extends NamedFile>(
  items: readonly T[],
  noradId: number,
  operator?: string | null,
): T | null {
  return (
    items.find((item) => item.norad_id === noradId) ??
    (operator ? items.find((item) => item.operator === operator) : undefined) ??
    items.find((item) => item.name === DEFAULT_NAME) ??
    null
  )
}

function rank(item: NamedFile): [number, string, number] {
  if (item.name === DEFAULT_NAME) return [0, '', 0]
  if (item.operator) return [1, item.operator, 0]
  return [2, '', item.norad_id ?? 0]
}

/** Default first, then operators by name, then by NORAD number, matching the API order. */
export function sortNamed<T extends NamedFile>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const [aGroup, aName, aId] = rank(a)
    const [bGroup, bName, bId] = rank(b)
    return aGroup - bGroup || aName.localeCompare(bName) || aId - bId
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
