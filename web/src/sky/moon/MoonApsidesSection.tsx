import type { MoonApsisEvent } from 'api'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { formatEclipseTime } from '../../tools/eclipse/eclipse'
import { formatAngularSize } from '../format'
import { Datum, Note } from '../InspectorParts'

// Perigee & Apogee section of the Moon Inspector: the next perigee and apogee after the instant the Sky shows, in time
// order, with the Moon's geocentric distance and apparent diameter there; never the observer's distance.

// Names of the apsides.
const APSIS_NAMES = { perigee: 'Perigee', apogee: 'Apogee' } as const

// Formats a distance in kilometers with thousands separators, like formatSolarSystemDistance: "356,980 km".
export function formatKilometers(km: number) {
	return `${Math.round(km).toLocaleString('en-US')} km`
}

// Perigee & Apogee section of the Moon Inspector.
export function MoonApsidesSection({ apsides, timeZone }: { readonly apsides?: readonly MoonApsisEvent[]; readonly timeZone?: string }) {
	return (
		<CollapsibleSection id="sky.lunarApsides" title="Perigee & Apogee" summary={apsides?.[0] && `Next: ${APSIS_NAMES[apsides[0].kind]}`} defaultOpen={false}>
			{apsides ? (
				<>
					{apsides.map((e) => (
						<div key={e.kind} className="flex flex-col gap-1">
							<span className="text-ink-100">{APSIS_NAMES[e.kind]}</span>
							<span className="font-mono text-[13px] text-ink-200">{formatEclipseTime(e.time, timeZone ?? '')}</span>
							<Datum label="Distance">{formatKilometers(e.distanceKm)}</Datum>
							<Datum label="Apparent diameter">{formatAngularSize(e.angularDiameter)}</Datum>
						</div>
					))}
					<Note>Geocentric distance of the Moon&apos;s center, from the local model (Meeus).</Note>
				</>
			) : (
				<p className="m-0 text-ink-300">Computing the apsides…</p>
			)}
		</CollapsibleSection>
	)
}
