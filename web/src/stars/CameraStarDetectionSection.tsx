import type { DeviceSummary } from 'api'
import type { ReactNode } from 'react'
import { openCameraTool } from '../images/opencameratool'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Notice'

// Star Detection section of the panels of the camera operations that detect stars in their frames, as Plate Solving is
// for those that solve them: it says how the operation measures each frame with the profile's star detection settings,
// which are edited only in Images → Star Detection, so this section has no controls of its own and opens that tool on
// the same camera tab, which commands nothing.

interface CameraStarDetectionSectionProps {
	// Id of the section, which keeps its open state.
	readonly id: string
	// Camera of the panel; the link is hidden without one.
	readonly device?: DeviceSummary
	// How the operation detects stars in its frames and uses them, given the highlighted detector name.
	readonly description: (detector: ReactNode) => ReactNode
	// Whether the section starts expanded before the operator opens or closes it; true by default.
	readonly defaultOpen?: boolean
}

// Section with the operation's use of the star detector and a link to the settings.
export function CameraStarDetectionSection({ id, device, description, defaultOpen }: CameraStarDetectionSectionProps) {
	return (
		<CollapsibleSection id={id} title="Star Detection" summary="Nebulosa" defaultOpen={defaultOpen}>
			<Notice>{description(<span className="text-ink-100">Nebulosa</span>)}</Notice>
			{device && (
				<Button variant="secondary" className="self-start" onClick={() => openCameraTool(device.connectionId, device.id, 'star-detection')}>
					Open Star Detection
				</Button>
			)}
		</CollapsibleSection>
	)
}
