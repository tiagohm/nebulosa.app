import type { MoonPhaseEvent } from 'api'
import { formatEclipseTime } from '../../tools/eclipse/eclipse'
import { CollapsibleSection } from '../CollapsibleSection'
import { Note } from '../InspectorParts'
import { MOON_PHASE_NAMES } from './moon'

// Lunar Phases section of the Moon Inspector: the next four principal phases after the instant the Sky shows, in
// time order, with their date and time in the chosen time zone. They are geocentric events, the same for everyone.

// Lunar Phases section of the Moon Inspector.
export function MoonPhasesSection({ phases, timeZone }: { readonly phases?: readonly MoonPhaseEvent[]; readonly timeZone?: string }) {
	return (
		<CollapsibleSection id="lunarPhases" title="Lunar Phases" summary={phases?.[0] && `Next: ${MOON_PHASE_NAMES[phases[0].kind]}`}>
			{phases ? (
				<>
					<ul className="m-0 flex list-none flex-col gap-2 p-0">
						{phases.map((e) => (
							<li key={e.kind} className="flex flex-col">
								<span className="text-ink-100">{MOON_PHASE_NAMES[e.kind]}</span>
								<span className="font-mono text-[13px] text-ink-200">{formatEclipseTime(e.time, timeZone ?? '')}</span>
							</li>
						))}
					</ul>
					<Note>Geocentric instants after the Sky instant, from the local model (Meeus).</Note>
				</>
			) : (
				<p className="m-0 text-ink-300">Computing the phases…</p>
			)}
		</CollapsibleSection>
	)
}
