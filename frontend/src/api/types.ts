import type { HpopOptions, Propagator } from '../orbit/propagatorOptions'

export type Category = 'DEBRIS' | 'LEO' | 'GEO' | 'HEO' | 'MEO'

export interface Omm {
  OBJECT_NAME: string
  OBJECT_ID: string
  EPOCH: string
  NORAD_CAT_ID: number
  MEAN_MOTION: number
  ECCENTRICITY: number
  INCLINATION: number
  RA_OF_ASC_NODE: number
  ARG_OF_PERICENTER: number
  MEAN_ANOMALY: number
  BSTAR: number
  MEAN_MOTION_DOT: number
  MEAN_MOTION_DDOT: number
  EPHEMERIS_TYPE: number
  CLASSIFICATION_TYPE: string
  ELEMENT_SET_NO: number
  REV_AT_EPOCH: number
}

export interface ElementSummary {
  norad_id: number
  name: string
  object_id: string
  epoch: string
  source: string
}

export interface SearchResult extends ElementSummary {
  category: Category
}

export interface OrbitSummary {
  category: Category
  period_min: number
  inclination_deg: number
  eccentricity: number
  semi_major_axis_km: number
  apogee_alt_km: number
  perigee_alt_km: number
  /** Set when the values describe the orbit through one state, not mean elements. */
  osculating?: boolean
}

export interface CatalogDetail extends ElementSummary {
  groups: string[]
  orbit: OrbitSummary
  tle: [string, string] | null
  /** Null for a state vector, which has no mean elements. */
  omm: Omm | null
  /** Set when the elements are ones the user saved rather than a catalog entry. */
  custom_id?: number | null
  /** Set when this is a saved state vector; `norad_id` is then 0. */
  state_id?: number | null
  /** Set when this is an imported ephemeris; `norad_id` is then 0. */
  ephemeris_id?: number | null
  /** Frame a state vector or an ephemeris was given in. */
  frame?: string
  /** First and last time an imported ephemeris covers. */
  span_start?: string
  span_end?: string
  sample_count?: number
}

/** Elements the user pasted (TLE or OMM) and saved under a name. */
export interface CustomElementSummary {
  id: number
  name: string
  norad_id: number
  epoch: string
  input_format: 'tle' | 'omm'
  category: Category
  created_at: string
}

/** What importing a TLE or OMM file stored, and which records it left out. */
export interface ElementImportResult {
  format: 'tle' | 'json' | 'xml' | 'kvn' | 'csv'
  /** Records found in the file, usable or not. */
  total: number
  created: CustomElementSummary[]
  /** `index` is the record's position in the file, from zero. */
  skipped: { index: number; name: string; reason: 'invalid' | 'duplicate' }[]
}

/** A state vector the user typed in or imported as an OPM. */
export interface CustomStateSummary {
  id: number
  name: string
  epoch: string
  /** Frame it was given in; it is stored in GCRS. */
  frame: string
  input_format: 'form' | 'opm'
  category: Category
  created_at: string
}

/** A state vector as the form sends it, in the frame named by `frame`. */
export interface CustomStateInput {
  name: string
  epoch: string
  frame: string
  x_m: number
  y_m: number
  z_m: number
  vx_m_s: number
  vy_m_s: number
  vz_m_s: number
  mass_kg?: number
  drag_area_m2?: number
  cd?: number
  srp_area_m2?: number
  cr?: number
}

/** An ephemeris the user imported as an OEM file. */
export interface CustomEphemerisSummary {
  id: number
  name: string
  start: string
  stop: string
  sample_count: number
  frame: string
  created_at: string
}

/** Exactly one id names the satellite a request is about. */
export type SatelliteRefParams =
  { norad_id: number } | { custom_id: number } | { state_id: number } | { ephemeris_id: number }

export interface FetchStatus {
  source: string
  key: string
  last_attempt_at: string
  last_ok_at: string | null
  last_status: string
  detail: string
  consecutive_errors: number
  object_count: number
  next_allowed_at: string | null
}

