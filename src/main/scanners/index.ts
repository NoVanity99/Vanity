import { customScanner } from './custom'
import { eaScanner } from './ea'
import { epicScanner } from './epic'
import { gogScanner } from './gog'
import { steamScanner } from './steam'
import type { Scanner } from './types'
import { ubisoftScanner } from './ubisoft'

/** All known sources. Custom runs last so it can skip folders the launchers already claimed. */
export const scanners: Scanner[] = [steamScanner, epicScanner, gogScanner, eaScanner, ubisoftScanner, customScanner]
