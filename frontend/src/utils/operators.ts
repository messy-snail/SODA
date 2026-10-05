/**
 * Satellite name to operator slug, so one uploaded logo covers a whole constellation.
 *
 * Slugs are the logo file names the backend stores (`starlink.png`). Rules are ordered and the
 * first match wins, which is what separates names that share a prefix — `GSAT0101 (GALILEO-PFM)`
 * is Galileo while `GSAT-10` is ISRO. Operators with few or irregularly named satellites are
 * pinned by NORAD number instead, because words like `OBSERVER` would catch unrelated objects.
 */

import type { Label } from '../i18n/label'
import type { Locale } from '../i18n/locale'

export interface OperatorRule {
  /** Logo file name, lowercase. */
  slug: string
  /** Label shown in the logo tool. It lives with the rule, not in the message
   *  catalogue, so adding an operator stays a single edit and the pure helpers below
   *  need nothing from vue-i18n. */
  title: Label
  /** Korean operators are listed first and expanded by default. */
  domestic?: boolean
  /** Matched against the upper-cased satellite name. */
  prefix?: readonly string[]
  contains?: readonly string[]
  /** Checked before the name rules, and exempt from the debris guard. */
  norad?: readonly number[]
}

/** Mirrors `DEBRIS_MARKERS` in `src/soda/gp/classify.py`. */
const DEBRIS_MARKERS = ['DEBRIS', 'ROCKET BODY', ' DEB', 'R/B', 'OBJECT '] as const

