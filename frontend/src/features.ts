/**
 * Uploaded GLB satellite models. Hidden unless the build sets `VITE_SODA_GLB_MODELS=1`
 * (for example in `frontend/.env.local`); the backend API stays available either way.
 */
export const GLB_MODELS = import.meta.env.VITE_SODA_GLB_MODELS === '1'

/**
 * The coverage analysis tool. Hidden unless the build sets `VITE_SODA_COVERAGE=1`: its grid,
 * metrics and cell picking need another pass before they are clear enough to show. The
 * backend API stays available either way.
 */
export const COVERAGE = import.meta.env.VITE_SODA_COVERAGE === '1'
