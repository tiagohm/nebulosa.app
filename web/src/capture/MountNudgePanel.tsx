import { cn } from 'cn'
import { PanelSection, PlannedControls } from '../shell/ContextualPanel'
import { Icon } from '../ui/Icon'

// Contextual panel of the Mount Nudge mode: a capture loop of the main camera while the mount is moved
// in small steps, framing the target against the viewer's reticle. The direction pad is disabled until
// mount motion is implemented with an explicit start and stop; no pointer or key event moves the mount.

// Arrows of the direction pad: their cell in a 3 × 3 grid and the rotation of the north-pointing glyph.
const DIRECTIONS = [
	{ label: 'North', cell: 'col-start-2 row-start-1', rotate: 'rotate-0' },
	{ label: 'West', cell: 'col-start-1 row-start-2', rotate: '-rotate-90' },
	{ label: 'East', cell: 'col-start-3 row-start-2', rotate: 'rotate-90' },
	{ label: 'South', cell: 'col-start-2 row-start-3', rotate: 'rotate-180' },
] as const

// Mount Nudge controls.
export function MountNudgePanel() {
	return (
		<>
			<PanelSection title="Loop">
				<PlannedControls items={['Exposure time', 'Start and stop loop']} />
			</PanelSection>
			<PanelSection title="Move">
				<div className="grid w-fit grid-cols-3 grid-rows-3 gap-1 self-center">
					{DIRECTIONS.map(({ label, cell, rotate }) => (
						<button key={label} type="button" disabled title={`${label} (not available yet)`} className={cn(cell, 'flex size-10 cursor-not-allowed items-center justify-center rounded-sm border border-line-100 bg-base-200 p-0 text-ink-300')}>
							<Icon name="arrow" className={cn('size-4', rotate)} strokeWidth={2} />
							<span className="sr-only">{label}</span>
						</button>
					))}
				</div>
				<PlannedControls items={['Slew rate', 'Pulse duration']} />
			</PanelSection>
		</>
	)
}
