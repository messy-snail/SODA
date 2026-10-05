/** Published ground stations offered as a starting point when adding one. */

export const NETWORK_IDS = [
  'dsn',
  'nsn',
  'estrack',
  'inta',
  'ksat',
  'ssc',
  'jaxa',
  'isro',
  'cnsa',
  'cnes',
  'conae',
  'sansa',
  'kari',
  'kopri',
  'sonz',
] as const
export type NetworkId = (typeof NETWORK_IDS)[number]

/**
 * A name that has to sit next to the data it belongs to rather than in the message
 * catalogue: it is a property of the station, added or corrected with the station itself.
 */
export interface Label {
  ko: string
  en: string
}

export interface StationPreset {
  /** Stored on the station row as ``preset_id``; lowercase and hyphenated. */
  id: string
  name: Label
  network: NetworkId
  /** ISO 3166-1 alpha-2, rendered through Intl.DisplayNames instead of translated. */
  country: string
  lat_deg: number
  lon_deg: number
  alt_m: number
  /**
   * Networks rarely publish a per-antenna elevation mask, so this is the convention for
   * the network rather than a quoted figure. It is meant to be edited.
   */
  min_elev_deg: number
  /** Where the coordinate came from, recorded in SOURCES.md as well. */
  source: string
  retrieved: string
  note?: Label
}

export interface Network {
  /** Short form shown on chips; a proper noun, so it is not translated. */
  short: string
  name: Label
}

export const NETWORKS: Record<NetworkId, Network> = {
  dsn: { short: 'DSN', name: { ko: 'NASA 심우주 통신망', en: 'NASA Deep Space Network' } },
  nsn: { short: 'NSN', name: { ko: 'NASA 근우주 통신망', en: 'NASA Near Space Network' } },
  estrack: {
    short: 'ESTRACK',
    name: { ko: '유럽우주국 추적망', en: 'ESA Tracking Station Network' },
  },
  inta: { short: 'INTA', name: { ko: '스페인 항공우주기술연구소', en: 'INTA (Spain)' } },
  ksat: {
    short: 'KSAT',
    name: { ko: '콩스베르그 위성 서비스', en: 'Kongsberg Satellite Services' },
  },
  ssc: { short: 'SSC', name: { ko: '스웨덴 우주공사', en: 'Swedish Space Corporation' } },
  jaxa: { short: 'JAXA', name: { ko: '일본 우주항공연구개발기구', en: 'JAXA' } },
  isro: { short: 'ISRO', name: { ko: '인도 우주연구기구', en: 'ISRO' } },
  cnsa: {
    short: 'CNSA',
    name: { ko: '중국 국가항천국', en: 'China National Space Administration' },
  },
  cnes: { short: 'CNES', name: { ko: '프랑스 국립우주연구원', en: 'CNES' } },
  conae: { short: 'CONAE', name: { ko: '아르헨티나 우주위원회', en: 'CONAE (Argentina)' } },
  sansa: {
    short: 'SANSA',
    name: { ko: '남아프리카 우주청', en: 'South African National Space Agency' },
  },
  kari: {
    short: 'KARI',
    name: { ko: '한국항공우주연구원', en: 'Korea Aerospace Research Institute' },
  },
  kopri: {
    short: 'KOPRI',
    name: { ko: '극지연구소', en: 'Korea Polar Research Institute' },
  },
  sonz: {
    short: 'SONZ',
    name: { ko: '뉴질랜드 우주운영', en: 'Space Operations New Zealand' },
  },
}
