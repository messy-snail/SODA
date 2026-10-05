import type { Label } from '../i18n/label'

/**
 * Names for the CelesTrak groups the server may fetch (`gp/celestrak.py` ALLOWED_GROUPS).
 * A group the server adds later still shows, under its own name.
 */
export const GROUP_LABELS: Record<string, Label> = {
  active: { ko: '전체 활성', en: 'All active' },
  stations: { ko: '우주정거장', en: 'Space stations' },
  visual: { ko: '밝은 위성', en: 'Brightest' },
  weather: { ko: '기상', en: 'Weather' },
  noaa: { ko: 'NOAA', en: 'NOAA' },
  goes: { ko: 'GOES', en: 'GOES' },
  resource: { ko: '지구관측', en: 'Earth resources' },
  sarsat: { ko: '수색·구조', en: 'Search & rescue' },
  planet: { ko: 'Planet', en: 'Planet' },
  spire: { ko: 'Spire', en: 'Spire' },
  science: { ko: '과학', en: 'Science' },
  geodetic: { ko: '측지', en: 'Geodetic' },
  engineering: { ko: '기술 시험', en: 'Engineering' },
  education: { ko: '교육', en: 'Education' },
  gnss: { ko: 'GNSS 전체', en: 'All GNSS' },
  'gps-ops': { ko: 'GPS', en: 'GPS' },
  galileo: { ko: 'Galileo', en: 'Galileo' },
  beidou: { ko: 'BeiDou', en: 'BeiDou' },
  geo: { ko: '정지궤도', en: 'Geostationary' },
  starlink: { ko: 'Starlink', en: 'Starlink' },
  oneweb: { ko: 'OneWeb', en: 'OneWeb' },
  'iridium-NEXT': { ko: 'Iridium NEXT', en: 'Iridium NEXT' },
  cubesat: { ko: '큐브샛', en: 'CubeSats' },
  'last-30-days': { ko: '최근 30일 발사', en: 'Launched in 30 days' },
}

export function groupLabel(name: string): Label {
  return GROUP_LABELS[name] ?? { ko: name, en: name }
}
