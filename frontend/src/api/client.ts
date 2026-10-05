import type {
  AccessResponse,
  TmtcStatus,
  AccessTargetRequest,
  ApiMessage,
  Category,
  CatalogDetail,
  CoverageGrid,
  CoverageResponse,
  CustomElementSummary,
  CustomEphemerisSummary,
  CustomStateInput,
  CustomStateSummary,
  DatabasePage,
  DatabaseProbe,
  DatabaseStatus,
  DatabaseTable,
  ElementImportResult,
  ImageryCatalogImport,
  ImageryCatalogSearch,
  ImageryCatalogSource,
  ImageryInbox,
  ImagerySamples,
  ImagerySensor,
  ImagerySet,
  ImageryUpload,
  LogoInfo,
  ModelInfo,
  ModelSettings,
  Omm,
  PassesResponse,
  PowerRequest,
  PowerResponse,
  PropagateRequest,
  PropagateResponse,
  SatelliteRefParams,
  SearchResult,
  SensorPreset,
  SensorPresetInput,
  SensorRequest,
  Station,
  StationInput,
  StatusResponse,
  SwathResponse,
  UserDataImportResult,
} from './types'

import { translate } from '../i18n'

const BASE = '/api/v1'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Translation key suffix when the server tagged the failure; null for plain text. */
    readonly code: string | null = null,
    readonly params: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

function detail(body: unknown): unknown {
  return (body as { detail?: unknown } | null)?.detail
}

function isApiMessage(value: unknown): value is ApiMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as ApiMessage).code === 'string'
  )
}

function apiError(body: unknown, status: number): ApiError {
  const payload = detail(body)
  if (isApiMessage(payload)) {
    return new ApiError(payload.message, status, payload.code, payload.params ?? {})
  }
  if (typeof payload === 'string') return new ApiError(payload, status)
  if (Array.isArray(payload) && payload.length) {
    return new ApiError(
      payload.map((item) => (item as { msg?: string }).msg ?? String(item)).join(', '),
      status,
    )
  }
  return new ApiError(translate('errors.requestFailed', { status }), status, 'requestFailed', {
    status,
  })
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    })
  } catch (error) {
    // Let callers distinguish their own cancellations from network failures.
    if (init.signal?.aborted) throw error
    throw new ApiError(translate('errors.networkUnreachable'), 0, 'networkUnreachable')
  }
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => null)
  if (!response.ok) throw apiError(body, response.status)
  return body as T
}

const post = <T>(path: string, body: unknown, signal?: AbortSignal) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body), signal })

