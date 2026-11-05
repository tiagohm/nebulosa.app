import { useSnapshot } from 'valtio'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { navigate, routeState } from '../../shell/route'
import { formatEclipseTime, utcDate } from '../../tools/eclipse/eclipse'
import { ECLIPSE_TYPE_NAMES } from '../../tools/solareclipse/solareclipse'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
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
		<CollapsibleSection id="sky.eclipse" title="Next Solar Eclipse" summary={summary} defaultOpen={false}>
			{eclipse ? (
				<>
					<DataRow label="Type">{ECLIPSE_TYPE_NAMES[eclipse.type]}</DataRow>
					<DataRow label="Greatest eclipse">{formatEclipseTime(eclipse.maximum, timeZone ?? '')}</DataRow>
					<DataRow label="Magnitude">{eclipse.magnitude.toFixed(3)}</DataRow>
					{value.local ? <DataRow label="From here">{value.local.visibility.text}</DataRow> : !hasObserver && <Notice>Set the observer&apos;s location to see whether it is visible from there.</Notice>}
					<div>
						<Button variant="secondary" onClick={() => navigate(routeState, { workspace: 'tools', tool: 'solar-eclipse-map', eclipse: eclipse.id })}>
							View Eclipse Map
						</Button>
					</div>
					<Notice>The first solar eclipse after the Sky instant, anywhere on the Earth; the greatest eclipse is where and when the shadow axis passes nearest the Earth&apos;s center.</Notice>
				</>
			) : (
				!error && <p className="m-0 text-ink-300">{loading ? 'Searching the next eclipse…' : 'No eclipse.'}</p>
			)}
			{error && <Notice error>Eclipse unavailable: {error}</Notice>}
		</CollapsibleSection>
	)
}