export interface StatusResponse {
  objects: number
  spacetrack_enabled: boolean
  auto_refresh: boolean
  refresh_groups: string[]
  fetches: FetchStatus[]
}

export type PropagateRequest = SatelliteRefParams & {
  start: string
  end: string
  step_s: number
  /** Left out, the server picks the default for the satellite's kind of source. */
  propagator?: Propagator
  /** Only read when the propagator is `hpop`. */
  hpop?: HpopOptions
}

/** The force model and spacecraft an HPOP run used, as the server resolved them. */
export interface ForceModel {
  gravity_degree: number
  gravity_order: number
  third_body: boolean
  drag: boolean
  srp: boolean
  mass_kg: number
  drag_area_m2: number
  cd: number
  srp_area_m2: number
  cr: number
  /** Weakest source a spacecraft value that mattered came from. */
  spacecraft_source: 'request' | 'state' | 'bstar' | 'default'
  initial_state: 'sgp4AtEpoch' | 'stateVector'
  integrator: string
  rtol: number
  atol_m: number
}

export interface PropagateResponse {
  element_set: ElementSummary & {
    /** Null for an imported ephemeris, which has a span rather than an epoch. */
    age_days: number | null
    tle: [string, string] | null
    omm: Omm | null
    custom_id?: number | null
    state_id?: number | null
    ephemeris_id?: number | null
    span_start?: string
    span_end?: string
  }
  orbit: OrbitSummary
  propagator: Propagator
  /** Null unless the propagator is `hpop`. */
  force_model: ForceModel | null
  start: string
  step_s: number
  count: number
  invalid: number[]
  fixed_m: number[]
  inertial_m: number[]
  lat_deg: number[]
  lon_deg: number[]
  alt_km: number[]
  /**
   * Eclipse intervals as seconds from `start`, flat `[enter0, exit0, ...]`. Null when the
   * server has no solar ephemeris; absent on runs stored before the field existed.
   */
  eclipse_s?: number[] | null
  /**
   * Sun angle off the orbit plane, thinned to a few hundred points: seconds from `start` and
   * degrees, positive on the side of the angular momentum. Null and absent as `eclipse_s`.
   */
  beta_offset_s?: number[] | null
  beta_deg?: number[] | null
  warnings: ApiMessage[]
}

export interface SensorRequest {
  fov_deg?: number
  swath_km?: number
  max_off_nadir_deg: number
  min_sun_elev_deg: number
}

/** Server-side message the frontend translates by code, with a fallback already rendered. */
export interface ApiMessage {
  code: string
  message: string
  params?: Record<string, unknown>
}

/** Older responses sent plain strings; the helpers stay tolerant of both. */
export type ApiWarning = string | ApiMessage

export interface SwathSegment {
  kind: 'nadir' | 'for'
  daylight: boolean
  i0: number
  i1: number
  /** Flattened [lon, lat, lon, lat, ...] in degrees. */
  left: number[]
  right: number[]
}

export interface SwathResponse {
  fov_deg: number
  nadir_width_km: number
  for_width_km: number | null
  daylight_fraction: number
  segments: SwathSegment[]
  warnings: ApiMessage[]
}

/** A box cut into `nx` columns from the west and `ny` rows from the south. */
export interface CoverageGrid {
  west_deg: number
  south_deg: number
  east_deg: number
  north_deg: number
  nx: number
  ny: number
}

/** Imaging events of every cell of a grid, for one satellite. */
export interface CoverageResponse {
  element_set: ElementSummary
  start: string
  end: string
  grid: CoverageGrid
  /** Events per cell; cell `row * nx + column`. */
  counts: number[]
  /** Whole seconds from `start`, cell after cell, ascending within a cell. */
  offset_s: number[]
  warnings: ApiMessage[]
}

/** Imaging target: a point, or a longitude/latitude box (`east_deg < west_deg` wraps). */
export type AccessTargetRequest =
  | { id: string; lat_deg: number; lon_deg: number }
  | { id: string; west_deg: number; south_deg: number; east_deg: number; north_deg: number }