export const api = {
  status: () => request<StatusResponse>('/status'),
  search: (
    q: string,
    limit = 20,
    filter: { group?: string; categories?: readonly Category[] } = {},
  ) => {
    const params = new URLSearchParams({ q, limit: String(limit) })
    if (filter.group) params.set('group', filter.group)
    for (const category of filter.categories ?? []) params.append('category', category)
    return request<SearchResult[]>(`/catalog/search?${params}`)
  },
  customElements: () => request<CustomElementSummary[]>('/custom-elements'),
  customElement: (id: number) => request<CatalogDetail>(`/custom-elements/${id}`),
  createCustomElement: (body: { name: string; text: string }) =>
    post<CatalogDetail>('/custom-elements', body),
  importCustomElements: (file: Blob) =>
    request<ElementImportResult>('/custom-elements/import', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
  deleteCustomElement: (id: number) =>
    request<void>(`/custom-elements/${id}`, { method: 'DELETE' }),
  customStates: () => request<CustomStateSummary[]>('/custom-states'),
  customState: (id: number) => request<CatalogDetail>(`/custom-states/${id}`),
  createCustomState: (body: CustomStateInput) => post<CatalogDetail>('/custom-states', body),
  importCustomState: (file: Blob) =>
    request<CatalogDetail>('/custom-states/import', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
  deleteCustomState: (id: number) => request<void>(`/custom-states/${id}`, { method: 'DELETE' }),
  customEphemerides: () => request<CustomEphemerisSummary[]>('/custom-ephemerides'),
  customEphemeris: (id: number) => request<CatalogDetail>(`/custom-ephemerides/${id}`),
  importCustomEphemeris: (file: Blob, name = '') =>
    request<CatalogDetail>(
      `/custom-ephemerides${name ? `?${new URLSearchParams({ name })}` : ''}`,
      { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } },
    ),
  deleteCustomEphemeris: (id: number) =>
    request<void>(`/custom-ephemerides/${id}`, { method: 'DELETE' }),
  catalog: (noradId: number) => request<CatalogDetail>(`/catalog/${noradId}`),
  refreshGroup: (group: string) =>
    post<{ group: string; result: string }>(`/gp/${encodeURIComponent(group)}/refresh`, {}),
  group: (group: string) => request<Omm[]>(`/gp/${encodeURIComponent(group)}`),
  propagate: (body: PropagateRequest, signal?: AbortSignal) =>
    post<PropagateResponse>('/propagate', body, signal),
  swath: (body: PropagateRequest & { sensor: SensorRequest }, signal?: AbortSignal) =>
    post<SwathResponse>('/swath', body, signal),
  passes: (
    body: {
      satellites: (SatelliteRefParams & { start: string; end: string })[]
      station_ids: number[]
      min_elev_deg?: number
      turnaround_s: number
    },
    signal?: AbortSignal,
  ) => post<PassesResponse>('/passes', body, signal),
  access: (
    body: SatelliteRefParams & {
      targets: AccessTargetRequest[]
      start: string
      end: string
      mode: 'roll' | 'roll_pitch'
      max_roll_deg: number
      max_pitch_deg: number
      fov_deg: number
      min_sun_elev_deg: number
      shot_s: number
    },
    signal?: AbortSignal,
  ) => post<AccessResponse>('/access', body, signal),
  coverage: (
    body: SatelliteRefParams &
      CoverageGrid & {
        start: string
        end: string
        mode: 'roll' | 'roll_pitch'
        max_roll_deg: number
        max_pitch_deg: number
        fov_deg: number
        min_sun_elev_deg: number
      },
    signal?: AbortSignal,
  ) => post<CoverageResponse>('/coverage', body, signal),
  power: (body: PowerRequest, signal?: AbortSignal) => post<PowerResponse>('/power', body, signal),
  tmtcStart: (body: SatelliteRefParams & { start: string; end: string; station_ids: number[] }) =>
    post<TmtcStatus>('/tmtc/session', body),
  tmtcStatus: () => request<TmtcStatus | { type: 'stopped' }>('/tmtc/session'),
  tmtcStop: () => request<void>('/tmtc/session', { method: 'DELETE' }),
  stations: () => request<Station[]>('/stations'),
  createStation: (body: StationInput) => post<Station>('/stations', body),
  updateStation: (id: number, body: StationInput) =>
    request<Station>(`/stations/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteStation: (id: number) => request<void>(`/stations/${id}`, { method: 'DELETE' }),
  sensorPresets: () => request<SensorPreset[]>('/sensor-presets'),
  createSensorPreset: (body: SensorPresetInput) => post<SensorPreset>('/sensor-presets', body),
  updateSensorPreset: (id: number, body: SensorPresetInput) =>
    request<SensorPreset>(`/sensor-presets/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSensorPreset: (id: number) => request<void>(`/sensor-presets/${id}`, { method: 'DELETE' }),
  models: () => request<ModelInfo[]>('/models'),
  uploadModel: (name: string, file: Blob) =>
    request<ModelInfo>(`/models/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
  saveModelSettings: (name: string, settings: ModelSettings) =>
    request<ModelInfo>(`/models/${encodeURIComponent(name)}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  deleteModel: (name: string) =>
    request<void>(`/models/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  logos: () => request<LogoInfo[]>('/logos'),
  uploadLogo: (name: string, png: Blob) =>
    request<LogoInfo>(`/logos/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: png,
      headers: { 'Content-Type': 'image/png' },
    }),
  deleteLogo: (name: string) =>
    request<void>(`/logos/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  imagery: () => request<ImagerySet[]>('/imagery'),
  imageryInbox: () => request<ImageryInbox>('/imagery/inbox'),
  imagerySamples: () => request<ImagerySamples>('/imagery/samples'),
  searchImageryCatalog: (
    source: ImageryCatalogSource,
    [west_deg, south_deg, east_deg, north_deg]: readonly [number, number, number, number],
  ) =>
    request<ImageryCatalogSearch>(
      `/imagery/catalog/search?${new URLSearchParams({
        source,
        west_deg: String(west_deg),
        south_deg: String(south_deg),
        east_deg: String(east_deg),
        north_deg: String(north_deg),
      })}`,
    ),
  importFromImageryCatalog: (source: ImageryCatalogSource, item_ids: string[]) =>
    post<ImageryCatalogImport>('/imagery/catalog/import', { source, item_ids }),
  uploadImagery: (upload: ImageryUpload, file: Blob) => {
    const query = new URLSearchParams({
      source_format: upload.source_format,
      name: upload.name,
      attribution: upload.attribution,
      license: upload.license,
    })
    if (upload.acquired_at) query.set('acquired_at', upload.acquired_at)
    if (upload.corners_deg) query.set('corners_deg', upload.corners_deg.join(','))
    if (upload.sensor) query.set('sensor', upload.sensor)
    return request<ImagerySet>(`/imagery?${query}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  },
  updateImagery: (
    id: string,
    body: {
      name: string
      attribution: string
      license: string
      acquired_at: string | null
      /** An empty string clears it. */
      sensor: ImagerySensor | ''
    },
  ) =>
    request<ImagerySet>(`/imagery/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteImagery: (id: string) =>
    request<void>(`/imagery/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  databaseStatus: () => request<DatabaseStatus>('/settings/database'),
  testDatabase: (url: string) => post<DatabaseProbe>('/settings/database/test', { url }),
  saveDatabase: (url: string) =>
    request<DatabaseStatus>('/settings/database', { method: 'PUT', body: JSON.stringify({ url }) }),
  databaseTables: () => request<DatabaseTable[]>('/database/tables'),
  databasePage: (table: string, offset: number, limit: number, q: string, signal?: AbortSignal) =>
    request<DatabasePage>(
      `/database/tables/${encodeURIComponent(table)}?${new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
        q,
      })}`,
      { signal },
    ),
  importUserData: (data: unknown) => post<UserDataImportResult>('/database/import', data),
}

/** Download URLs; the server names the file through `Content-Disposition`. */
export const databaseDownloads = {
  userData: `${BASE}/database/export`,
  database: `${BASE}/database/download`,
}

/** Image URL for a logo; the version query changes whenever the file is replaced. */
export function logoUrl(logo: LogoInfo): string {
  return `${BASE}/logos/${encodeURIComponent(logo.name)}.png?v=${encodeURIComponent(logo.updated_at)}`
}

/** File URL for a model; the version query changes whenever the file is replaced. */
export function modelUrl(model: ModelInfo): string {
  return `${BASE}/models/${encodeURIComponent(model.name)}.glb?v=${encodeURIComponent(model.updated_at)}`
}

/**
 * Tile URL template for an imagery set, with Cesium's `{z}/{x}/{y}` placeholders. The version
 * query keeps a browser cache from outliving an edit.
 */
export function imageryTileUrl(item: ImagerySet): string {
  const version = encodeURIComponent(item.updated_at)
  return `${BASE}/imagery/${encodeURIComponent(item.id)}/tiles/{z}/{x}/{y}?v=${version}`
}

/** WebSocket URL of the simulated TC/TM link, on whatever host served the app. */
export function tmtcSocketUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}${BASE}/tmtc/ws`
}
