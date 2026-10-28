import { useSnapshot } from 'valtio'
import { navigate, routeState } from '../../shell/route'
import { formatEclipseTime, utcDate } from '../../tools/eclipse/eclipse'
import { ECLIPSE_TYPE_NAMES } from '../../tools/solareclipse/solareclipse'
import { Button } from '../../ui/Button'
import { CollapsibleSection } from '../CollapsibleSection'
import { Datum, Note } from '../InspectorParts'
import { sunState } from './sun'

// Next Solar Eclipse section of the Sun Inspector: the first solar eclipse after the instant the Sky shows, its type,
// greatest eclipse, and magnitude, whether it is visible from the observer (from the eclipse API's local
// circumstances, never guessed from the type), and a link that opens exactly that eclipse in the Solar Eclipse Map.

// Next Solar Eclipse section of the Sun Inspector.
export function SunEclipseSection({ hasObserver, timeZone }: { readonly hasObserver: boolean; readonly timeZone?: string }) {
	const { value, loading, error } = useSnapshot(sunState).eclipse
	const eclipse = value?.eclipse
	const summary = eclipse ? `${ECLIPSE_TYPE_NAMES[eclipse.type]} · ${utcDate(eclipse.maximum)}` : loading ? 'Searching…' : undefined

	return (
		<CollapsibleSection id="eclipse" title="Next Solar Eclipse" summary={summary}>
			{eclipse ? (
				<>
					<Datum label="Type">{ECLIPSE_TYPE_NAMES[eclipse.type]}</Datum>
					<Datum label="Greatest eclipse">{formatEclipseTime(eclipse.maximum, timeZone ?? '')}</Datum>
					<Datum label="Magnitude">{eclipse.magnitude.toFixed(3)}</Datum>
					{value.local ? <Datum label="From here">{value.local.visibility.text}</Datum> : !hasObserver && <Note>Set the observer&apos;s location to see whether it is visible from there.</Note>}
					<div>
						<Button variant="secondary" onClick={() => navigate(routeState, { workspace: 'tools', tool: 'solar-eclipse-map', eclipse: eclipse.id })}>
							View Eclipse Map
						</Button>
					</div>
					<Note>The first solar eclipse after the Sky instant, anywhere on the Earth; the greatest eclipse is where and when the shadow axis passes nearest the Earth&apos;s center.</Note>
				</>
			) : (
				!error && <p className="m-0 text-ink-300">{loading ? 'Searching the next eclipse…' : 'No eclipse.'}</p>
			)}
			{error && <Note danger>Eclipse unavailable: {error}</Note>}
		</CollapsibleSection>
	)
}