export interface AccessWindow {
  start: string
  end: string
  /** Pitch-0 moment for a point; the most-covered moment for a box. Roll-only points have start = end = best_time. */
  best_time: string
  duration_s: number
  min_off_nadir_deg: number
  /** Roll at `best_time`, positive to the right of the ground track. */
  roll_deg: number
  /** Pitch at `best_time`, positive ahead; 0 in the roll-only model. */
  pitch_deg: number
  /** Where the sensor points at `best_time`: the point, or the middle of a box's seen part. */
  aim_lat_deg: number
  aim_lon_deg: number
  target_sun_elev_deg: number
  /** Share of the box grid accessible at `best_time`; 1 or 0 for a point. */
  coverage: number
  ascending: boolean
  clipped_start: boolean
  clipped_end: boolean
  /** Span imaged: `shot_s` around `best_time`, or a roll-only box's whole sweep. */
  shot_start: string
  shot_end: string
  /** Ground edges of the imaged strip, flattened `[lon, lat, ...]`, one point per second. */
  strip: { left: number[]; right: number[] }
  /** Satellite ITRS positions over the shot, sampled like `strip`. */
  track_fixed_m: number[]
}

/** Passes over a target's centre, and what kept some of them from being windows. */
export interface AccessDiagnosis {
  /** Passes with the centre within roll reach and above the satellite's horizon. */
  passes: number
  /** Those of them without enough Sun at the target. */
  dark: number
  /** Highest Sun elevation among the dark passes; null without any. */
  best_sun_elev_deg: number | null
  /** Smallest roll any pass needed; null when the satellite never passed in view. */
  nearest_roll_deg: number | null
}

export interface AccessResponse {
  element_set: ElementSummary
  results: { target_id: string; windows: AccessWindow[]; diagnosis: AccessDiagnosis }[]
  warnings: ApiMessage[]
}

/** Commands the simulated spacecraft understands (`tmtc/packets.py`). */
export type SpacecraftMode = 'SAFE' | 'NOMINAL' | 'IMAGING'
export type TmtcCommand =
  | { command: 'NOOP' }
  | { command: 'SET_MODE'; mode: SpacecraftMode }
  | { command: 'TIME_TAG'; execute_ms: number; inner: TmtcCommand }

export interface TmtcHousekeeping {
  time_ms: number
  mode: SpacecraftMode
  command_count: number
  rejected_count: number
  battery_pct: number
  storage_pct: number
}

export interface TmtcLink {
  type: 'link'
  open: boolean
  time_ms: number
  station_id: number | null
  /** One-way light time at culmination of the open contact. */
  delay_ms: number | null
  next_aos_ms: number | null
  /** Commands waiting on the ground for the next AOS. */
  queued: number
  /** Telemetry stored onboard for playback. */
  onboard: number
}

export interface TmtcPacket {
  type: 'packet'
  dir: 'up' | 'down'
  apid: number
  seq: number
  time_ms: number
  /** Stored onboard out of contact and played back at AOS. */
  replay: boolean
  hex: string
  decoded: Record<string, unknown>
}

export interface TmtcContact {
  aos_ms: number
  los_ms: number
  station_id: number
  /** Flat ITRS metres sampled evenly from AOS to LOS, like `Pass.track_fixed_m`. */
  track_fixed_m: number[]
}

export interface TmtcStatus {
  type: 'status'
  name: string
  contacts: TmtcContact[]
  link: TmtcLink | null
  hk: TmtcHousekeeping | null
}

export type TmtcMessage =
  | TmtcStatus
  | TmtcLink
  | TmtcPacket
  | { type: 'stopped' }
  | { type: 'reset'; time_ms: number }
  | { type: 'queued'; command: Record<string, unknown>; queued: number }
  | { type: 'dropped'; count: number }
  | ({ type: 'error' } & ApiMessage)

export interface AzMaskPoint {
  az_deg: number
  min_elev_deg: number
}

export interface Station {
  id: number
  name: string
  lat_deg: number
  lon_deg: number
  alt_m: number
  min_elev_deg: number
  /** Catalog entry this station came from, or null when it was typed in by hand. */
  preset_id: string | null
  /** Horizon mask vertices; an empty list means a uniform horizon at min_elev_deg. */
  az_mask: AzMaskPoint[]
}

