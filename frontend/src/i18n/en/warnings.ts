export default {
  elementsFarFromEpoch:
    'Up to {days} days from the element set epoch; the orbit may be off by several km',
  sgp4Failures: 'SGP4 could not compute {count} samples (possible re-entry or decay)',
  hpopFailures: 'HPOP could not compute {count} samples (possible re-entry)',
  hpopAssumedSpacecraft:
    'Drag and radiation pressure use an assumed spacecraft: its mass and area are not known',
  ephemerisOutsideSpan: '{count} samples fall outside the span of the ephemeris file',
  historyNeedsSpaceTrack:
    'The start time is more than three days before the latest element set epoch. Configure a Space-Track account to use elements from that time.',
  historyNotFound:
    'Space-Track had no element set for that time, so the latest one is used instead.',
  eclipseUnavailable:
    'The solar ephemeris (de421.bsp) is unavailable, so eclipse intervals were not computed.',
  powerCoarseStep:
    'The propagation step is above {max_s} s, so generation during imaging and contacts is rough.',
}
