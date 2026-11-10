import type { MoonPhaseEvent } from 'api'
import { formatLongDateTime } from '../../format'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Notice } from '../../ui/Notice'
import { MOON_PHASE_NAMES } from './moon'

// Lunar Phases section of the Moon Inspector: the next four principal phases after the instant the Sky shows, in
// time order, with their date and time in the chosen time zone. They are geocentric events, the same for everyone.

// Lunar Phases section of the Moon Inspector.
export function MoonPhasesSection({ phases, timeZone }: { readonly phases?: readonly MoonPhaseEvent[]; readonly timeZone: string }) {
	return (
		<CollapsibleSection id="sky.lunarPhases" title="Lunar Phases" summary={phases?.[0] && `Next: ${MOON_PHASE_NAMES[phases[0].kind]}`} defaultOpen={false}>
			{phases ? (
				<>
					<ul className="m-0 flex list-none flex-col gap-2 p-0">
						{phases.map((e) => (
							<li key={e.kind} className="flex flex-col">
								<span className="text-ink-100">{MOON_PHASE_NAMES[e.kind]}</span>
								<span className="font-mono text-sm text-ink-200">{formatLongDateTime(e.time, timeZone)}</span>
							</li>
						))}
					</ul>
					<Notice>Geocentric instants after the Sky instant, from the local model (Meeus).</Notice>
				</>
			) : (
				<Notice>Computing the phases…</Notice>
			)}
		</CollapsibleSection>
	)
}
