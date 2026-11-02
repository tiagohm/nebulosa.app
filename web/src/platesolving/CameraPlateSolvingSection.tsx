import type { DeviceSummary } from 'api'
import type { ReactNode } from 'react'
import { Notice } from '../equipment-control/parts'
import { cameraTabKey } from '../images/cameratabs'
import { imagesState, selectImageTool } from '../images/images'
import type { CameraPlateSolvingSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { useSolverConfigured } from './PlateSolveControls'
import { PROVIDER_LABELS } from './platesolving'

// Plate Solving section of the panels of the camera operations that solve frames, as Star Detection is for those that
// detect stars: it says how the operation solves each frame with the camera's plate solving settings, which are edited
// only in Images → Plate Solver, so this section has no controls of its own and opens that tool on the same camera tab,
// which commands nothing.

interface CameraPlateSolvingSectionProps {
	// Id of the section, which keeps its open state.
	readonly id: string
	// Camera of the panel; the link is hidden without one.
	readonly device?: DeviceSummary
	// Settings described: the camera's, or the ones a running session applied.
	readonly solving: Readonly<CameraPlateSolvingSettings>
	// How the operation solves its frames and uses the solutions, given the highlighted solver name and whether the
	// search is assisted.
	readonly description: (solver: ReactNode, assisted: boolean) => ReactNode
}

// Section with the operation's use of the solver and a link to the settings.
export function CameraPlateSolvingSection({ id, device, solving, description }: CameraPlateSolvingSectionProps) {
	const configured = useSolverConfigured(solving.provider)
	const label = PROVIDER_LABELS[solving.provider]

	return (
		<CollapsibleSection id={id} title="Plate Solving" summary={label}>
			<Notice>{description(<span className="text-accent">{label}</span>, solving.strategy === 'assisted')}</Notice>
			{!configured && <Notice error>{label} is not configured.</Notice>}
			{device && (
				<Button variant="secondary" className="self-start" onClick={() => selectImageTool(imagesState, cameraTabKey(device.connectionId, device.id), 'plate-solver')}>
					Open Plate Solving
				</Button>
			)}
		</CollapsibleSection>
	)
}
