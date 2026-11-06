import type { MoonApsisEvent } from 'api'
import { formatKilometers, formatLongDateTime } from '../../format'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { formatApparentSize } from '../format'

// Perigee & Apogee section of the Moon Inspector: the next perigee and apogee after the instant the Sky shows, in time
// order, with the Moon's geocentric distance and apparent diameter there; never the observer's distance.

// Names of the apsides.
const APSIS_NAMES = { perigee: 'Perigee', apogee: 'Apogee' } as const

// Perigee & Apogee section of the Moon Inspector.
export function MoonApsidesSection({ apsides, timeZone }: { readonly apsides?: readonly MoonApsisEvent[]; readonly timeZone: string }) {
	return (
		<CollapsibleSection id="sky.lunarApsides" title="Perigee & Apogee" summary={apsides?.[0] && `Next: ${APSIS_NAMES[apsides[0].kind]}`} defaultOpen={false}>
			{apsides ? (
				<>
					{apsides.map((e) => (
						<div key={e.kind} className="flex flex-col gap-1">
							<span className="text-ink-100">{APSIS_NAMES[e.kind]}</span>
							<span className="font-mono text-sm text-ink-200">{formatLongDateTime(e.time, timeZone)}</span>
							<DataRow label="Distance">{formatKilometers(e.distanceKm)}</DataRow>
							<DataRow label="Apparent diameter">{formatApparentSize(e.angularDiameter)}</DataRow>
						</div>
					))}
					<Notice>Geocentric distance of the Moon&apos;s center, from the local model (Meeus).</Notice>
				</>
			) : (
				<p className="m-0 text-ink-300">Computing the apsides…</p>
			)}
		</CollapsibleSection>
	)
}