export const OPERATOR_RULES: readonly OperatorRule[] = [
  // Korean operators. Satellite counts are small, but these are the ones worth recognizing.
  { slug: 'telepix', title: { ko: 'TELEPIX', en: 'TELEPIX' }, domestic: true, prefix: ['BLUEBON'] },
  {
    slug: 'si',
    title: { ko: 'SI (쎄트렉아이)', en: 'SI (Satrec Initiative)' },
    domestic: true,
    prefix: ['SPACEEYE-T'],
  },
  {
    slug: 'kari',
    title: { ko: '한국항공우주연구원', en: 'KARI' },
    domestic: true,
    prefix: ['KOMPSAT', 'ARIRANG', 'GEO-KOMPSAT', 'CAS500', 'KSLV'],
  },
  { slug: 'ktsat', title: { ko: 'KT SAT', en: 'KT SAT' }, domestic: true, prefix: ['KOREASAT'] },
  {
    slug: 'kasi',
    title: { ko: '한국천문연구원', en: 'KASI' },
    domestic: true,
    prefix: ['SNIPE', 'STSAT-3'],
  },
  {
    slug: 'kaist',
    title: { ko: 'KAIST 인공위성연구소 (SaTReC)', en: 'KAIST SaTReC' },
    domestic: true,
    prefix: ['NEXTSAT'],
  },
  {
    slug: 'snu',
    title: { ko: '서울대학교', en: 'Seoul National University' },
    domestic: true,
    prefix: ['SNUSAT', 'SNUGLITE'],
  },
  { slug: 'contec', title: { ko: '컨텍', en: 'Contec' }, domestic: true, prefix: ['CONTECSAT'] },
  {
    slug: 'naraspace',
    title: { ko: '나라스페이스', en: 'Nara Space' },
    domestic: true,
    norad: [58323],
  },
  {
    slug: 'kairospace',
    title: { ko: '카이로스페이스', en: 'Kairo Space' },
    domestic: true,
    norad: [52900],
  },
  {
    slug: 'chosun',
    title: { ko: '조선대학교', en: 'Chosun University' },
    domestic: true,
    norad: [52897],
  },

  // GNSS first: their names overlap prefixes used by other operators.
  {
    slug: 'galileo',
    title: { ko: 'Galileo (EUSPA)', en: 'Galileo (EUSPA)' },
    contains: ['GALILEO'],
  },
  {
    slug: 'glonass',
    title: { ko: 'GLONASS (Roscosmos)', en: 'GLONASS (Roscosmos)' },
    contains: ['GLONASS'],
  },
  {
    slug: 'gps',
    title: { ko: 'GPS (US Space Force)', en: 'GPS (US Space Force)' },
    prefix: ['NAVSTAR'],
  },
  { slug: 'beidou', title: { ko: 'BeiDou (CNSA)', en: 'BeiDou (CNSA)' }, prefix: ['BEIDOU'] },

  {
    slug: 'starlink',
    title: { ko: 'Starlink (SpaceX)', en: 'Starlink (SpaceX)' },
    prefix: ['STARLINK'],
  },
  {
    slug: 'oneweb',
    title: { ko: 'OneWeb (Eutelsat)', en: 'OneWeb (Eutelsat)' },
    prefix: ['ONEWEB'],
  },
  {
    slug: 'kuiper',
    title: { ko: 'Project Kuiper (Amazon)', en: 'Project Kuiper (Amazon)' },
    prefix: ['KUIPER'],
  },
  { slug: 'qianfan', title: { ko: 'Qianfan (SSST)', en: 'Qianfan (SSST)' }, prefix: ['QIANFAN'] },
  {
    slug: 'guowang',
    title: { ko: 'Guowang (China SatNet)', en: 'Guowang (China SatNet)' },
    prefix: ['HULIANWANG', 'GUOWANG'],
  },
  { slug: 'yaogan', title: { ko: 'Yaogan (CNSA)', en: 'Yaogan (CNSA)' }, prefix: ['YAOGAN'] },
  {
    slug: 'planet',
    title: { ko: 'Planet Labs', en: 'Planet Labs' },
    prefix: ['FLOCK', 'SKYSAT', 'PELICAN', 'TANAGER'],
  },
  { slug: 'spire', title: { ko: 'Spire Global', en: 'Spire Global' }, prefix: ['LEMUR'] },
  { slug: 'iridium', title: { ko: 'Iridium', en: 'Iridium' }, prefix: ['IRIDIUM'] },
  {
    slug: 'geespace',
    title: { ko: 'Geespace (Geely)', en: 'Geespace (Geely)' },
    prefix: ['GEESAT'],
  },
  { slug: 'iceye', title: { ko: 'ICEYE', en: 'ICEYE' }, prefix: ['ICEYE'] },
  // CelesTrak spells some O3b records with a zero: `03B MPOWER F12`.
  { slug: 'ses', title: { ko: 'SES', en: 'SES' }, prefix: ['O3B', '03B', 'SES'] },
  {
    slug: 'sitro',
    title: { ko: 'SITRO-AIS (Sitronics)', en: 'SITRO-AIS (Sitronics)' },
    prefix: ['SITRO'],
  },
  {
    slug: 'cgstl',
    title: { ko: 'Chang Guang (Jilin-1)', en: 'Chang Guang (Jilin-1)' },
    prefix: ['JILIN'],
  },
  { slug: 'globalstar', title: { ko: 'Globalstar', en: 'Globalstar' }, prefix: ['GLOBALSTAR'] },
  { slug: 'eutelsat', title: { ko: 'Eutelsat', en: 'Eutelsat' }, prefix: ['EUTELSAT'] },
  { slug: 'intelsat', title: { ko: 'Intelsat', en: 'Intelsat' }, prefix: ['INTELSAT'] },
  { slug: 'gonets', title: { ko: 'Gonets', en: 'Gonets' }, prefix: ['GONETS'] },
  { slug: 'orbcomm', title: { ko: 'ORBCOMM', en: 'ORBCOMM' }, prefix: ['ORBCOMM'] },
  // After `glonass`, so `COSMOS 2432 [GLONASS-M]` is not swallowed here.
  {
    slug: 'cosmos',
    title: { ko: 'Cosmos (Roscosmos)', en: 'Cosmos (Roscosmos)' },
    prefix: ['COSMOS'],
  },
  // After `galileo`, so `GSAT0101 (GALILEO-PFM)` is not read as an ISRO GSAT.
  {
    slug: 'isro',
    title: { ko: 'ISRO', en: 'ISRO' },
    prefix: ['GSAT-', 'INSAT', 'CARTOSAT', 'RISAT', 'OCEANSAT', 'RESOURCESAT'],
  },
]

/** Whether the name marks a rocket body or fragment rather than a payload. */
export function isDebrisName(name: string): boolean {
  const upper = name.toUpperCase()
  return DEBRIS_MARKERS.some((marker) => upper.includes(marker))
}

/**
 * The operator slug for a satellite, or `null` when no rule matches.
 *
 * Debris keeps no operator logo: `CAS500-2 RIDESHARE OBJECT K` is launch debris, not a KARI
 * satellite, even though it carries the `CAS500` prefix. A NORAD number listed on a rule is an
 * explicit choice and wins over that guard.
 */
export function operatorKey(name: string, noradId: number): string | null {
  const pinned = OPERATOR_RULES.find((rule) => rule.norad?.includes(noradId))
  if (pinned) return pinned.slug
  if (isDebrisName(name)) return null
  const upper = name.toUpperCase()
  const matched = OPERATOR_RULES.find(
    (rule) =>
      rule.prefix?.some((pattern) => upper.startsWith(pattern)) ||
      rule.contains?.some((pattern) => upper.includes(pattern)),
  )
  return matched?.slug ?? null
}

/** Display label for a slug, falling back to the slug itself for unknown files. */
export function operatorTitle(slug: string, locale: Locale): string {
  return OPERATOR_RULES.find((rule) => rule.slug === slug)?.title[locale] ?? slug
}
