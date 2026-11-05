import type { CaptureDither, CaptureSession } from 'api'
import { useSnapshot } from 'valtio'
import { DeviceLink } from '../equipment-control/DeviceLink'
import type { RoleDevice } from '../equipment/useEquipment'
import { activeProfile, ditherSettings, guidingSettings, mountDitherSettings, profileState, setDitherSettings, setMountDitherSettings } from '../profile/profile'
import { type CameraAcquisitionSettings, type CameraDitherSettings, type CameraIdentity, DITHER_MAXIMUM_AMOUNT, DITHER_MAXIMUM_EVERY_FRAMES, DITHER_MAXIMUM_SETTLE, DITHER_MINIMUM_AMOUNT, GUIDING_MAXIMUM_PULSE, GUIDING_MINIMUM_PULSE, type MountDitherSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { cameraKey, captureDither, type CaptureDitherOutcome } from './capture'
import { guidingRuntime } from './guiding'

// Dithering section of Camera Acquisition: whether the fixed and loop LIGHT captures of the camera dither, how often, and
// by which method, Guided (the guiding session of the setup's Guide Camera, with the amount, RA only, and settle of its
// Guiding form, shown here read-only) or Mount (the setup's Mount moved by guide pulses through the setup's Guide Output
// or a small GoTo, then a mechanical settle). The guide pulse directions, which no calibration measures and which start at
// the nominal East and North of the mount's commands, and the pulse limit are settings of the mount, under Advanced. A running capture shows the dither of its request, never the form.
// The dither the next capture sends, or why it cannot start, comes from useCaptureDither; the server checks it again.

// Dithering methods, in display order.
const METHODS: readonly CameraDitherSettings['method'][] = ['guided', 'mount']

// Label of each dithering method.
const METHOD_LABELS: Readonly<Record<CameraDitherSettings['method'], string>> = { guided: 'Guided', mount: 'Mount' }

// Mount dither movements, in display order.
const MOVEMENTS: readonly CameraDitherSettings['movement'][] = ['pulse', 'slew']

// Label of each Mount dither movement.
const MOVEMENT_LABELS: Readonly<Record<CameraDitherSettings['movement'], string>> = { pulse: 'Guide Pulses', slew: 'Small GoTo' }

// Mount dither patterns, in display order.
const PATTERNS: readonly CameraDitherSettings['pattern'][] = ['random', 'spiral', 'golden', 'grid']

// Label of each Mount dither pattern.
const PATTERN_LABELS: Readonly<Record<CameraDitherSettings['pattern'], string>> = { random: 'Random', spiral: 'Spiral', golden: 'Golden Spiral', grid: 'Grid' }

// Choices of the guide direction moving the mount toward a positive right ascension, the nominal one first.
const RA_DIRECTIONS = ['EAST', 'WEST'] as const

// Choices of the guide direction moving the mount toward a positive declination, the nominal one first.
const DEC_DIRECTIONS = ['NORTH', 'SOUTH'] as const

// Label of a guide direction.
function directionLabel(direction: string) {
	return direction.charAt(0) + direction.slice(1).toLowerCase()
}

// Devices of the setup the dithers of the Main Camera use.
export interface DitherDevices {
	// Mount of the setup.
	readonly mount: RoleDevice
	// Guide Camera of the setup, whose guiding session Guided dithers go through.
	readonly guideCamera: RoleDevice
	// Guide Output of the setup, which pulse dithers go through.
	readonly guideOutput: RoleDevice
}

// Identity of a device of the setup for its forms in the profile: the saved connection of the camera's forms and its
// device id.
function formIdentity(camera: CameraIdentity | undefined, role: RoleDevice): CameraIdentity | undefined {
	return camera && role.device ? { connectionId: camera.connectionId, deviceId: role.device.id } : undefined
}

// Returns the dither the next capture of a camera sends, or why it cannot start, from its dithering preferences and the
// devices of the setup; none for a camera without dither devices, which never dithers.
export function useCaptureDither(camera: CameraIdentity | undefined, acquisition: Readonly<CameraAcquisitionSettings>, devices: DitherDevices | undefined): CaptureDitherOutcome {
	const profiles = useSnapshot(profileState)
	const guiding = useSnapshot(guidingRuntime)
	if (!devices) return {}

	const settings = activeProfile(profiles).settings
	const { mount, guideCamera, guideOutput } = devices
	const guideDevice = guideCamera.device

	return captureDither({
		acquisition,
		settings: ditherSettings(settings, camera),
		guidingSession: guideDevice && guiding.sessions[cameraKey(guideDevice.connectionId, guideDevice.id)],
		guiding: guidingSettings(settings, formIdentity(camera, guideCamera)),
		mount: mount.device && { connectionId: mount.device.connectionId, deviceId: mount.device.id },
		guideOutput: guideOutput.device && { connectionId: guideOutput.device.connectionId, deviceId: guideOutput.device.id },
		mountSettings: mountDitherSettings(settings, formIdentity(camera, mount)),
	})
}

interface DitheringSectionProps {
	// Camera whose forms are edited.
	readonly camera?: CameraIdentity
	// Acquisition form of the camera.
	readonly acquisition: Readonly<CameraAcquisitionSettings>
	// Devices of the setup the dithers use; absent for a camera that is not the Main Camera, which never dithers.
	readonly devices?: DitherDevices
	// Latest capture of the camera, whose dither is shown while it runs.
	readonly session?: CaptureSession
	// Whether a capture runs, so the form cannot change it.
	readonly running: boolean
	// Whether the form is locked by a running capture or a command waiting for the server.
	readonly locked: boolean
	// Dither the next capture sends, or why it cannot start.
	readonly outcome: CaptureDitherOutcome
}

// Dithering section of the Camera Acquisition panel.
export function DitheringSection({ camera, acquisition, devices, session, running, locked, outcome }: DitheringSectionProps) {
	const profiles = useSnapshot(profileState)
	const settings = activeProfile(profiles).settings
	const dither = ditherSettings(settings, camera)
	const applicable = acquisition.exposureMode !== 'single' && acquisition.frameType === 'LIGHT'
	const summary = running ? (session?.request.dither ? 'On' : 'Off') : dither.enabled && applicable ? 'On' : 'Off'

	if (!devices) {
		return (
			<CollapsibleSection id="images.camera-acquisition.dithering" title="Dithering" summary="Off" defaultOpen={false}>
				<Notice>Only the Main Camera of the Equipment Setup dithers.</Notice>
			</CollapsibleSection>
		)
	}

	return (
		<CollapsibleSection id="images.camera-acquisition.dithering" title="Dithering" summary={summary} defaultOpen={false}>
			{running && session ? <RunningDither dither={session.request.dither} /> : <DitherForm camera={camera} settings={dither} devices={devices} applicable={applicable} locked={locked} />}
			{!running && dither.enabled && applicable && outcome.blocker && <Notice error>{outcome.blocker}</Notice>}
		</CollapsibleSection>
	)
}

interface DitherFormProps {
	readonly camera?: CameraIdentity
	readonly settings: Readonly<CameraDitherSettings>
	readonly devices: DitherDevices
	// Whether the acquisition mode and frame type can dither.
	readonly applicable: boolean
	readonly locked: boolean
}

// Dithering preferences of the next capture.
function DitherForm({ camera, settings, devices, applicable, locked }: DitherFormProps) {
	const profiles = useSnapshot(profileState)
	const profile = activeProfile(profiles).settings
	const mountIdentity = formIdentity(camera, devices.mount)
	const pulse = mountDitherSettings(profile, mountIdentity)
	const guiding = guidingSettings(profile, formIdentity(camera, devices.guideCamera))
	const disabled = locked || !applicable

	// Updates fields of the dithering preferences of the camera.
	function update(patch: Partial<CameraDitherSettings>) {
		setDitherSettings(profileState, camera, patch)
	}

	// Updates fields of the guide pulse settings of the mount.
	function updatePulse(patch: Partial<MountDitherSettings>) {
		setMountDitherSettings(profileState, mountIdentity, patch)
	}

	return (
		<>
			<Checkbox label="Dither between frames" checked={settings.enabled} disabled={disabled} onChange={(enabled) => update({ enabled })} />
			{!applicable && <Notice>Only Fixed and Loop LIGHT captures dither.</Notice>}
			<NumberInput label="Every" suffix="frames" value={settings.everyFrames} min={1} max={DITHER_MAXIMUM_EVERY_FRAMES} disabled={disabled} onChange={(everyFrames) => update({ everyFrames: Math.round(everyFrames) })} />
			<SegmentedControl label="Method" options={METHODS} value={settings.method} format={(method) => METHOD_LABELS[method]} disabled={disabled} onChange={(method) => update({ method })} />
			{settings.method === 'guided' ? (
				<>
					<DataList>
						<DataRow label="Guide Camera">
							<DeviceLink device={devices.guideCamera.device} fallback="Not assigned" />
						</DataRow>
						<DataRow label="Dither">{`${guiding.ditherPixels} px${guiding.ditherRaOnly ? ' · RA only' : ''}`}</DataRow>
						<DataRow label="Settle">{`${guiding.settle.pixels} px for ${guiding.settle.time} s, at most ${guiding.settle.timeout} s`}</DataRow>
					</DataList>
					<Notice>The guiding session dithers and settles with the Settle and Dither settings of Guiding.</Notice>
				</>
			) : (
				<>
					<DataList>
						<DataRow label="Mount">
							<DeviceLink device={devices.mount.device} fallback="Not assigned" />
						</DataRow>
						{settings.movement === 'pulse' && (
							<DataRow label="Guide Output">
								<DeviceLink device={devices.guideOutput.device} fallback="Not assigned" />
							</DataRow>
						)}
					</DataList>
					<SegmentedControl label="Movement" options={MOVEMENTS} value={settings.movement} format={(movement) => MOVEMENT_LABELS[movement]} disabled={disabled} onChange={(movement) => update({ movement })} />
					<NumberInput label="Amount" suffix="″" value={settings.amount} min={DITHER_MINIMUM_AMOUNT} max={DITHER_MAXIMUM_AMOUNT} step={1} disabled={disabled} onChange={(amount) => update({ amount })} />
					<Select label="Pattern" options={PATTERNS} value={settings.pattern} format={(pattern) => PATTERN_LABELS[pattern]} disabled={disabled} onChange={(pattern) => update({ pattern })} />
					<NumberInput label="Settle" suffix="s" value={settings.settleTime} min={0} max={DITHER_MAXIMUM_SETTLE} disabled={disabled} onChange={(settleTime) => update({ settleTime })} />
					<Checkbox label="Dither in RA only" checked={settings.raOnly} disabled={disabled} onChange={(raOnly) => update({ raOnly })} />
					<Notice>The settle is a fixed wait after the motion; nothing measures it.</Notice>
					{settings.movement === 'pulse' && <Notice>If this mount moves the other way for a guide direction, the dithers go the opposite way: the offsets are the intended ones, not the physical motion, and Spiral and Grid come out mirrored. Reverse the direction under Advanced.</Notice>}
					{settings.movement === 'pulse' && (
						<CollapsibleSection id="images.camera-acquisition.dithering.advanced" title="Advanced" defaultOpen={false}>
							<Select label="+RA Pulse" options={RA_DIRECTIONS} value={pulse.rightAscensionDirection} format={directionLabel} disabled={disabled || !mountIdentity} onChange={(rightAscensionDirection) => updatePulse({ rightAscensionDirection })} />
							<Select label="+DEC Pulse" options={DEC_DIRECTIONS} value={pulse.declinationDirection} format={directionLabel} disabled={disabled || !mountIdentity} onChange={(declinationDirection) => updatePulse({ declinationDirection })} />
							<NumberInput label="Max Pulse" suffix="ms" value={pulse.maxPulseDuration} min={GUIDING_MINIMUM_PULSE} max={GUIDING_MAXIMUM_PULSE} step={100} disabled={disabled || !mountIdentity} onChange={(maxPulseDuration) => updatePulse({ maxPulseDuration })} />
							<Notice>The guide directions that move this mount toward east and north. No calibration measures them, so the nominal East and North of the mount's commands hold until you reverse one.</Notice>
						</CollapsibleSection>
					)}
				</>
			)}
			{settings.enabled && applicable && <Notice>The delay is followed by the dither and its settle.</Notice>}
		</>
	)
}

interface RunningDitherProps {
	// Dither of the running capture's request; absent when it does not dither.
	readonly dither?: CaptureDither
}

// Dither of the running capture, as its request froze it.
function RunningDither({ dither }: RunningDitherProps) {
	if (!dither) return <Notice>This capture does not dither.</Notice>

	const rows: [string, string][] = [
		['Method', dither.method === 'guided' ? 'Guided' : `Mount · ${MOVEMENT_LABELS[dither.movement]}`],
		['Every', `${dither.everyFrames} frames`],
	]

	if (dither.method === 'guided') rows.push(['Dither', dither.amount.unit === 'guidePixel' ? `${dither.amount.value} px` : 'Angle'])
	else rows.push(['Dither', `${dither.amount}″ · ${PATTERN_LABELS[dither.pattern]}`], ['Settle', `${dither.settleTime} s`])
	if (dither.raOnly) rows.push(['Axes', 'RA only'])

	return (
		<DataList>
			{rows.map(([label, value]) => (
				<DataRow key={label} label={label}>
					{value}
				</DataRow>
			))}
		</DataList>
	)
}
