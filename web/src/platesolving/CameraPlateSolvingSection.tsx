import type { DeviceSummary } from 'api'
import { Notice } from '../equipment-control/parts'
import { cameraTabKey } from '../images/cameratabs'
import { imagesState, selectImageTool } from '../images/images'
import type { CameraPlateSolvingSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { useSolverConfigured } from './PlateSolveControls'
import { PROVIDER_LABELS } from './platesolving'

// Read-only summary of the plate solving settings a camera operation applies, for the panels of the operations that
// solve frames. The settings belong to the camera and are edited only in Images → Plate Solver, so this section has no
// controls of its own: it shows them and opens that tool on the same camera tab, which commands nothing.

interface CameraPlateSolvingSectionProps {
	// Id of the section, which keeps its open state.
	readonly id: string
	// Camera of the panel; the link is hidden without one.
	readonly device?: DeviceSummary
	// Settings shown: the camera's, or the ones a running session applied.
	readonly solving: Readonly<CameraPlateSolvingSettings>
}

// Section with the solver, the strategy, the downsampling, and a link to the settings.
export function CameraPlateSolvingSection({ id, device, solving }: CameraPlateSolvingSectionProps) {
	const configured = useSolverConfigured(solving.provider)

	return (
		<CollapsibleSection id={id} title="Plate Solving" summary={PROVIDER_LABELS[solving.provider]} defaultOpen={false}>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<dt className="text-ink-300">Solver</dt>
				<dd className="m-0 min-w-0 truncate text-right">{PROVIDER_LABELS[solving.provider]}</dd>
				<dt className="text-ink-300">Strategy</dt>
				<dd className="m-0 min-w-0 truncate text-right">{solving.strategy === 'blind' ? 'Blind' : 'Assisted'}</dd>
				<dt className="text-ink-300">Downsample</dt>
				<dd className="m-0 min-w-0 truncate text-right tabular-nums">{solving.downsample ?? 'Automatic'}</dd>
			</dl>
			{!configured && <Notice error>{PROVIDER_LABELS[solving.provider]} is not configured.</Notice>}
			{device && (
				<Button variant="secondary" className="self-start" onClick={() => selectImageTool(imagesState, cameraTabKey(device.connectionId, device.id), 'plate-solver')}>
					Open Plate Solving
				</Button>
			)}
		</CollapsibleSection>
	)
}
