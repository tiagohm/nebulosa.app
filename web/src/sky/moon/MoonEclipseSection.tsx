import { useSnapshot } from 'valtio'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { navigate, routeState } from '../../shell/route'
import { formatEclipseTime, utcDate } from '../../tools/eclipse/eclipse'
import { ECLIPSE_TYPE_NAMES } from '../../tools/lunareclipse/lunareclipse'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { moonState } from './moon'

// Next Lunar Eclipse section of the Moon Inspector: the first lunar eclipse after the instant the Sky shows, its type,
// greatest eclipse, and magnitude, whether it is visible from the observer (from the eclipse API's local
// circumstances, never guessed from the type), and a link that opens exactly that eclipse in the Lunar Eclipse Map.

// Next Lunar Eclipse section of the Moon Inspector.
export function MoonEclipseSection({ hasObserver, timeZone }: { readonly hasObserver: boolean; readonly timeZone: string }) {
	const { value, loading, error } = useSnapshot(moonState).eclipse
	const eclipse = value?.eclipse
	const summary = eclipse ? `${ECLIPSE_TYPE_NAMES[eclipse.type]} · ${utcDate(eclipse.maximum)}` : loading ? 'Searching…' : undefined

	return (
		<CollapsibleSection id="sky.eclipse" title="Next Lunar Eclipse" summary={summary} defaultOpen={false}>
			{eclipse ? (
				<>
					<DataRow label="Type">{ECLIPSE_TYPE_NAMES[eclipse.type]}</DataRow>
					<DataRow label="Greatest eclipse">{formatEclipseTime(eclipse.maximum, timeZone)}</DataRow>
					<DataRow label="Magnitude">{eclipse.magnitude.toFixed(3)}</DataRow>
					{value.local ? <DataRow label="From here">{value.local.visibility.text}</DataRow> : !hasObserver && <Notice>Select an observing site to see whether it is visible from there.</Notice>}
					<div>
						<Button variant="secondary" onClick={() => navigate(routeState, { workspace: 'tools', tool: 'lunar-eclipse-map', eclipse: eclipse.id })}>
							View Lunar Eclipse Map
						</Button>
					</div>
					<Notice>The first lunar eclipse after the Sky instant, seen wherever the Moon is above the horizon; the magnitude is the umbral one for a total or partial eclipse and the penumbral one otherwise.</Notice>
				</>
			) : (
				!error && <p className="m-0 text-ink-300">{loading ? 'Searching the next eclipse…' : 'No eclipse.'}</p>
			)}
			{error && <Notice error>Eclipse unavailable: {error}</Notice>}
		</CollapsibleSection>
	)
}
