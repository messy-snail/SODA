export default {
  needRun: 'Propagate an orbit to see that satellite’s battery state of charge',
  toPropagate: 'Go to propagation',
  sources: '{shots} acquisitions · {contacts} contacts',
  notice: {
    noPlan: 'No pass plan',
    noPlanHint:
      'This satellite is not in the pass prediction, so no contacts are counted. Click to open Passes.',
    noShots: 'No imaging result',
    noShotsHint:
      'No imaging opportunities were computed for this satellite, so none are counted. Click to open Imaging plan.',
    stale: 'Earlier propagation',
    staleHint:
      'The imaging or pass results are from an earlier propagation of this satellite; compute them again.',
  },
  about: 'Model assumptions',
  settings: 'Power settings',
  settingsShort: 'Settings',
  socAt: 'Starting SOC applies at (UTC)',
  useRunStart: 'Run start',
  useTimeline: 'Timeline time',
  groups: { battery: 'Array and battery', loads: 'Loads and slew' },
  fields: {
    arrayW: 'Array (W)',
    capacityWh: 'Capacity (Wh)',
    initialSocPct: 'Start SOC (%)',
    dodLimitPct: 'DOD limit (%)',
    chargeEffPct: 'Charge eff. (%)',
    dischargeEffPct: 'Discharge eff. (%)',
    baseW: 'Base (W)',
    imagingW: 'Imaging + (W)',
    downlinkW: 'Downlink + (W)',
    contactW: 'Contact + (W)',
    slewS: 'Slew margin (s)',
  },
  attitude: {
    label: 'Attitude during a contact',
    sun: 'Sun-pointing',
    nadir: 'Nadir',
    station: 'Track station',
    explain: {
      sun: 'Steered or omnidirectional antenna · generation is unchanged',
      nadir: 'The body looks at the Earth · the array faces the zenith',
      station: 'The body follows the station · the array faces away from it',
    },
  },
  battery: {
    kind: {
      label: 'Battery model',
      energy: 'Simple',
      circuit: 'Equivalent circuit',
      explain: {
        energy: 'Counts energy with a charge and a discharge efficiency',
        circuit:
          'Solves voltage and current from an open-circuit voltage curve and an internal resistance; charging tapers as the battery fills',
      },
    },
    fields: {
      cellsSeries: 'Series cells',
      capacityAh: 'Capacity (Ah)',
      resistanceMohm: 'Resistance (mΩ)',
      maxChargeA: 'Max charge (A)',
      cellMaxV: 'Cell max (V)',
      cellMinV: 'Cell cut-off (V)',
    },
  },
  curve: {
    edit: 'Open-circuit curve',
    title: 'Cell open-circuit voltage curve',
    points: 'SOC %, cell voltage V',
    format: 'One point per line: SOC %, cell voltage V · from 0% to 100%',
    example:
      'The default curve shows the usual shape of a lithium-ion cell; it is an illustration, not a datasheet',
    reset: 'Use the example curve',
    problems: {
      format: 'Two numbers per line (SOC %, voltage V)',
      count: 'Between 2 and 32 points',
      range: 'SOC from 0 to 100%, voltage above 0 and up to 10 V',
      ends: 'The first point is 0% and the last is 100%',
      order: 'SOC must ascend',
      falling: 'The voltage must not fall as the SOC rises',
    },
  },
  series: { label: 'What the chart draws', soc: 'SOC', voltage: 'Voltage', current: 'Current' },
  range: {
    voltage: 'Lowest {min} V · highest {max} V',
    current: 'Discharge up to {discharge} A · charge up to {charge} A · resistive loss {loss} Wh',
  },
  invalid: 'A value is out of range, so nothing is computed',
  stats: {
    minSoc: 'Lowest SOC',
    maxDod: 'Deepest DOD',
    finalSoc: 'Final SOC (vs start)',
    nowSoc: 'SOC at the clock',
    generated: 'Generated',
    consumed: 'Consumed',
    eclipse: 'In eclipse',
    beta: 'Beta angle',
  },
  empty: 'The battery ran flat and {wh} Wh of load went unserved',
  chart: 'Battery energy over time. The red dashed line is the DOD limit, dark bands are eclipses',
  notes: {
    array: 'The array is fixed to the face opposite the camera and normally faces the Sun',
    imaging: 'While imaging, generation follows the roll and pitch of that acquisition',
    eclipse: 'Only the umbra counts as eclipse',
    battery: 'Temperature, voltage and ageing are not modelled',
    circuit:
      'The equivalent circuit is one open-circuit voltage curve and one resistance · the default curve is an example',
    chart:
      'Click the chart to jump there · red dashed line is the DOD limit · dark bands are eclipses',
  },
}
