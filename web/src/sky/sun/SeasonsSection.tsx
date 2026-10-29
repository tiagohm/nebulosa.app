import type { SolarSeasonEvent, SolarSeasonKind } from 'api'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { formatEclipseTime } from '../../tools/eclipse/eclipse'
import { Note } from '../InspectorParts'

// Seasons section of the Sun Inspector: the next four equinoxes and solstices after the instant the Sky shows, named by
// their month so the name holds everywhere, and with the observer the season each one begins in its hemisphere.

// Names of the equinoxes and solstices.
const SEASON_NAMES: Readonly<Record<SolarSeasonKind, string>> = { marchEquinox: 'March equinox', juneSolstice: 'June solstice', septemberEquinox: 'September equinox', decemberSolstice: 'December solstice' }

// Season each event begins in the northern hemisphere; the southern one begins the opposite season.
const NORTHERN_SEASONS: Readonly<Record<SolarSeasonKind, readonly [string, string]>> = {
	marchEquinox: ['spring', 'autumn'],
	juneSolstice: ['summer', 'winter'],
	septemberEquinox: ['autumn', 'spring'],
	decemberSolstice: ['winter', 'summer'],
}

// Seasons section of the Sun Inspector; latitude is the observer's in degrees, absent without one.
export function SeasonsSection({ seasons, latitude, timeZone }: { readonly seasons?: readonly SolarSeasonEvent[]; readonly latitude?: number; readonly timeZone?: string }) {
	const summary = seasons?.[0] && `Next: ${SEASON_NAMES[seasons[0].kind]}`

	return (
		<CollapsibleSection id="sky.seasons" title="Seasons" summary={summary} defaultOpen={false}>
			{seasons ? (
				<>
					<ul className="m-0 flex list-none flex-col gap-2 p-0">
						{seasons.map((e) => (
							<li key={e.kind} className="flex flex-col">
								<span className="flex items-baseline justify-between gap-3">
									<span className="text-ink-100">{SEASON_NAMES[e.kind]}</span>
									{latitude !== undefined && <span className="text-right text-xs text-ink-300">{NORTHERN_SEASONS[e.kind][latitude < 0 ? 1 : 0]} begins here</span>}
								</span>
								<span className="font-mono text-[13px] text-ink-200">{formatEclipseTime(e.time, timeZone ?? '')}</span>
							</li>
						))}
					</ul>
					<Note>Astronomical seasons after the Sky instant, from the local model.</Note>
				</>
			) : (
				<p className="m-0 text-ink-300">Computing the seasons…</p>
			)}
		</CollapsibleSection>
	)
}