/** A sensor setup the user saved under a name; both widths travel, `mode` says which drives. */
export interface SensorPreset {
  id: number
  name: string
  mode: 'swath' | 'fov'
  swath_km: number
  fov_deg: number
  max_off_nadir_deg: number
  min_sun_elev_deg: number
}

export type SensorPresetInput = Omit<SensorPreset, 'id'>

export type StationInput = Omit<Station, 'id' | 'preset_id' | 'az_mask'> &
  Partial<Pick<Station, 'preset_id' | 'az_mask'>>

export interface Pass {
  /** `<satellite index>:<station id>:<AOS>`, unique within one prediction. */
  id: string
  /** Priority index of the satellite in the request; 0 wins conflicts. */
  satellite_index: number
  /** `rejected`: the station was already serving a higher-priority satellite. */
  status: 'assigned' | 'rejected'
  /** Ids of the passes at the same station it overlaps, antenna turnaround included. */
  conflict_with: string[]
  station_id: number
  aos: string
  tca: string
  los: string
  duration_s: number
  max_elevation_deg: number
  /** Slant range to the satellite at TCA. */
  tca_range_km: number
  aos_azimuth_deg: number
  tca_azimuth_deg: number
  los_azimuth_deg: number
  satellite_sunlit: boolean
  observer_sun_alt_deg: number
  visible: boolean
  /** Runs past an edge of the requested window; AOS/LOS are still the real ones. */
  partial: boolean
  /** The contact outlasted the search margin, so ``aos`` is the search edge, not a rise. */
  clipped_start: boolean
  /** The contact outlasted the search margin, so ``los`` is the search edge, not a set. */
  clipped_end: boolean
  /** Index of the window this contact came from; a mask can split one window in two. */
  pass_index: number
  /** The horizon mask, not the uniform minimum, set the elevation at one of the ends. */
  mask_limited: boolean
  /** Earth-fixed track sampled evenly from AOS to LOS, flat metres; empty if SGP4 failed. */
  track_fixed_m: number[]
}

export interface Visibility {
  radius_km: number
  max_radius_km: number
  /** Closed [lon, lat] ring; lobed rather than circular when the station has a mask. */
  ring: [number, number][]
}

export interface PassResult {
  station: Station
  min_elev_deg: number
  visibility: Visibility
  passes: Pass[]
}

/** One satellite of a pass prediction: its elements, span, and passes per station. */
export interface PassSatellite {
  index: number
  element_set: ElementSummary
  start: string
  end: string
  /** One entry per requested station, in the order they were asked for. */
  results: PassResult[]
}

export interface PassesResponse {
  /** In priority order; the first wins a conflict at a shared station. */
  satellites: PassSatellite[]
  turnaround_s: number
  assigned: number
  rejected: number
  warnings: ApiMessage[]
}

export interface ModelSettings {
  /** Body-frame rotation applied after aligning +X with velocity and +Z with local up. */
  heading_deg: number
  pitch_deg: number
  roll_deg: number
  scale: number
  minimum_size_px: number
}

export interface LogoInfo {
  /** `default`, an operator slug, or a NORAD catalog number. */
  name: string
  norad_id: number | null
  operator: string | null
  /** The served file is the one bundled with the package, so it cannot be deleted. */
  builtin: boolean
  /** A bundled file with this name exists, so an upload over it can be reverted. */
  has_builtin: boolean
  size_bytes: number
  updated_at: string
}

export interface ModelInfo {
  /** `default` or a NORAD catalog number. */
  name: string
  norad_id: number | null
  size_bytes: number
  updated_at: string
  settings: ModelSettings
}

/** Formats that can be uploaded. */
export type ImagerySourceFormat = 'mbtiles' | 'image' | 'geotiff'
/** What a set was made from. A scene product only comes in through the inbox folder. */
export type ImagerySetFormat = ImagerySourceFormat | 'scene'
/** What took the picture: a camera, or a synthetic aperture radar. */
export type ImagerySensor = 'optical' | 'sar'

