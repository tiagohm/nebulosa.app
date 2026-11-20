import type { MeridianFlipExecutorPolicy } from 'api'
import { useSnapshot } from 'valtio'
import { defaultStepSize, FITTING_MODE_LABELS } from '../../camera/autofocus'
import { CameraAcquisitionSection } from '../../camera/CameraAcquisitionSection'
import { controlRuntime, deviceStateOf, watchedDeviceState } from '../../equipment-control/control'
import type { RoleDevice } from '../../equipment/useEquipment'
import { formatExposureTime, formatFixed } from '../../format'
import { cameraTabKey } from '../../images/cameratabs'
import { imagesState } from '../../images/images'
import { openCameraTool } from '../../images/opencameratool'
import { CameraPlateSolvingSection } from '../../platesolving/CameraPlateSolvingSection'
import { activeProfile, autoFocusSettings, cameraPlateSolving, exposureSettings, profileCamera, profileState, starDetectionSettings, targetCenteringSettings } from '../../profile/profile'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { PROVIDER_LABELS as DETECTOR_LABELS } from '../../stars/stars'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'

// Sections of the contextual panel of the Meridian Flip tool that summarize the camera tools a flip invokes on the
// MAIN_CAMERA of the Equipment Setup, as the panels of the camera operations do: the acquisition of its frames, the plate
// solving they go through, and the Target Centering and Auto Focus settings, each shown only and opened in its own tool
// on the camera tab of the Images workspace, which commands nothing. The values are the camera's in the profile, the
// ones a flip copies into its request when it is asked for or armed.

interface FlipToolSectionsProps {
	// Main camera of the Equipment Setup; nothing is shown without one.
	readonly camera: RoleDevice
	// Focuser of the Equipment Setup; Auto Focus is shown only with one.
	readonly focuser: RoleDevice
	// Policy of the mount, which says whether recentering and Auto Focus run after the flip.
	readonly policy: Readonly<MeridianFlipExecutorPolicy>
}

// Summaries of the camera tools a flip invokes.
export function FlipToolSections({ camera, focuser, policy }: FlipToolSectionsProps) {
	const profile = activeProfile(useSnapshot(profileState))
	const control = useSnapshot(controlRuntime)
	const images = useSnapshot(imagesState)
	const device = camera.device

	if (!device) return null

	// The tools open on the camera tab, which exists only while the camera is connected.
	const tab = images.documents.some((document) => document.key === cameraTabKey(device.connectionId, device.id))

	const identity = profileCamera(profile, device.id)
	const capabilities = watchedDeviceState(control, 'camera', device)
	const exposure = exposureSettings(profile.settings, identity)
	const solving = cameraPlateSolving(profile.settings, identity)
	const centering = targetCenteringSettings(profile.settings, identity)
	const focus = autoFocusSettings(profile.settings, identity)
	const detector = starDetectionSettings(profile.settings).detector.provider
	const focuserState = focuser.device && deviceStateOf(control.states, 'focuser', focuser.device.id)
	const stepSize = focus.stepSize ?? (focuserState ? defaultStepSize(focuserState.position.min, focuserState.position.max) : undefined)

	return (
		<>
			<CameraAcquisitionSection
				id="meridianFlip.acquisition"
				device={tab ? device : undefined}
				exposure={exposure}
				capabilities={capabilities}
				defaultOpen={false}
				description="Frames are temporary LIGHT frames taken with the camera settings of Camera Acquisition, shown as the latest frame of the camera and never saved. The paused capture keeps its own settings."
			>
				<DataList>
					<DataRow label="Target Centering">{formatExposureTime(centering.exposureTime)}</DataRow>
					{focuser.device && <DataRow label="Auto Focus">{formatExposureTime(focus.exposureTime)}</DataRow>}
				</DataList>
			</CameraAcquisitionSection>
			<CameraPlateSolvingSection
				id="meridianFlip.plateSolving"
				device={tab ? device : undefined}
				solving={solving}
				defaultOpen={false}
				description={(solver, assisted) => (
					<>
						Target Centering solves each frame with the Plate Solving settings ({solver} solver, {assisted ? 'searched around the position in its header' : 'searched over the whole sky'}): after the flip to recenter the target, and, when the mount reports no usable pier side, before and after it to infer
						the flip from the turn of the field.
					</>
				)}
			/>
			<CollapsibleSection id="meridianFlip.targetCentering" title="Target Centering" summary={policy.recenterAfterFlip ? 'Recenter' : 'Off'} defaultOpen={false}>
				<DataList>
					<DataRow label="After the flip">{policy.recenterAfterFlip ? 'Recenter' : 'Off'}</DataRow>
					<DataRow label="Tolerance">{`${formatFixed(centering.tolerance, 0)}″`}</DataRow>
					<DataRow label="Corrections">{centering.maximumCorrections}</DataRow>
					<DataRow label="Settle Time">{formatExposureTime(centering.settleDelay)}</DataRow>
					<DataRow label="Largest Correction">{`${formatFixed(centering.maximumCorrection, 1)}°`}</DataRow>
					<DataRow label="Frames">{centering.maximumFrames}</DataRow>
					<DataRow label="Retries Without a Solution">{centering.noSolutionRetries}</DataRow>
					<DataRow label="Whole-sky retry">{centering.blindRetry ? 'Yes' : 'No'}</DataRow>
				</DataList>
				<Notice>The settings of Target Centering for the main camera, used to recenter and to infer the flip. The flip suspends and restores guiding itself, so the guiding option of Target Centering does not apply.</Notice>
				{tab && (
					<Button variant="secondary" className="self-start" onClick={() => openCameraTool(device.connectionId, device.id, 'target-centering')}>
						Open Target Centering
					</Button>
				)}
			</CollapsibleSection>
			{focuser.device && (
				<CollapsibleSection id="meridianFlip.autoFocus" title="Auto Focus" summary={policy.autofocusAfterFlip ? FITTING_MODE_LABELS[focus.fittingMode] : 'Off'} defaultOpen={false}>
					<DataList>
						<DataRow label="After the flip">{policy.autofocusAfterFlip ? 'Run' : 'Off'}</DataRow>
						<DataRow label="Curve Fitting">{FITTING_MODE_LABELS[focus.fittingMode]}</DataRow>
						<DataRow label="Step Size">{stepSize === undefined ? 'Follows the focuser' : `${stepSize} ${stepSize === 1 ? 'step' : 'steps'}`}</DataRow>
						<DataRow label="Positions per Side">{focus.initialOffsetSteps}</DataRow>
						<DataRow label="Settle Time">{formatExposureTime(focus.settleDelay)}</DataRow>
						<DataRow label="Max RMSD / HFD">{focus.rmsdThreshold === 0 ? 'Any fit' : formatFixed(focus.rmsdThreshold, 2)}</DataRow>
						<DataRow label="Star Detection">{DETECTOR_LABELS[detector]}</DataRow>
					</DataList>
					<Notice>The settings of Auto Focus for the main camera and the Star Detection settings of the profile, measured through the current filter.</Notice>
					{tab && (
						<Button variant="secondary" className="self-start" onClick={() => openCameraTool(device.connectionId, device.id, 'auto-focus')}>
							Open Auto Focus
						</Button>
					)}
				</CollapsibleSection>
			)}
		</>
	)
}
