import type { DeviceSummary, StarDetectorProvider } from 'api'
import type { ReactNode } from 'react'
import { Notice } from '../equipment-control/parts'
import { cameraTabKey } from '../images/cameratabs'
import { imagesState, selectImageTool } from '../images/images'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { useAstapConfigured } from './StarRequestControls'
import { PROVIDER_LABELS } from './stars'

// Star Detection section of the panels of the camera operations that detect stars in their frames, as Plate Solving is
// for those that solve them: it says how the operation measures each frame with the profile's star detection settings,
// which are edited only in Images → Star Detection, so this section has no controls of its own and opens that tool on
// the same camera tab, which commands nothing.

interface CameraStarDetectionSectionProps {
	// Id of the section, which keeps its open state.
	readonly id: string
	// Camera of the panel; the link is hidden without one.
	readonly device?: DeviceSummary
	// Detector described: the profile's, or the one a running session applied.
	readonly provider: StarDetectorProvider
	// How the operation detects stars in its frames and uses them, given the highlighted detector name.
	readonly description: (detector: ReactNode) => ReactNode
}

// Section with the operation's use of the star detector and a link to the settings.
export function CameraStarDetectionSection({ id, device, provider, description }: CameraStarDetectionSectionProps) {
	const astapConfigured = useAstapConfigured()
	const label = PROVIDER_LABELS[provider]

	return (
		<CollapsibleSection id={id} title="Star Detection" summary={label}>
			<Notice>{description(<span className="text-accent">{label}</span>)}</Notice>
			{provider === 'astap' && !astapConfigured && <Notice error>{label} is not configured.</Notice>}
			{device && (
				<Button variant="secondary" className="self-start" onClick={() => selectImageTool(imagesState, cameraTabKey(device.connectionId, device.id), 'star-detection')}>
					Open Star Detection
				</Button>
			)}
		</CollapsibleSection>
	)
}
