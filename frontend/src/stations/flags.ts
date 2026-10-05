/**
 * Flags for the countries the station catalogue uses.
 *
 * Each flag is imported by name from flag-icons (MIT, see THIRD_PARTY_NOTICES.md) so only
 * these reach the bundle; its stylesheet would pull in every flag. A preset in a new
 * country needs a line here, and presets.test.ts fails until it has one.
 */
import aq from 'flag-icons/flags/4x3/aq.svg'
import ar from 'flag-icons/flags/4x3/ar.svg'
import au from 'flag-icons/flags/4x3/au.svg'
import be from 'flag-icons/flags/4x3/be.svg'
import ca from 'flag-icons/flags/4x3/ca.svg'
import cn from 'flag-icons/flags/4x3/cn.svg'
import es from 'flag-icons/flags/4x3/es.svg'
import fr from 'flag-icons/flags/4x3/fr.svg'
import gf from 'flag-icons/flags/4x3/gf.svg'
import india from 'flag-icons/flags/4x3/in.svg'
import jp from 'flag-icons/flags/4x3/jp.svg'
import kr from 'flag-icons/flags/4x3/kr.svg'
import no from 'flag-icons/flags/4x3/no.svg'
import nz from 'flag-icons/flags/4x3/nz.svg'
import pt from 'flag-icons/flags/4x3/pt.svg'
import se from 'flag-icons/flags/4x3/se.svg'
import us from 'flag-icons/flags/4x3/us.svg'
import za from 'flag-icons/flags/4x3/za.svg'

const FLAGS: Record<string, string> = {
  AQ: aq,
  AR: ar,
  AU: au,
  BE: be,
  CA: ca,
  CN: cn,
  ES: es,
  FR: fr,
  GF: gf,
  IN: india,
  JP: jp,
  KR: kr,
  NO: no,
  NZ: nz,
  PT: pt,
  SE: se,
  US: us,
  ZA: za,
}

/** URL of a 4:3 flag image, or null when the country has none bundled. */
export function flagUrl(code: string): string | null {
  return FLAGS[code] ?? null
}
