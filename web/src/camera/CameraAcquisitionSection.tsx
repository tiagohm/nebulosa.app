import type { CameraCapabilities, DeviceSummary } from 'api'
import type { ReactNode } from 'react'
import { Notice } from '../equipment-control/parts'
import { cameraTabKey } from '../images/cameratabs'
import { imagesState, selectImageTool } from '../images/images'
import type { CameraExposureSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { CameraSummary } from './CameraSummary'

// Acquisition section of the panels of the camera operations that take frames, as Plate Solving and Star Detection are
// for those that solve or measure them: the operation's own exposure controls, the camera settings it applies, which are
// edited only in Camera Acquisition, what its frames are, and a link that opens that tool on the same camera tab, which
// commands nothing.

interface CameraAcquisitionSectionProps {
	// Id of the section, which keeps its open state.
	readonly id: string
	// Camera of the panel; the link is hidden without one.
	readonly device?: DeviceSummary
	// Camera settings shown: the camera's, or the ones a running session applied.
	readonly exposure: Omit<CameraExposureSettings, 'exposureTime'>
	// What the camera reports.
	readonly capabilities?: CameraCapabilities
	// What the operation's frames are, how they are taken, and where they go.
	readonly description: ReactNode
	// Exposure controls of the operation, shown above the camera settings; absent when it has none.
	readonly children?: ReactNode
}

// Section with the operation's exposure controls, the camera settings it applies, and a link to them.
export function CameraAcquisitionSection({ id, device, exposure, capabilities, description, children }: CameraAcquisitionSectionProps) {
	return (
		<CollapsibleSection id={id} title="Acquisition">
			{children}
			<CameraSummary exposure={exposure} capabilities={capabilities} />
			<Notice>{description}</Notice>
			{device && (
				<Button variant="secondary" className="self-start" onClick={() => selectImageTool(imagesState, cameraTabKey(device.connectionId, device.id), 'camera-acquisition')}>
					Open Acquisition
				</Button>
			)}
		</CollapsibleSection>
	)
}
