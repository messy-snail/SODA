export default {
  name: 'Name',
  latitude: 'Latitude (°)',
  longitude: 'Longitude (°)',
  altitude: 'Altitude (m)',
  minElevation: 'Min elevation (°)',
  maskSection: 'Azimuth mask (optional)',
  maskHint:
    'Give the blocked directions as azimuth and minimum elevation pairs. Values in between are interpolated and the curve wraps at 360°. Leave it empty to use the minimum above in every direction.',
  azimuth: 'Azimuth (°)',
  removeMaskPoint: 'Remove mask point',
  addMaskPoint: 'Add mask point',
  create: 'Save station',
  update: 'Update station',
  search: 'Search stations (name · network · country)',
  catalogHint:
    'Coordinates come from published pages, recorded in {path}. The minimum elevation is a convention for the network rather than a figure the operator published, so edit it per station after adding it.',
  presetSummary: '{lat}°, {lon}° · min elevation {elevation}°',
}