/**
 * A set of user imagery. The tiling fields are null until `status` is `ready`: a set that is
 * still being cut, or whose import failed, only knows what the upload said about it.
 */
export interface ImagerySet {
  id: string
  name: string
  status: 'ready' | 'processing' | 'failed'
  source_format: ImagerySetFormat
  west_deg: number | null
  south_deg: number | null
  east_deg: number | null
  north_deg: number | null
  /** Outline `[lon0, lat0, ...]` when it is tighter than the bounding box. */
  footprint: number[] | null
  min_zoom: number | null
  max_zoom: number | null
  tile_format: string | null
  tile_count: number | null
  /** Ground size of a pixel in metres: measured, stated by the source, or of the deepest tiles. */
  gsd_m: number | null
  size_bytes: number | null
  attribution: string
  /** Licence name as the source states it, such as `CC BY-NC 4.0`; empty when unknown. */
  license: string
  /** `<source>:<item id>` when SODA fetched the set from a catalogue itself. */
  origin: string | null
  acquired_at: string | null
  created_at: string
  /** Null when nobody said what took the picture. */
  sensor: ImagerySensor | null
  /** Names in both languages; only samples have them, the rest go by `name`. */
  label: { ko: string; en: string } | null
  /** From the read-only `samples` submodule, so it can be neither edited nor deleted. */
  sample: boolean
  updated_at: string
  /** What a `processing` set is doing; null otherwise. */
  stage: 'queued' | 'downloading' | 'tiling' | null
  /** Fraction of the import done so far, while `processing`. */
  progress: number | null
  error: ApiMessage | null
}

export type ImageryCatalogSource = 'maxar' | 'oam'

/** One item a catalogue search found. Details a search did not look up are null. */
export interface ImageryCandidate {
  source: ImageryCatalogSource
  /** Catalogue id; the only thing sent back to import the item. */
  item_id: string
  title: string
  west_deg: number
  south_deg: number
  east_deg: number
  north_deg: number
  /** Ground sample distance in metres. */
  gsd_m: number | null
  acquired_at: string | null
  license: string
  attribution: string
  size_bytes: number | null
  pixels: number | null
  clouds_percent: number | null
  /** False when the server would refuse to fetch it; `reason` says why. */
  importable: boolean
  reason: 'tooLarge' | 'hostNotAllowed' | null
}

export interface ImageryCatalogSearch {
  source: ImageryCatalogSource
  found: number
  /** More matched than are listed. */
  truncated: boolean
  results: ImageryCandidate[]
}

export interface ImageryCatalogImport {
  /** Imports now in the list, downloading. */
  queued: ImagerySet[]
  skipped: { item_id: string; code: string }[]
}

/** The watched folder under `data/imagery`, from `GET /imagery/inbox`. */
export interface ImageryInbox {
  /** False when the server runs with `imagery_inbox = false`. */
  enabled: boolean
  /** Absolute path of the folder on the server. */
  path: string | null
  /** Files not imported yet, and why: still being copied, missing corners, or no room. */
  waiting: { file: string; reason: 'settling' | 'needsCorners' | 'full' }[]
}

/** Whether the `samples` submodule is there, from `GET /imagery/samples`. */
export interface ImagerySamples {
  /** False when the server runs with `imagery_samples = false`. */
  enabled: boolean
  /** False when the submodule has not been fetched. */
  present: boolean
  count: number
}

/** What an upload says about the file in its body. */
export interface ImageryUpload {
  source_format: ImagerySourceFormat
  name: string
  attribution: string
  license: string
  /** ISO 8601 UTC, or empty when unknown. */
  acquired_at: string
  /** Image corners `[lon, lat]` x 4: top-left, top-right, bottom-right, bottom-left. */
  corners_deg: number[] | null
  sensor: ImagerySensor | null
}

