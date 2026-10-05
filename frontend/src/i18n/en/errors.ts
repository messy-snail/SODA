export default {
  requestFailed: 'The request failed (HTTP {status})',
  networkUnreachable: 'Cannot reach the SODA server',

  apiNotFound: 'No such API endpoint',
  frontendNotBuilt: 'Build the frontend first (frontend: pnpm build)',
  invalidRequest: 'Check the values in the request',

  elementsNotFound: 'No element set found for NORAD {norad_id}',
  unsupportedGroup: 'Unsupported group: {group}',
  ephemerisUnavailable: 'The DE421 ephemeris (de421.bsp) could not be loaded',

  stationNotFound: 'Ground station not found',
  stationNameTaken: 'A ground station with that name already exists',
  sensorPresetNotFound: 'Sensor preset not found',
  sensorPresetNameTaken: 'A sensor preset with that name already exists',
  customElementsInvalid: 'Could not read the elements; paste two or three TLE lines or OMM JSON',
  customElementNotFound: 'Saved elements not found',
  customElementNameTaken: 'Saved elements with that name already exist',
  elementFileTooLarge: 'An element file must be {max_mb} MB or smaller',
  elementFileUnreadable: 'No elements could be read from the file; use a TLE or OMM file',
  elementFileWrongKind: '{kind} files do not hold orbital elements; use a TLE or OMM file',
  elementFileTooManyRecords: 'Over the {max} record limit. Split the file',
  stateVectorInvalid:
    'The state vector is not usable. Check the frame, position and velocity (above 100 km, on a bound orbit)',
  stateNotFound: 'State vector not found',
  stateNameTaken: 'A state vector with that name already exists',
  sourceNeedsElements:
    'A state vector or an ephemeris cannot be used here; pick a satellite with elements (TLE or OMM)',
  oemInvalid:
    'The OEM file could not be read. It must be a CCSDS OEM (KVN or XML) about the Earth, on a bound orbit',
  oemFrameUnsupported: 'OEM frame {frame} is not supported; use EME2000, GCRF, ICRF, ITRF or TEME',
  oemTimeSystemUnsupported: 'OEM time system {time_system} is not supported; only UTC is',
  oemTooLarge: 'An OEM file must be {max_mb} MB or smaller',
  oemTooManySamples: 'Over the {max} sample limit for an OEM file',
  ephemerisNotFound: 'Ephemeris not found',
  ephemerisNameTaken: 'An ephemeris with that name already exists',
  ephemerisNoOverlap: 'The window does not overlap the span of the ephemeris ({start} to {end})',
  satelliteRefInvalid: 'Name exactly one of norad_id, custom_id, state_id and ephemeris_id',

  endBeforeStart: 'The end time must be later than the start time',
  spanTooLong: 'The propagation window is at most {days} days',
  stepTooSmall: 'The step must be at least {min_s} seconds',
  tooManySamples: 'Over the {max} sample limit. Use a longer step',
  sensorWidthAmbiguous: 'Give either a swath width or a FOV, not both',
  propagatorNotAllowed: 'This orbit source cannot be propagated with {propagator}',
  hpopSpanTooLong: 'An HPOP window is at most {days} days',
  hpopEpochTooFar: 'An HPOP window must lie within {days} days of the epoch',

  passWindowTooLong: 'The pass prediction window is at most {days} days',
  noStationSelected: 'Select at least one ground station',
  tooManyStations: 'At most {max} ground stations can be computed at once',

  accessWindowTooLong: 'The imaging opportunity window is at most {days} days',
  noTargetSelected: 'Add at least one imaging target',
  tooManyTargets: 'At most {max} imaging targets at once',
  coverageGridTooLarge: 'A coverage grid has at most {max} cells',
  coverageTooHeavy:
    'Too much to compute · shrink the area or the span, or use at most {max_cells} cells',

  powerIntervalsTooMany: 'At most {max} acquisitions and contacts, got {count}',
  powerStartOutsideRun: 'The starting SOC time is outside the propagated run',
  batteryCurveInvalid: 'The open-circuit voltage curve or the cell voltage limits cannot be used',

  passBudgetExceeded: 'Satellites × days exceeds {max}. Use fewer satellites or a shorter span',
  noSatelliteSelected: 'Add at least one satellite',
  tooManySatellites: 'At most {max} satellites at once',

  tmtcBadCommand: 'Malformed command',

  maskTooFewPoints: 'An azimuth mask needs at least {min} points',
  maskTooManyPoints: 'An azimuth mask takes at most {max} points',
  maskBadPoint: 'Each mask point must be an (azimuth, minimum elevation) pair',
  maskAzimuthRange: 'Mask azimuths must be at least 0° and under 360°',
  maskElevationRange: 'Mask elevations must be between 0° and {max}°',
  maskDuplicateAzimuth: 'Two mask points share the same azimuth',

  logoNotFound: 'Logo not found',
  logoBadName: 'A logo name must be default, an operator name, or a NORAD number',
  logoBusy: 'The logo file is in use. Try again in a moment',
  logoBuiltinLocked: 'A bundled logo cannot be deleted',
  logoTooLarge: 'A logo file must be {max_mb} MB or smaller',
  logoNotPng: 'Not a PNG image',
  logoHeaderUnreadable: 'The PNG header could not be read; the file may be damaged',
  logoTooWide: 'A logo must be at most {max_px} px wide and tall',

  modelNotFound: 'Model not found',
  modelBadName: 'A model name must be default or a NORAD number',
  modelBusy: 'The model file is in use. Try again in a moment',
  modelTooLarge: 'A model file must be {max_mb} MB or smaller',
  glbNotGlb: 'Not a .glb (binary glTF) file',
  glbVersion: 'Only glTF 2.0 models are supported',
  glbLengthMismatch: 'The GLB header length does not match the file size; it may be damaged',
  glbJsonChunk: 'The JSON chunk of the GLB could not be read',
  glbExternalUri:
    'A model that references external files cannot be used. Export a .glb with its textures and buffers embedded',
  databaseUrlInvalid: 'Unsupported database URL. Use the form sqlite:///<path>',
  databaseProbeFailed: 'SODA cannot use a database at that path ({detail})',
  databaseUrlFromEnv: 'SODA_DATABASE_URL is set in the environment, so it cannot be changed here',
  databaseTableUnknown: 'This table cannot be browsed: {table}',

  imageryNotFound: 'Imagery not found',
  imageryBusy: 'The imagery file is in use. Try again in a moment',
  imageryTooLarge: 'An imagery file must be {max_mb} MB or smaller',
  imageryTooMany: 'At most {max} imagery sets can be registered',
  imageryQueueFull: 'Too many imports are in progress; at most {max} can wait at once',
  imageryCatalogAreaTooLarge:
    'The search area must be at most {max_deg}° across; zoom in and search again',
  imageryCatalogUnavailable: 'The imagery catalogue could not be reached. Try again in a moment',
  imageryCatalogItemUnknown: 'The catalogue has no such item',
  imageryDownloadFailed: 'The imagery file could not be downloaded. Try again in a moment',
  imageryDownloadNotAllowed: 'Imagery at an address that is not allowed cannot be imported',
  imagerySidecarInvalid:
    'Check the .json description in the inbox; corners_deg must be eight longitude and latitude values',
  imageryMbtilesInvalid: 'The MBTiles file could not be read; check its tiles table',
  imageryMbtilesNotRaster: 'Only MBTiles with raster tiles (PNG, JPEG, WebP) can be used',
  imageryImageUnreadable: 'The PNG or JPEG image could not be read',
  imageryCornersInvalid:
    'Check the four corners: eight longitude and latitude values in the order top-left, top-right, bottom-right, bottom-left',
  imageryTooManyPixels: 'Imagery must be {max_mp} megapixels or smaller to be converted',
  imageryGeotiffUnreadable: 'The GeoTIFF could not be read; check its bands and data type',
  imageryNotGeoreferenced:
    'This TIFF has no georeferencing. A GeoTIFF with a coordinate system and transform is needed',
  imageryProductInvalid:
    'The imagery product could not be read; check {detail}. It must be a zip or folder holding one scene: METADATA.DIM and its image file',
  imagerySampleLocked: 'Sample imagery cannot be edited or deleted',
  imageryWarpUnavailable:
    'The conversion library (rasterio) could not be loaded. MBTiles uploads still work',
  imageryImportFailed: 'The imagery could not be converted; check the server log',
}