/** The database the server runs on, from `GET /settings/database`. */
export interface DatabaseStatus {
  backend: string
  /** Running URL; any password is masked. */
  url: string
  /** Absolute path of the database file. */
  path: string
  size_bytes: number
  counts: {
    objects: number
    history: number
    stations: number
    sensor_presets: number
    custom_elements: number
    fetches: number
  }
  /** Where the running URL came from. */
  source: 'env' | 'toml' | 'default'
  /** TOML file a save writes to. */
  settings_file: string
  default_url: string
  /** URL the next start will open. */
  next_url: string
  /** A saved URL differs from the running one until the server restarts. */
  restart_required: boolean
  /** False while `SODA_DATABASE_URL` pins the URL. */
  editable: boolean
}

/** Result of `POST /settings/database/test`; nothing is created by the check. */
export interface DatabaseProbe {
  url: string
  backend: string
  path: string | null
  exists: boolean
  /** Already holds a SODA schema. */
  initialized: boolean
  writable: boolean
  ok: boolean
  /** Why it is not usable, in English; empty when `ok`. */
  detail: string
}

/** A table the settings screen can browse. */
export interface DatabaseTable {
  name: string
  columns: string[]
  count: number
}

/** One page of raw rows; `omm` and `az_mask` columns arrive parsed. */
export interface DatabasePage {
  table: string
  columns: string[]
  rows: Record<string, unknown>[]
  /** Rows matching the search, across all pages. */
  total: number
  offset: number
  limit: number
}

export type UserDataKind = 'stations' | 'sensor_presets' | 'custom_elements' | 'custom_states'

export interface UserDataImportResult {
  added: Record<UserDataKind, number>
  skipped: { kind: UserDataKind; name: string; reason: 'nameTaken' | 'invalid' }[]
}

/** How the body is held during a ground contact; `sun` leaves the array on the Sun. */
export type ContactAttitude = 'sun' | 'nadir' | 'station'

export type PowerRequest = PropagateRequest & {
  shots: { start: string; end: string; roll_deg: number; pitch_deg: number }[]
  contacts: { start: string; end: string; station_id: number; downlink: boolean }[]
  /** When the battery holds `initial_soc_pct`; left out, the start of the run. */
  soc_at?: string
  power: {
    array_w: number
    capacity_wh: number
    initial_soc_pct: number
    charge_efficiency: number
    discharge_efficiency: number
    dod_limit_pct: number
    base_w: number
    imaging_w: number
    downlink_w: number
    contact_w: number
    contact_attitude: ContactAttitude
    slew_s: number
    /** Equivalent circuit of the battery; left out, the energy balance is the model. */
    battery?: {
      cells_series: number
      capacity_ah: number
      resistance_ohm: number
      max_charge_a: number
      cell_max_v: number
      cell_min_v: number
      ocv: { soc_pct: number; cell_v: number }[]
    }
  }
}

export interface PowerResponse {
  start: string
  span_s: number
  /** When the starting state of charge applies; the result runs from here. */
  soc_at: string
  /** Which battery model ran: the energy balance, or the equivalent circuit. */
  model: 'energy' | 'circuit'
  /** Energy of the full battery. */
  capacity_wh: number
  /** Seconds from `start`; `soc` (0 to 1) is linear in between. */
  time_s: number[]
  soc: number[]
  /** Terminal voltage and battery current (positive discharging) at `time_s`; circuit only. */
  voltage_v: number[] | null
  current_a: number[] | null
  generated_wh: number
  consumed_wh: number
  /** Array output with nowhere to go once the battery was full. */
  shunted_wh: number
  /** Load that was not served because the battery was empty. */
  unmet_wh: number
  /** Heat in the internal resistance, and the extremes below; circuit only. */
  loss_wh: number | null
  min_voltage_v: number | null
  max_voltage_v: number | null
  max_discharge_a: number | null
  max_charge_a: number | null
  min_soc: number
  max_dod: number
  final_soc: number
  /** Flat `[start0, end0, ...]` seconds from `start`. */
  below_limit_s: number[]
  empty_s: number[]
  eclipse_s: number[]
  eclipse_fraction: number
  /** Time the array spent off the Sun in sunlight. */
  off_sun_s: number
  beta_start_deg: number | null
  beta_end_deg: number | null
  warnings: ApiMessage[]
}
