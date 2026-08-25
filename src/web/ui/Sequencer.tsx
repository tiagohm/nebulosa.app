import { useStore } from '@hooks/store.hook'
import { PlateSolverStoreContext, SequencerStoreContext } from '@shared/context'
import { sequencerStore } from '@stores/sequencer.store'
import { AutoFocusFittingModeSelect } from '@ui/AutoFocusFittingModeSelect'
import { BodyCoordinateInfo } from '@ui/BodyCoordinateInfo'
import { CameraAutoSubFolderModeButton } from '@ui/CameraAutoSubFolderButton'
import { CameraExposureTimeInput } from '@ui/CameraExposureTimeInput'
import { CameraTransferFormatSelect } from '@ui/CameraTransferFormatSelect'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { Chip } from '@ui/components/Chip'
import { DateTimeInput } from '@ui/components/DateTimeInput'
import { IconButton } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Popover } from '@ui/components/Popover'
import { ProgressBar } from '@ui/components/ProgressBar'
import { Select } from '@ui/components/Select'
import { Switch } from '@ui/components/Switch'
import { Tab, TabPanel, Tabs } from '@ui/components/Tabs'
import { TextInput } from '@ui/components/TextInput'
import { CameraDropdown, CoverDropdown, DomeDropdown, FlatPanelDropdown, FocuserDropdown, GuideOutputDropdown, MountDropdown, RotatorDropdown, WheelDropdown } from '@ui/DeviceDropdown'
import { FilePickerInput } from '@ui/FilePickerInput'
import { FrameFormatSelect } from '@ui/FrameFormatSelect'
import { FrameTypeSelect } from '@ui/FrameTypeSelect'
import { GuiderClientModeRadioGroup } from '@ui/GuiderClientModeRadioGroup'
import { Icons } from '@ui/Icon'
import { MountTargetCoordinateTypeRadioGroup } from '@ui/MountTargetCoordinateTypeRadioGroup'
import { PlateSolverTypeSelect } from '@ui/PlateSolverTypeSelect'
import { PlateSolveStartPopover } from '@ui/PlateSolveStartPopover'
import { SequencerAltitudeDirectionSelect } from '@ui/SequencerAltitudeDirectionSelect'
import { SequencerBacklashModeSelect } from '@ui/SequencerBacklashModeSelect'
import { SequencerCaptureOrderSelect } from '@ui/SequencerCaptureOrderSelect'
import { SequencerConditionTypeSelect } from '@ui/SequencerConditionTypeSelect'
import { SequencerDeviceRoleSelect } from '@ui/SequencerDeviceRoleSelect'
import { SequencerMonitorSeveritySelect } from '@ui/SequencerMonitorSeveritySelect'
import { SequencerMonitorTypeSelect } from '@ui/SequencerMonitorTypeSelect'
import { SequencerNotificationEventSelect } from '@ui/SequencerNotificationEventSelect'
import { SequencerNotificationSeveritySelect } from '@ui/SequencerNotificationSeveritySelect'
import { SequencerOnFailureSelect } from '@ui/SequencerOnFailureSelect'
import { SequencerPauseModeSelect } from '@ui/SequencerPauseModeSelect'
import { SequencerRetryPolicyPopover } from '@ui/SequencerRetryPolicyPopover'
import { SequencerSafetyActionTypeSelect } from '@ui/SequencerSafetyActionTypeSelect'
import { SequencerStopModeSelect } from '@ui/SequencerStopModeSelect'
import { StarDetectionSelect } from '@ui/StarDetectionSelect'
import { TrackModeSelect } from '@ui/TrackModeSelect'
import type { IDockviewPanelProps } from 'dockview-react'
import { DEG2RAD, RAD2DEG } from 'nebulosa/src/core/constants'
import type { DeepWritable } from 'nebulosa/src/core/types'
import type { TrackMode, Wheel } from 'nebulosa/src/devices/indi/device'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import type { SequencerAuxiliaryCapture, SequencerCamera, SequencerFilterReference, SequencerGuiderSettle, SequencerRetryPolicy } from '#/sequencer'

const DEFAULT_TRACK_MODES: readonly TrackMode[] = ['SIDEREAL', 'SOLAR', 'LUNAR', 'KING']
const HA_MINUTE = (15 * DEG2RAD) / 60

export const Sequencer = memo(({ api }: IDockviewPanelProps) => {
	const sequencer = useStore(() => sequencerStore(api), [api.id])

	return (
		<SequencerStoreContext value={sequencer}>
			<div className="flex h-full min-h-0 flex-col gap-2 p-2">
				<Equipment />
				<Status />
				<Config />
				<Footer />
			</div>
		</SequencerStoreContext>
	)
})

const Equipment = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, camera, mount, focuser, wheel, rotator, guideCamera, guideOutput, cover, flatPanel, dome } = useSnapshot(sequencer.state)
	const { name } = useSnapshot(sequencer.state.request)

	return (
		<div className="flex flex-col gap-2">
			<TextInput disabled={busy} label="Sequence name" maxLength={256} onValueChange={sequencer.setName} value={name} />
			<div className="flex flex-1 flex-wrap justify-center gap-2">
				<CameraDropdown disabled={busy} onValueChange={sequencer.setCamera} showLabel value={camera} />
				<MountDropdown disabled={busy} onValueChange={sequencer.setMount} showLabel value={mount} />
				<FocuserDropdown disabled={busy} onValueChange={sequencer.setFocuser} showLabel value={focuser} />
				<WheelDropdown disabled={busy} onValueChange={sequencer.setWheel} showLabel value={wheel} />
				<RotatorDropdown disabled={busy} onValueChange={sequencer.setRotator} showLabel value={rotator} />
				<CameraDropdown disabled={busy} label="Guide camera" onValueChange={sequencer.setGuideCamera} showLabel tooltipContent="Guide camera" value={guideCamera} />
				<GuideOutputDropdown disabled={busy} onValueChange={sequencer.setGuideOutput} showLabel value={guideOutput} />
				<CoverDropdown disabled={busy} onValueChange={sequencer.setCover} showLabel value={cover} />
				<FlatPanelDropdown disabled={busy} onValueChange={sequencer.setFlatPanel} showLabel value={flatPanel} />
				<DomeDropdown disabled={busy} onValueChange={sequencer.setDome} showLabel value={dome} />
			</div>
		</div>
	)
})

const Status = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { session, preflight, busy } = useSnapshot(sequencer.state)
	const state = session?.state ?? 'idle'
	const color = state === 'idle' || state === 'completed' ? 'default' : state === 'running' ? 'success' : state === 'paused' || state === 'waitingResources' || state === 'suspended' ? 'warning' : state === 'failed' ? 'danger' : 'primary'
	const exposure = session?.capture.exposure
	const foreground = session?.foreground
	const diagnostics = preflight?.diagnostics ?? []

	return (
		<div className="flex min-w-0 flex-col gap-2">
			<div className="flex min-w-0 flex-row flex-wrap items-center gap-1.5">
				<Chip color={color} size="sm">
					{state}
				</Chip>
				{session?.converging && (
					<Chip color="warning" size="sm">
						converging
					</Chip>
				)}
				{preflight && (
					<Chip color={preflight.ok ? 'success' : 'danger'} size="sm">
						{preflight.ok ? 'valid' : `${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'}`}
					</Chip>
				)}
				{foreground && (
					<Chip color="secondary" size="sm">
						{foreground.name}: {foreground.state}
					</Chip>
				)}
				{session?.failure && (
					<Chip color="danger" size="sm">
						{session.failure.reason}
					</Chip>
				)}
			</div>
			{exposure && <ProgressBar color="primary" endContent={`${exposure.remaining.toFixed(0)}s`} maxValue={exposure.total} value={exposure.elapsed} />}
			{busy && session && session.capture.requiredSlots > 0 && <ProgressBar color="success" endContent={`${session.capture.accepted}/${session.capture.requiredSlots}`} maxValue={session.capture.requiredSlots} value={session.capture.accepted} />}
			{diagnostics.length > 0 && (
				<div className="text-danger max-h-24 overflow-auto rounded-lg bg-neutral-900/70 p-2 text-xs">
					{diagnostics.map((diagnostic, index) => (
						<div key={`${diagnostic.path}-${index}`}>
							<span className="font-bold">{diagnostic.path}:</span> {diagnostic.message}
						</div>
					))}
				</div>
			)}
		</div>
	)
})

const Config = memo(() => (
	<Tabs className="min-h-0 overflow-hidden p-2" fullWidth>
		<Tab id="target">Target</Tab>
		<Tab id="capture">Capture</Tab>
		<Tab id="guiding">Guiding</Tab>
		<Tab id="dither">Dither</Tab>
		<Tab id="autoFocus">Auto Focus</Tab>
		<Tab id="rotator">Rotator</Tab>
		<Tab id="meridianFlip">Meridian Flip</Tab>
		<Tab id="mount">Mount</Tab>
		<Tab id="cooling">Cooling</Tab>
		<Tab id="dome">Dome</Tab>
		<Tab id="cover">Cover</Tab>
		<Tab id="flatPanel">Flat Panel</Tab>
		<Tab id="execution">Execution</Tab>
		<Tab id="storage">Storage</Tab>
		<Tab id="startup">Startup</Tab>
		<Tab id="shutdown">Shutdown</Tab>
		<Tab id="safety">Safety</Tab>
		<Tab id="quality">Quality</Tab>
		<Tab id="monitoring">Monitoring</Tab>
		<Tab id="notification">Notification</Tab>

		<TabPanel className="overflow-auto p-2" id="target">
			<Target />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="capture">
			<Capture />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="guiding">
			<Guiding />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="dither">
			<Dither />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="autoFocus">
			<AutoFocus />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="rotator">
			<RotatorPanel />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="meridianFlip">
			<MeridianFlip />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="mount">
			<MountPanel />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="cooling">
			<Cooling />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="dome">
			<Dome />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="cover">
			<Cover />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="flatPanel">
			<FlatPanel />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="execution">
			<Execution />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="storage">
			<Storage />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="startup">
			<Startup />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="shutdown">
			<Shutdown />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="safety">
			<Safety />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="quality">
			<Quality />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="monitoring">
			<Monitoring />
		</TabPanel>
		<TabPanel className="overflow-auto p-2" id="notification">
			<Notification />
		</TabPanel>
	</Tabs>
))

const Target = memo(() => (
	<div className="grid w-full grid-cols-12 items-center gap-2">
		<TargetName />
		<TargetCoordinates />
		<TargetPosition />
		<TargetSlew />
		<TargetTracking />
		<TargetCentering />
		{/* <TargetConstraints /> */}
	</div>
))

const TargetName = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy } = useSnapshot(sequencer.state)
	const { name } = useSnapshot(sequencer.state.request.target)

	return <TextInput className="col-span-full" disabled={busy} label="Name" maxLength={256} onValueChange={sequencer.setTargetName} value={name} />
})

const TargetCoordinates = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, mount } = useSnapshot(sequencer.state)
	const target = useSnapshot(sequencer.state.request.target)
	const blocked = busy || !mount?.connected
	const { type } = target
	const { x, y } = target[type]!

	return (
		<div className="col-span-full flex flex-wrap items-center gap-2 text-sm">
			<span className="font-bold">COORDINATES:</span>
			<MountTargetCoordinateTypeRadioGroup disabled={blocked} onValueChange={sequencer.setTargetCoordinateType} value={type} />
			<TextInput disabled={blocked} label={type === 'JNOW' || type === 'J2000' ? 'RA' : type === 'ALTAZ' ? 'AZ' : 'LON'} onValueChange={sequencer.setTargetCoordinateX} value={x} />
			<TextInput disabled={blocked} label={type === 'JNOW' || type === 'J2000' ? 'DEC' : type === 'ALTAZ' ? 'ALT' : 'LAT'} onValueChange={sequencer.setTargetCoordinateY} value={y} />
		</div>
	)
})

const TargetPosition = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { type } = useSnapshot(sequencer.state.request.target)
	const { position } = useSnapshot(sequencer.state.target)

	return (
		<div className="col-span-full">
			<BodyCoordinateInfo hideEcliptic={type === 'ECLIPTIC'} hideEquatorial={type === 'JNOW'} hideEquatorialJ2000={type === 'J2000'} hideGalactic={type === 'GALACTIC'} hideHorizontal={type === 'ALTAZ'} hideLst position={position} />
		</div>
	)
})

const TargetSlew = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, mount } = useSnapshot(sequencer.state)
	const { timeout, settle } = useSnapshot(sequencer.state.request.target)
	const blocked = busy || !mount?.connected

	return (
		<div className="col-span-full flex flex-wrap items-center gap-2 text-sm">
			<span className="font-bold">SLEW:</span>
			<NumberInput disabled={blocked} endContent="s" label="Timeout" minValue={0} onValueChange={sequencer.setTargetTimeout} value={timeout} />
			<NumberInput disabled={blocked} endContent="s" label="Settle" minValue={0} onValueChange={sequencer.setTargetSettle} value={settle} />
			<SequencerRetry retry={sequencer.state.request.target.retry} disabled={blocked} />
		</div>
	)
})

const TargetTracking = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, mount } = useSnapshot(sequencer.state)
	const { tracking } = useSnapshot(sequencer.state.request.target)
	const trackModes = mount?.connected && mount.trackModes.length > 0 ? mount.trackModes : DEFAULT_TRACK_MODES
	const blocked = busy || !tracking.enabled || !mount?.connected

	return (
		<div className="col-span-full flex flex-wrap items-center gap-2 text-sm">
			<span className="font-bold">TRACKING:</span>
			<Switch disabled={busy || !mount?.connected} label="Enabled" onValueChange={sequencer.setTargetTrackingEnabled} value={tracking.enabled} />
			<TrackModeSelect disabled={blocked} modes={trackModes} onValueChange={sequencer.setTargetTrackingMode} value={tracking.mode} />
			<Checkbox disabled={blocked} label="Stop on shutdown" onValueChange={sequencer.setTargetTrackingStopOnShutdown} value={tracking.stopOnShutdown} />
			<SequencerRetry retry={sequencer.state.request.target.tracking.retry} disabled={busy || !tracking.enabled || !mount?.connected} />
		</div>
	)
})

const TargetCentering = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, mount } = useSnapshot(sequencer.state)
	const { center } = useSnapshot(sequencer.state.request.target)
	const blocked = busy || !center.enabled || !mount?.connected

	return (
		<div className="col-span-full flex flex-wrap items-center gap-2 text-sm">
			<span className="font-bold">CENTERING:</span>
			<Switch disabled={busy || !mount?.connected} label="Enabled" onValueChange={sequencer.setTargetCenterEnabled} value={center.enabled} />
			<AuxiliaryCapture capture={sequencer.state.request.target.center.capture} disabled={busy || !center.enabled} />
			<PlateSolverTypeSelect disabled={blocked} onValueChange={sequencer.setTargetCenterSolverType} value={center.solver.type} endContent={<TargetCenteringPlateSolverSelectEndContent />} />
			<AngleInput className="col-span-4" disabled={blocked} fractionDigits={1} label="Tolerance" maxValue={3600} minValue={0} onValueChange={sequencer.setTargetCenterTolerance} unit="arcsec" value={center.tolerance} />
			<NumberInput disabled={blocked} label="Max attempts" maxValue={20} minValue={1} onValueChange={sequencer.setTargetCenterMaximumAttempts} value={center.maximumAttempts} />
			<NumberInput disabled={blocked} endContent="s" label="Settle" minValue={0} onValueChange={sequencer.setTargetCenterSettle} value={center.settle} />
			<Checkbox disabled={blocked} label="Sync mount" onValueChange={sequencer.setTargetCenterSyncMount} value={center.syncMount} />
			<SequencerRetry retry={sequencer.state.request.target.center.retry} disabled={busy || !center.enabled} />
		</div>
	)
})

const TargetCenteringPlateSolverSelectEndContent = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, mount } = useSnapshot(sequencer.state)
	const { center } = useSnapshot(sequencer.state.request.target)
	const blocked = busy || !center.enabled || !mount?.connected

	return (
		<PlateSolverStoreContext value={sequencer.targetCenteringSolver}>
			<PlateSolveStartPopover disabled={blocked} />
		</PlateSolverStoreContext>
	)
})

const TargetConstraints = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, mount } = useSnapshot(sequencer.state)
	const { constraints } = useSnapshot(sequencer.state.request.target)
	const blocked = busy || !constraints.enabled

	return (
		<div className="col-span-full flex flex-wrap items-center gap-2 text-sm">
			<span className="font-bold">CONSTRAINTS:</span>
			<Switch disabled={busy || !mount?.connected} label="Enabled" onValueChange={sequencer.setTargetConstraintsEnabled} value={constraints.enabled} />
			<SequencerOnFailureSelect disabled={blocked} label="On violation" onValueChange={sequencer.setTargetConstraintsOnViolation} value={constraints.onViolation} variant="wait" />
			<NumberInput disabled={blocked} endContent="s" label="Stable for" minValue={0} onValueChange={sequencer.setTargetConstraintsStableFor} value={constraints.stableFor} />
			<AngleInput disabled={blocked} label="Min altitude" maxValue={90} minValue={-90} onValueChange={sequencer.setTargetConstraintsMinimumAltitude} value={constraints.minimumAltitude ?? 0} />
			<AngleInput disabled={blocked} label="Max altitude" maxValue={90} minValue={-90} onValueChange={sequencer.setTargetConstraintsMaximumAltitude} value={constraints.maximumAltitude ?? 0} />
			<NumberInput disabled={blocked} label="Max airmass" minValue={1} onValueChange={sequencer.setTargetConstraintsMaximumAirmass} value={constraints.maximumAirmass ?? 0} />
			<AngleInput disabled={blocked} label="Min moon distance" maxValue={180} minValue={0} onValueChange={sequencer.setTargetConstraintsMinimumMoonDistance} value={constraints.minimumMoonDistance ?? 0} />
			<NumberInput disabled={blocked} fractionDigits={2} label="Max moon illumination" maxValue={1} minValue={0} onValueChange={sequencer.setTargetConstraintsMaximumMoonIllumination} step={0.01} value={constraints.maximumMoonIllumination ?? 0} />
			<HourAngleMinutesInput disabled={blocked} label="Min hour angle" onValueChange={sequencer.setTargetConstraintsMinimumHourAngle} value={constraints.minimumHourAngle ?? 0} />
			<HourAngleMinutesInput disabled={blocked} label="Max hour angle" onValueChange={sequencer.setTargetConstraintsMaximumHourAngle} value={constraints.maximumHourAngle ?? 0} />
			<Switch disabled={blocked} label="Time window" onValueChange={sequencer.setTargetConstraintsWindowEnabled} value={constraints.window.enabled} />
			<OptionalDateTimeInput disabled={blocked || !constraints.window.enabled} label="Window start" onValueChange={sequencer.setTargetConstraintsWindowStart} value={constraints.window.start} />
			<OptionalDateTimeInput disabled={blocked || !constraints.window.enabled} label="Window end" onValueChange={sequencer.setTargetConstraintsWindowEnd} value={constraints.window.end} />
			<AngleInput disabled={blocked || !constraints.window.enabled} label="Max sun altitude" maxValue={90} minValue={-90} onValueChange={sequencer.setTargetConstraintsWindowMaximumSunAltitude} value={constraints.window.maximumSunAltitude ?? 0} />
		</div>
	)
})

const Capture = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, camera } = useSnapshot(sequencer.state)
	const capture = useSnapshot(sequencer.state.request.capture)
	const frames = capture.frames
	const blocked = busy || !camera

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<CaptureMode />
			<CaptureFrames />
		</div>
	)
})

const CaptureMode = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, camera } = useSnapshot(sequencer.state)
	const capture = useSnapshot(sequencer.state.request.capture)
	const blocked = busy || !camera?.connected

	return (
		<div className="col-span-full flex flex-wrap items-center gap-2 text-sm">
			<span className="font-bold">MODE:</span>
			<SequencerCaptureOrderSelect disabled={blocked} onValueChange={sequencer.setCaptureOrder} value={capture.order} />
			<NumberInput disabled={blocked} label="Repeat" minValue={1} onValueChange={sequencer.setCaptureRepeat} value={capture.repeat} />
			<NumberInput disabled={blocked} endContent="s" label="Delay" minValue={0} onValueChange={sequencer.setCaptureDelay} value={capture.delay} />
			<Checkbox disabled={blocked} label="Continue after rejected frame" onValueChange={sequencer.setCaptureContinueAfterRejectedFrame} value={capture.continueAfterRejectedFrame} />
			<SequencerRetry retry={sequencer.state.request.capture.retry} disabled={blocked} />
		</div>
	)
})

const CaptureFrames = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, camera } = useSnapshot(sequencer.state)
	const capture = useSnapshot(sequencer.state.request.capture)
	const frames = capture.frames
	const blocked = busy || !camera?.connected

	return (
		<div className="col-span-full flex flex-wrap items-center gap-2 text-sm">
			<span className="font-bold">FRAMES:</span>
			<div className="flex flex-1 flex-row items-center justify-end">
				<Button color="success" disabled={blocked} label="Add frame" onClick={sequencer.addFrame} startContent={<Icons.Plus />} />
			</div>
			<div className="flex flex-col items-center gap-2">
				{frames.map((frame, index) => (
					<FrameEditor disabled={blocked} index={index} key={frame.id} />
				))}
			</div>
		</div>
	)
})

interface FrameEditorProps {
	readonly index: number
	readonly disabled?: boolean
}

const FrameEditor = memo(({ index, disabled }: FrameEditorProps) => {
	const sequencer = useContext(SequencerStoreContext)
	const { camera, wheel } = useSnapshot(sequencer.state)
	const frame = useSnapshot(sequencer.state.request.capture.frames[index])
	const { length: count } = useSnapshot(sequencer.state.request.capture.frames)

	if (!frame) return null

	const blocked = disabled || !frame.enabled

	return (
		<div className="flex flex-row flex-wrap items-center gap-2 rounded-lg bg-neutral-900/70 p-2">
			<Switch disabled={disabled} label="On" onValueChange={(value) => sequencer.updateFrame(index, 'enabled', value)} value={frame.enabled} />
			<TextInput className="min-w-80" disabled={blocked} label="Name" onValueChange={(value) => sequencer.updateFrame(index, 'name', value)} value={frame.name} />
			<FrameTypeSelect disabled={blocked} onValueChange={(value) => sequencer.updateFrameCapture(index, 'frameType', value)} value={frame.capture.frameType} />
			<CameraExposureTimeInput
				disabled={blocked || frame.capture.frameType === 'BIAS'}
				maxValue={camera?.exposure.max ?? 0}
				maxValueUnit="second"
				minValue={camera?.exposure.min ?? 0}
				minValueUnit="second"
				onUnitChange={(value) => sequencer.updateFrameCapture(index, 'exposureTimeUnit', value)}
				onValueChange={(value) => sequencer.updateFrameCapture(index, 'exposureTime', value)}
				unit={frame.capture.exposureTimeUnit}
				value={frame.capture.exposureTime}
			/>
			<NumberInput disabled={blocked} label="Count" minValue={0} onValueChange={(value) => sequencer.updateFrame(index, 'count', value)} value={frame.count} />
			<NumberInput disabled={blocked} endContent="s" label="Delay" minValue={0} onValueChange={(value) => sequencer.updateFrame(index, 'delay', value)} value={frame.delay ?? sequencer.state.request.capture.delay} />
			<NumberInput disabled={blocked} label="Weight" minValue={0} onValueChange={(value) => sequencer.updateFrame(index, 'weight', value)} value={frame.weight} />
			<NumberInput disabled={blocked} label="Abandonment budget" minValue={0} onValueChange={(value) => sequencer.updateFrame(index, 'abandonmentBudget', value)} value={frame.abandonmentBudget ?? 0} />
			<CameraFields camera={sequencer.state.request.capture.frames[index].capture} disabled={blocked} />
			<FilterReferenceInput disabled={blocked || !wheel?.connected} onValueChange={(value) => sequencer.updateFrameFilter(index, value)} value={frame.capture.filter} wheel={wheel} />
			<div className="col-span-full flex justify-end gap-1">
				<IconButton color="secondary" disabled={disabled || index === 0} icon={Icons.ChevronUp} onClick={() => sequencer.moveFrame(index, -1)} tooltipContent="Move up" />
				<IconButton color="secondary" disabled={disabled || index === count - 1} icon={Icons.ChevronDown} onClick={() => sequencer.moveFrame(index, 1)} tooltipContent="Move down" />
				<IconButton color="danger" disabled={disabled} icon={Icons.Trash} onClick={() => sequencer.removeFrame(index)} tooltipContent="Remove" />
			</div>
		</div>
	)
})

const Guiding = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, guideCamera, guideOutput } = useSnapshot(sequencer.state)
	const guiding = useSnapshot(sequencer.state.request.guiding)
	const connection = sequencer.state.request.guiding.connection
	const blocked = busy || !guiding.enabled
	const localBlocked = blocked || guiding.connection.mode !== 'local' || !guideCamera || !guideOutput

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy} label="Enable guiding" onValueChange={sequencer.setGuidingEnabled} value={guiding.enabled} />
			<GuiderClientModeRadioGroup className="col-span-full" disabled={blocked} horizontal onValueChange={sequencer.setGuidingConnectionMode} value={guiding.connection.mode} />
			{guiding.connection.mode === 'remote' ? (
				<>
					<TextInput className="col-span-8" disabled={blocked} label="Host" maxLength={128} onValueChange={sequencer.setGuidingRemoteHost} value={guiding.connection.host} />
					<NumberInput className="col-span-4" disabled={blocked} label="Port" maxValue={65535} minValue={1} onValueChange={sequencer.setGuidingRemotePort} value={guiding.connection.port} />
					<TextInput className="col-span-full" disabled={blocked} label="Profile" onValueChange={sequencer.setGuidingRemoteProfile} value={guiding.connection.profile ?? ''} />
				</>
			) : (
				<>
					<NumberInput className="col-span-6" disabled={localBlocked} label="Focal length" minValue={0} onValueChange={sequencer.setGuidingLocalFocalLength} value={guiding.connection.focalLength} />
					<NumberInput className="col-span-6" disabled={localBlocked} fractionDigits={2} label="Pixel size" minValue={0} onValueChange={sequencer.setGuidingLocalPixelSize} value={guiding.connection.pixelSize ?? 0} />
					{connection.mode === 'local' && <AuxiliaryCapture capture={connection.capture} disabled={localBlocked} hideFilter />}
				</>
			)}
			<Checkbox className="col-span-4" disabled={blocked} label="Calibrate before start" onValueChange={sequencer.setGuidingCalibrateBeforeStart} value={guiding.calibrateBeforeStart} />
			<Checkbox className="col-span-4" disabled={blocked} label="Recalibrate after flip" onValueChange={sequencer.setGuidingRecalibrateAfterMeridianFlip} value={guiding.recalibrateAfterMeridianFlip} />
			<Checkbox className="col-span-4" disabled={blocked} label="Restore after interruption" onValueChange={sequencer.setGuidingRestoreAfterInterruption} value={guiding.restoreAfterInterruption} />
			<Checkbox className="col-span-4" disabled={blocked} label="Stop on shutdown" onValueChange={sequencer.setGuidingStopOnShutdown} value={guiding.stopOnShutdown} />
			<div className="col-span-8">
				<SequencerRetry retry={sequencer.state.request.guiding.retry} disabled={blocked} />
			</div>
			<span className="col-span-full text-sm font-bold">SETTLE:</span>
			<GuiderSettle disabled={blocked} settle={sequencer.state.request.guiding.settle} />
			<span className="col-span-full text-sm font-bold">THRESHOLDS:</span>
			<Switch className="col-span-4" disabled={blocked} label="Enabled" onValueChange={sequencer.setGuidingThresholdsEnabled} value={guiding.thresholds.enabled} />
			<Checkbox className="col-span-8" disabled={blocked || !guiding.thresholds.enabled} label="Pause capture when exceeded" onValueChange={sequencer.setGuidingThresholdsPauseCaptureWhenExceeded} value={guiding.thresholds.pauseCaptureWhenExceeded} />
			<NumberInput className="col-span-4" disabled={blocked || !guiding.thresholds.enabled} fractionDigits={2} label="Max RMS" minValue={0} onValueChange={sequencer.setGuidingThresholdsMaximumRMS} value={guiding.thresholds.maximumRMS ?? 0} />
			<NumberInput className="col-span-4" disabled={blocked || !guiding.thresholds.enabled} fractionDigits={2} label="Max RA RMS" minValue={0} onValueChange={sequencer.setGuidingThresholdsMaximumRightAscensionRMS} value={guiding.thresholds.maximumRightAscensionRMS ?? 0} />
			<NumberInput className="col-span-4" disabled={blocked || !guiding.thresholds.enabled} fractionDigits={2} label="Max DEC RMS" minValue={0} onValueChange={sequencer.setGuidingThresholdsMaximumDeclinationRMS} value={guiding.thresholds.maximumDeclinationRMS ?? 0} />
			<NumberInput className="col-span-4" disabled={blocked || !guiding.thresholds.enabled} label="Min SNR" minValue={0} onValueChange={sequencer.setGuidingThresholdsMinimumSNR} value={guiding.thresholds.minimumSNR ?? 0} />
			<NumberInput className="col-span-4" disabled={blocked || !guiding.thresholds.enabled} label="Min star mass" minValue={0} onValueChange={sequencer.setGuidingThresholdsMinimumStarMass} value={guiding.thresholds.minimumStarMass ?? 0} />
			<NumberInput className="col-span-4" disabled={blocked || !guiding.thresholds.enabled} endContent="s" label="Max lost star" minValue={0} onValueChange={sequencer.setGuidingThresholdsMaximumLostStarTime} value={guiding.thresholds.maximumLostStarTime ?? 0} />
			<span className="col-span-full text-sm font-bold">RECOVERY:</span>
			<Switch className="col-span-4" disabled={blocked} label="Enabled" onValueChange={sequencer.setGuidingRecoveryEnabled} value={guiding.recovery.enabled} />
			<NumberInput className="col-span-4" disabled={blocked || !guiding.recovery.enabled} label="Max attempts" minValue={1} onValueChange={sequencer.setGuidingRecoveryMaximumAttempts} value={guiding.recovery.maximumAttempts} />
			<SequencerOnFailureSelect className="col-span-4" disabled={blocked || !guiding.recovery.enabled} onValueChange={sequencer.setGuidingRecoveryOnFailure} value={guiding.recovery.onFailure} variant="continueUnguided" />
			<Checkbox className="col-span-4" disabled={blocked || !guiding.recovery.enabled} label="Stop before retry" onValueChange={sequencer.setGuidingRecoveryStopBeforeRetry} value={guiding.recovery.stopBeforeRetry} />
			<Checkbox className="col-span-4" disabled={blocked || !guiding.recovery.enabled} label="Find star before retry" onValueChange={sequencer.setGuidingRecoveryFindStarBeforeRetry} value={guiding.recovery.findStarBeforeRetry} />
			<Checkbox className="col-span-4" disabled={blocked || !guiding.recovery.enabled} label="Recalibrate" onValueChange={sequencer.setGuidingRecoveryRecalibrate} value={guiding.recovery.recalibrate} />
			<span className="col-span-full text-sm font-bold">RECOVERY SETTLE:</span>
			<GuiderSettle disabled={blocked || !guiding.recovery.enabled} settle={sequencer.state.request.guiding.recovery.settle} />
		</div>
	)
})

const Dither = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy } = useSnapshot(sequencer.state)
	const dither = useSnapshot(sequencer.state.request.dither)
	const guidingEnabled = useSnapshot(sequencer.state.request.guiding).enabled
	const blocked = busy || !dither.enabled || !guidingEnabled

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy || !guidingEnabled} label="Enable dither" onValueChange={sequencer.setDitherEnabled} value={dither.enabled} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={1} label="Amount" minValue={0} onValueChange={sequencer.setDitherAmount} value={dither.amount} />
			<NumberInput className="col-span-4" disabled={blocked} label="Every frames" minValue={0} onValueChange={sequencer.setDitherEveryFrames} value={dither.everyFrames} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Every time" minValue={0} onValueChange={sequencer.setDitherEveryTime} value={dither.everyTime} />
			<Checkbox className="col-span-4" disabled={blocked} label="RA only" onValueChange={sequencer.setDitherRaOnly} value={dither.raOnly} />
			<Checkbox className="col-span-4" disabled={blocked} label="Before first frame" onValueChange={sequencer.setDitherBeforeFirstFrame} value={dither.beforeFirstFrame} />
			<Checkbox className="col-span-4" disabled={blocked} label="After filter change" onValueChange={sequencer.setDitherAfterFilterChange} value={dither.afterFilterChange} />
			<SequencerOnFailureSelect className="col-span-8" disabled={blocked} onValueChange={sequencer.setDitherOnFailure} value={dither.onFailure} variant="continue" />
			<div className="col-span-4">
				<SequencerRetry retry={sequencer.state.request.dither.retry} disabled={blocked} />
			</div>
		</div>
	)
})

const AutoFocus = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, focuser, camera } = useSnapshot(sequencer.state)
	const autofocus = useSnapshot(sequencer.state.request.autofocus)
	const blocked = busy || !autofocus.enabled || !focuser || !camera
	const backlashBlocked = blocked || !autofocus.algorithm.backlash.enabled

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy || !focuser || !camera} label="Enable autofocus" onValueChange={sequencer.setAutofocusEnabled} value={autofocus.enabled} />
			<span className="col-span-full text-sm font-bold">TRIGGERS:</span>
			<Checkbox className="col-span-4" disabled={blocked} label="On start" onValueChange={sequencer.setAutofocusTriggersOnStart} value={autofocus.triggers.onStart} />
			<Checkbox className="col-span-4" disabled={blocked} label="On filter change" onValueChange={sequencer.setAutofocusTriggersOnFilterChange} value={autofocus.triggers.onFilterChange} />
			<Checkbox className="col-span-4" disabled={blocked} label="After meridian flip" onValueChange={sequencer.setAutofocusTriggersAfterMeridianFlip} value={autofocus.triggers.afterMeridianFlip} />
			<NumberInput className="col-span-4" disabled={blocked} label="Every frames" minValue={0} onValueChange={sequencer.setAutofocusTriggersEveryFrames} value={autofocus.triggers.everyFrames} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Every time" minValue={0} onValueChange={sequencer.setAutofocusTriggersEveryTime} value={autofocus.triggers.everyTime} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={1} label="Temperature change" minValue={0} onValueChange={sequencer.setAutofocusTriggersTemperatureChange} value={autofocus.triggers.temperatureChange} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Min time between runs" minValue={0} onValueChange={sequencer.setAutofocusTriggersMinimumTimeBetweenRuns} value={autofocus.triggers.minimumTimeBetweenRuns} />
			<span className="col-span-full text-sm font-bold">ALGORITHM:</span>
			<NumberInput className="col-span-4" disabled={blocked} label="Offset steps" minValue={1} onValueChange={sequencer.setAutofocusAlgorithmInitialOffsetSteps} value={autofocus.algorithm.initialOffsetSteps} />
			<NumberInput className="col-span-4" disabled={blocked} label="Step size" minValue={1} onValueChange={sequencer.setAutofocusAlgorithmStepSize} value={autofocus.algorithm.stepSize} />
			<AutoFocusFittingModeSelect className="col-span-4" disabled={blocked} onValueChange={sequencer.setAutofocusAlgorithmFittingMode} value={autofocus.algorithm.fittingMode} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={2} label="RMSD threshold" minValue={0} onValueChange={sequencer.setAutofocusAlgorithmRmsdThreshold} value={autofocus.algorithm.rmsdThreshold} />
			<NumberInput className="col-span-4" disabled={blocked} label="Max position" minValue={0} onValueChange={sequencer.setAutofocusAlgorithmMaximumPosition} value={autofocus.algorithm.maximumPosition} />
			<Checkbox className="col-span-4" disabled={blocked} label="Reversed" onValueChange={sequencer.setAutofocusAlgorithmReversed} value={autofocus.algorithm.reversed} />
			<Switch className="col-span-4" disabled={blocked} label="Backlash" onValueChange={sequencer.setAutofocusAlgorithmBacklashEnabled} value={autofocus.algorithm.backlash.enabled} />
			<SequencerBacklashModeSelect className="col-span-4" disabled={backlashBlocked} onValueChange={sequencer.setAutofocusAlgorithmBacklashMode} value={autofocus.algorithm.backlash.mode} />
			<NumberInput className="col-span-4" disabled={backlashBlocked} label="Backlash steps" minValue={0} onValueChange={sequencer.setAutofocusAlgorithmBacklashSteps} value={autofocus.algorithm.backlash.steps} />
			<span className="col-span-full text-sm font-bold">STAR DETECTION:</span>
			<StarDetectionSelect className="col-span-4" disabled={blocked} onValueChange={sequencer.setAutofocusStarDetectionType} value={autofocus.starDetection.type} />
			<TextInput className="col-span-8" disabled={blocked || autofocus.starDetection.type === 'nebulosa'} label="Executable" onValueChange={sequencer.setAutofocusStarDetectionExecutable} value={autofocus.starDetection.executable ?? ''} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Timeout" minValue={0} onValueChange={sequencer.setAutofocusStarDetectionTimeout} value={autofocus.starDetection.timeout} />
			<NumberInput className="col-span-4" disabled={blocked} label="Min SNR" minValue={0} onValueChange={sequencer.setAutofocusStarDetectionMinimumSNR} value={autofocus.starDetection.minimumSNR} />
			<NumberInput className="col-span-4" disabled={blocked} label="Max stars" minValue={0} onValueChange={sequencer.setAutofocusStarDetectionMaximumStars} value={autofocus.starDetection.maximumStars} />
			<AuxiliaryCapture capture={sequencer.state.request.autofocus.capture} disabled={blocked} />
			<div className="col-span-full flex items-center justify-between">
				<span className="text-sm font-bold">FILTER OFFSETS:</span>
				<Button color="success" disabled={blocked} label="Add offset" onClick={sequencer.addFilterOffset} startContent={<Icons.Plus />} />
			</div>
			{autofocus.filterOffsets.map((item, index) => (
				<FilterOffsetEditor disabled={blocked} index={index} key={`${item.filter.type}-${index}`} />
			))}
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Settle" minValue={0} onValueChange={sequencer.setAutofocusSettle} value={autofocus.settle} />
			<SequencerOnFailureSelect className="col-span-4" disabled={blocked} onValueChange={sequencer.setAutofocusOnFailure} value={autofocus.onFailure} variant="continue" />
			<div className="col-span-4">
				<SequencerRetry retry={sequencer.state.request.autofocus.retry} disabled={blocked} />
			</div>
		</div>
	)
})

const RotatorPanel = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, rotator } = useSnapshot(sequencer.state)
	const config = useSnapshot(sequencer.state.request.rotator)
	const blocked = busy || !config.enabled || !rotator

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy || !rotator} label="Enable rotator" onValueChange={sequencer.setRotatorEnabled} value={config.enabled} />
			<AngleInput className="col-span-4" disabled={blocked} label="Angle" maxValue={360} minValue={0} onValueChange={sequencer.setRotatorAngle} value={config.angle} />
			<AngleInput className="col-span-4" disabled={blocked} fractionDigits={1} label="Tolerance" maxValue={3600} minValue={0} onValueChange={sequencer.setRotatorTolerance} unit="arcsec" value={config.tolerance} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Settle" minValue={0} onValueChange={sequencer.setRotatorSettle} value={config.settle} />
			<Checkbox className="col-span-4" disabled={blocked} label="Move before centering" onValueChange={sequencer.setRotatorMoveBeforeCentering} value={config.moveBeforeCentering} />
			<Checkbox className="col-span-4" disabled={blocked} label="Restore after flip" onValueChange={sequencer.setRotatorRestoreAfterMeridianFlip} value={config.restoreAfterMeridianFlip} />
			<Checkbox className="col-span-4" disabled={blocked} label="Reverse" onValueChange={sequencer.setRotatorReverse} value={config.reverse} />
			<div className="col-span-full">
				<SequencerRetry retry={sequencer.state.request.rotator.retry} disabled={blocked} />
			</div>
		</div>
	)
})

const MeridianFlip = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, mount } = useSnapshot(sequencer.state)
	const config = useSnapshot(sequencer.state.request.meridianFlip)
	const blocked = busy || !config.enabled || !mount?.connected

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy || !mount?.connected} label="Enable meridian flip" onValueChange={sequencer.setMeridianFlipEnabled} value={config.enabled} />
			<HourAngleMinutesInput className="col-span-4" disabled={blocked} label="Min hour angle" onValueChange={sequencer.setMeridianFlipMinimumHourAngle} value={config.minimumHourAngle} />
			<HourAngleMinutesInput className="col-span-4" disabled={blocked} label="Max hour angle" onValueChange={sequencer.setMeridianFlipMaximumHourAngle} value={config.maximumHourAngle} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Safety margin" minValue={0} onValueChange={sequencer.setMeridianFlipSafetyMargin} value={config.safetyMargin} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Settle" minValue={0} onValueChange={sequencer.setMeridianFlipSettle} value={config.settle} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Timeout" minValue={0} onValueChange={sequencer.setMeridianFlipTimeout} value={config.timeout} />
			<SequencerOnFailureSelect className="col-span-4" disabled={blocked} onValueChange={sequencer.setMeridianFlipOnFailure} value={config.onFailure} />
			<div className="col-span-full">
				<SequencerRetry retry={sequencer.state.request.meridianFlip.retry} disabled={blocked} />
			</div>
		</div>
	)
})

const MountPanel = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, mount } = useSnapshot(sequencer.state)
	const config = useSnapshot(sequencer.state.request.mount)
	const blocked = busy || !config.enabled || !mount?.connected

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy || !mount?.connected} label="Enable mount parking" onValueChange={sequencer.setMountEnabled} value={config.enabled} />
			<Checkbox className="col-span-4" disabled={blocked} label="Unpark on startup" onValueChange={sequencer.setMountUnparkOnStartup} value={config.unparkOnStartup} />
			<Checkbox className="col-span-4" disabled={blocked} label="Park on shutdown" onValueChange={sequencer.setMountParkOnShutdown} value={config.parkOnShutdown} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Timeout" minValue={0} onValueChange={sequencer.setMountTimeout} value={config.timeout} />
			<div className="col-span-full">
				<SequencerRetry retry={sequencer.state.request.mount.retry} disabled={blocked} />
			</div>
		</div>
	)
})

const Cooling = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, camera } = useSnapshot(sequencer.state)
	const config = useSnapshot(sequencer.state.request.cooling)
	const canCool = camera?.hasCooler === true
	const blocked = busy || !config.enabled || !canCool

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy || !canCool} label="Enable cooling" onValueChange={sequencer.setCoolingEnabled} value={config.enabled} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={1} label="Temperature" onValueChange={sequencer.setCoolingTemperature} value={config.temperature} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={1} label="Tolerance" minValue={0} onValueChange={sequencer.setCoolingTolerance} value={config.tolerance} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={1} label="Ramp" minValue={0} onValueChange={sequencer.setCoolingRamp} value={config.ramp} />
			<Checkbox className="col-span-4" disabled={blocked} label="Wait for target" onValueChange={sequencer.setCoolingWaitForTarget} value={config.waitForTarget} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Timeout" minValue={0} onValueChange={sequencer.setCoolingTimeout} value={config.timeout} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={1} label="Warm temperature" onValueChange={sequencer.setCoolingWarmTemperature} value={config.warmTemperature} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={1} label="Warm ramp" minValue={0} onValueChange={sequencer.setCoolingWarmRamp} value={config.warmRamp} />
			<Checkbox className="col-span-4" disabled={blocked} label="Turn cooler off after warm" onValueChange={sequencer.setCoolingTurnCoolerOffAfterWarm} value={config.turnCoolerOffAfterWarm} />
			<Checkbox className="col-span-4" disabled={blocked} label="Warm on shutdown" onValueChange={sequencer.setCoolingWarmOnShutdown} value={config.warmOnShutdown} />
			<div className="col-span-full">
				<SequencerRetry retry={sequencer.state.request.cooling.retry} disabled={blocked} />
			</div>
		</div>
	)
})

const Dome = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, dome } = useSnapshot(sequencer.state)
	const config = useSnapshot(sequencer.state.request.dome)
	const blocked = busy || !config.enabled || !dome

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy || !dome} label="Enable dome" onValueChange={sequencer.setDomeEnabled} value={config.enabled} />
			<Checkbox className="col-span-4" disabled={blocked} label="Unpark on startup" onValueChange={sequencer.setDomeUnparkOnStartup} value={config.unparkOnStartup} />
			<Checkbox className="col-span-4" disabled={blocked} label="Open on startup" onValueChange={sequencer.setDomeOpenOnStartup} value={config.openOnStartup} />
			<Checkbox className="col-span-4" disabled={blocked} label="Park on shutdown" onValueChange={sequencer.setDomeParkOnShutdown} value={config.parkOnShutdown} />
			<Checkbox className="col-span-4" disabled={blocked} label="Close on shutdown" onValueChange={sequencer.setDomeCloseOnShutdown} value={config.closeOnShutdown} />
			<Checkbox className="col-span-4" disabled={blocked} label="Close on unsafe" onValueChange={sequencer.setDomeCloseOnUnsafe} value={config.closeOnUnsafe} />
			<Checkbox className="col-span-4" disabled={blocked} label="Slaving" onValueChange={sequencer.setDomeSlaving} value={config.slaving} />
			<Checkbox className="col-span-4" disabled={blocked} label="Synchronize before capture" onValueChange={sequencer.setDomeSynchronizeBeforeCapture} value={config.synchronizeBeforeCapture} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Settle" minValue={0} onValueChange={sequencer.setDomeSettle} value={config.settle} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Timeout" minValue={0} onValueChange={sequencer.setDomeTimeout} value={config.timeout} />
			<SequencerOnFailureSelect className="col-span-4" disabled={blocked} onValueChange={sequencer.setDomeOnFailure} value={config.onFailure} />
			<div className="col-span-full">
				<SequencerRetry retry={sequencer.state.request.dome.retry} disabled={blocked} />
			</div>
		</div>
	)
})

const Cover = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, cover } = useSnapshot(sequencer.state)
	const config = useSnapshot(sequencer.state.request.cover)
	const blocked = busy || !config.enabled || !cover

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy || !cover} label="Enable cover" onValueChange={sequencer.setCoverEnabled} value={config.enabled} />
			<Checkbox className="col-span-4" disabled={blocked} label="Open on startup" onValueChange={sequencer.setCoverOpenOnStartup} value={config.openOnStartup} />
			<Checkbox className="col-span-4" disabled={blocked} label="Close on shutdown" onValueChange={sequencer.setCoverCloseOnShutdown} value={config.closeOnShutdown} />
			<Checkbox className="col-span-4" disabled={blocked} label="Close on unsafe" onValueChange={sequencer.setCoverCloseOnUnsafe} value={config.closeOnUnsafe} />
			<Checkbox className="col-span-4" disabled={blocked} label="Open before capture" onValueChange={sequencer.setCoverOpenBeforeCapture} value={config.openBeforeCapture} />
			<Checkbox className="col-span-4" disabled={blocked} label="Close for dark frames" onValueChange={sequencer.setCoverCloseForDarkFrames} value={config.closeForDarkFrames} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Timeout" minValue={0} onValueChange={sequencer.setCoverTimeout} value={config.timeout} />
			<div className="col-span-full">
				<SequencerRetry retry={sequencer.state.request.cover.retry} disabled={blocked} />
			</div>
		</div>
	)
})

const FlatPanel = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, flatPanel } = useSnapshot(sequencer.state)
	const config = useSnapshot(sequencer.state.request.flatPanel)
	const blocked = busy || !config.enabled || !flatPanel

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy || !flatPanel} label="Enable flat panel" onValueChange={sequencer.setFlatPanelEnabled} value={config.enabled} />
			<NumberInput className="col-span-4" disabled={blocked} label="Brightness" minValue={0} onValueChange={sequencer.setFlatPanelBrightness} value={config.brightness} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Timeout" minValue={0} onValueChange={sequencer.setFlatPanelTimeout} value={config.timeout} />
			<div className="col-span-4">
				<SequencerRetry retry={sequencer.state.request.flatPanel.retry} disabled={blocked} />
			</div>
			<div className="col-span-full flex items-center justify-between">
				<span className="text-sm font-bold">BRIGHTNESS BY FILTER:</span>
				<Button color="success" disabled={blocked} label="Add filter" onClick={sequencer.addFilterBrightness} startContent={<Icons.Plus />} />
			</div>
			{config.brightnessByFilter.map((item, index) => (
				<FilterBrightnessEditor disabled={blocked} index={index} key={`${item.filter.type}-${index}`} />
			))}
		</div>
	)
})

const Execution = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy } = useSnapshot(sequencer.state)
	const execution = useSnapshot(sequencer.state.request.execution)
	const start = execution.start
	const end = execution.end

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<SequencerConditionTypeSelect className="col-span-6" disabled={busy} kind="start" onValueChange={sequencer.setStartConditionType} value={start.type} />
			<SequencerConditionTypeSelect className="col-span-6" disabled={busy} kind="end" onValueChange={sequencer.setEndConditionType} value={end.type} />
			{start.type === 'at' && <DateTimeInput className="col-span-6" disabled={busy} granularity="second" label="Start time" onValueChange={(value) => sequencer.setStartAtTime(fromPlainDateTime(value))} value={toPlainDateTime(start.time)} />}
			{end.type === 'at' && <DateTimeInput className="col-span-6" disabled={busy} granularity="second" label="End time" onValueChange={(value) => sequencer.setEndAtTime(fromPlainDateTime(value))} value={toPlainDateTime(end.time)} />}
			{end.type === 'integrationTime' && <NumberInput className="col-span-6" disabled={busy} endContent="s" label="Integration time" minValue={0} onValueChange={sequencer.setEndIntegrationTime} value={end.time} />}
			{(start.type === 'sunAltitude' || start.type === 'targetAltitude') && (
				<>
					<AngleInput className="col-span-3" disabled={busy} label="Start altitude" maxValue={90} minValue={-90} onValueChange={sequencer.setStartAltitude} value={start.altitude} />
					<SequencerAltitudeDirectionSelect className="col-span-3" disabled={busy} onValueChange={sequencer.setStartDirection} value={start.direction} />
				</>
			)}
			{(end.type === 'sunAltitude' || end.type === 'targetAltitude') && (
				<>
					<AngleInput className="col-span-3" disabled={busy} label="End altitude" maxValue={90} minValue={-90} onValueChange={sequencer.setEndAltitude} value={end.altitude} />
					<SequencerAltitudeDirectionSelect className="col-span-3" disabled={busy} onValueChange={sequencer.setEndDirection} value={end.direction} />
				</>
			)}
			<SequencerPauseModeSelect className="col-span-6" disabled={busy} onValueChange={sequencer.setExecutionPauseMode} value={execution.pauseMode} />
			<SequencerStopModeSelect className="col-span-6" disabled={busy} onValueChange={sequencer.setExecutionStopMode} value={execution.stopMode} />
			<span className="col-span-full text-sm font-bold">CHECKPOINT:</span>
			<Checkbox className="col-span-4" disabled={busy} label="After every action" onValueChange={sequencer.setExecutionCheckpointAfterEveryAction} value={execution.checkpoint.afterEveryAction} />
			<Checkbox className="col-span-4" disabled={busy} label="After every frame" onValueChange={sequencer.setExecutionCheckpointAfterEveryFrame} value={execution.checkpoint.afterEveryFrame} />
			<Checkbox className="col-span-4" disabled={busy} label="After every artifact" onValueChange={sequencer.setExecutionCheckpointAfterEveryArtifact} value={execution.checkpoint.afterEveryArtifact} />
			<NumberInput className="col-span-4" disabled={busy} endContent="s" label="Interval" minValue={0} onValueChange={sequencer.setExecutionCheckpointInterval} value={execution.checkpoint.interval} />
			<div className="col-span-full">
				<SequencerRetry retry={sequencer.state.request.execution.defaultRetry} disabled={busy} />
			</div>
		</div>
	)
})

const Storage = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy } = useSnapshot(sequencer.state)
	const storage = useSnapshot(sequencer.state.request.storage)

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<FilePickerInput disabled={busy} label="Root" mode="directory" onValueChange={sequencer.setStorageRoot} value={storage.root} />
			<TextInput className="col-span-6" disabled={busy} label="File name template" onValueChange={sequencer.setStorageFileNameTemplate} value={storage.fileNameTemplate} />
			<TextInput className="col-span-6" disabled={busy} label="Directory template" onValueChange={sequencer.setStorageDirectoryTemplate} value={storage.directoryTemplate} />
			<FilePickerInput disabled={busy} label="Temporary directory" mode="directory" onValueChange={sequencer.setStorageTemporaryDirectory} value={storage.temporaryDirectory ?? ''} />
			<div className="col-span-full flex items-center justify-end">
				<CameraAutoSubFolderModeButton disabled={busy} onValueChange={sequencer.setStorageAutoSubFolderMode} value={storage.autoSubFolderMode} />
			</div>
		</div>
	)
})

const Startup = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy } = useSnapshot(sequencer.state)
	const startup = useSnapshot(sequencer.state.request.startup)

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-6" disabled={busy} label="Enable startup pipeline" onValueChange={sequencer.setStartupEnabled} value={startup.enabled} />
			<Checkbox className="col-span-6" disabled={busy || !startup.enabled} label="Continue on failure" onValueChange={sequencer.setStartupContinueOnFailure} value={startup.continueOnFailure} />
		</div>
	)
})

const Shutdown = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy } = useSnapshot(sequencer.state)
	const shutdown = useSnapshot(sequencer.state.request.shutdown)
	const blocked = busy || !shutdown.enabled

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy} label="Enable shutdown pipeline" onValueChange={sequencer.setShutdownEnabled} value={shutdown.enabled} />
			<Checkbox className="col-span-3" disabled={blocked} label="On completion" onValueChange={sequencer.setShutdownRunOnCompletion} value={shutdown.runOnCompletion} />
			<Checkbox className="col-span-3" disabled={blocked} label="On stop" onValueChange={sequencer.setShutdownRunOnStop} value={shutdown.runOnStop} />
			<Checkbox className="col-span-3" disabled={blocked} label="On failure" onValueChange={sequencer.setShutdownRunOnFailure} value={shutdown.runOnFailure} />
			<Checkbox className="col-span-3" disabled={blocked} label="Continue on failure" onValueChange={sequencer.setShutdownContinueOnFailure} value={shutdown.continueOnFailure} />
		</div>
	)
})

const Safety = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy } = useSnapshot(sequencer.state)
	const safety = useSnapshot(sequencer.state.request.safety)
	const blocked = busy || !safety.enabled
	const recoveryBlocked = blocked || !safety.recovery.enabled

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy} label="Enable safety" onValueChange={sequencer.setSafetyEnabled} value={safety.enabled} />
			<Checkbox className="col-span-6" disabled={blocked} label="Trigger on warning" onValueChange={sequencer.setSafetyTriggerOnWarning} value={safety.triggerOnWarning} />
			<Checkbox className="col-span-6" disabled={blocked} label="Abort current exposure" onValueChange={sequencer.setSafetyAbortCurrentExposure} value={safety.abortCurrentExposure} />
			<span className="col-span-full text-sm font-bold">RECOVERY:</span>
			<Switch className="col-span-4" disabled={blocked} label="Enabled" onValueChange={sequencer.setSafetyRecoveryEnabled} value={safety.recovery.enabled} />
			<Checkbox className="col-span-4" disabled={recoveryBlocked} label="Automatic" onValueChange={sequencer.setSafetyRecoveryAutomatic} value={safety.recovery.automatic} />
			<SequencerOnFailureSelect className="col-span-4" disabled={recoveryBlocked} onValueChange={sequencer.setSafetyRecoveryOnFailure} value={safety.recovery.onFailure} />
			<NumberInput className="col-span-4" disabled={recoveryBlocked} endContent="s" label="Stable for" minValue={0} onValueChange={sequencer.setSafetyRecoveryStableFor} value={safety.recovery.stableFor} />
			<NumberInput className="col-span-4" disabled={recoveryBlocked} endContent="s" label="Maximum wait" minValue={0} onValueChange={sequencer.setSafetyRecoveryMaximumWait} value={safety.recovery.maximumWait} />
			<Checkbox className="col-span-4" disabled={recoveryBlocked} label="Reconnect devices" onValueChange={sequencer.setSafetyRecoveryReconnectDevices} value={safety.recovery.reconnectDevices} />
			<Checkbox className="col-span-4" disabled={recoveryBlocked} label="Unpark mount" onValueChange={sequencer.setSafetyRecoveryUnparkMount} value={safety.recovery.unparkMount} />
			<Checkbox className="col-span-4" disabled={recoveryBlocked} label="Restore tracking" onValueChange={sequencer.setSafetyRecoveryRestoreTracking} value={safety.recovery.restoreTracking} />
			<Checkbox className="col-span-4" disabled={recoveryBlocked} label="Resume capture" onValueChange={sequencer.setSafetyRecoveryResumeCapture} value={safety.recovery.resumeCapture} />
			<div className="col-span-full flex items-center justify-between">
				<span className="text-sm font-bold">ACTIONS:</span>
				<Button color="success" disabled={blocked} label="Add action" onClick={sequencer.addSafetyAction} startContent={<Icons.Plus />} />
			</div>
			{safety.actions.map((action, index) => (
				<SafetyActionEditor disabled={blocked} index={index} key={action.id} />
			))}
		</div>
	)
})

const Quality = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy } = useSnapshot(sequencer.state)
	const quality = useSnapshot(sequencer.state.request.quality)
	const blocked = busy || !quality.enabled

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy} label="Enable quality gate" onValueChange={sequencer.setQualityEnabled} value={quality.enabled} />
			<StarDetectionSelect className="col-span-4" disabled={blocked} onValueChange={sequencer.setQualityStarDetectionType} value={quality.starDetection.type} />
			<TextInput className="col-span-8" disabled={blocked || quality.starDetection.type === 'nebulosa'} label="Executable" onValueChange={sequencer.setQualityStarDetectionExecutable} value={quality.starDetection.executable ?? ''} />
			<NumberInput className="col-span-4" disabled={blocked} endContent="s" label="Timeout" minValue={0} onValueChange={sequencer.setQualityStarDetectionTimeout} value={quality.starDetection.timeout} />
			<NumberInput className="col-span-4" disabled={blocked} label="Min SNR" minValue={0} onValueChange={sequencer.setQualityStarDetectionMinimumSNR} value={quality.starDetection.minimumSNR} />
			<NumberInput className="col-span-4" disabled={blocked} label="Max stars" minValue={0} onValueChange={sequencer.setQualityStarDetectionMaximumStars} value={quality.starDetection.maximumStars} />
			<NumberInput className="col-span-4" disabled={blocked} label="Evaluate every frames" minValue={1} onValueChange={sequencer.setQualityEvaluateEveryFrames} value={quality.evaluateEveryFrames} />
			<Checkbox className="col-span-8" disabled={blocked} label="Reject frame" onValueChange={sequencer.setQualityRejectFrame} value={quality.rejectFrame} />
			<NumberInput className="col-span-4" disabled={blocked} label="Min star count" minValue={0} onValueChange={sequencer.setQualityMinimumStarCount} value={quality.minimumStarCount ?? 0} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={1} label="Min SNR" minValue={0} onValueChange={sequencer.setQualityMinimumSNR} value={quality.minimumSNR ?? 0} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={2} label="Max HFD" minValue={0} onValueChange={sequencer.setQualityMaximumHFD} value={quality.maximumHFD ?? 0} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={2} label="Max FWHM" minValue={0} onValueChange={sequencer.setQualityMaximumFWHM} value={quality.maximumFWHM ?? 0} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={2} label="Max eccentricity" minValue={0} onValueChange={sequencer.setQualityMaximumEccentricity} value={quality.maximumEccentricity ?? 0} />
			<NumberInput className="col-span-4" disabled={blocked} label="Max background" minValue={0} onValueChange={sequencer.setQualityMaximumBackground} value={quality.maximumBackground ?? 0} />
			<NumberInput className="col-span-4" disabled={blocked} label="Max background variation" minValue={0} onValueChange={sequencer.setQualityMaximumBackgroundVariation} value={quality.maximumBackgroundVariation ?? 0} />
			<NumberInput className="col-span-4" disabled={blocked} fractionDigits={3} label="Max saturation" minValue={0} onValueChange={sequencer.setQualityMaximumSaturation} value={quality.maximumSaturation ?? 0} />
		</div>
	)
})

const Monitoring = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy } = useSnapshot(sequencer.state)
	const monitoring = useSnapshot(sequencer.state.request.monitoring)

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-6" disabled={busy} label="Enable monitoring" onValueChange={sequencer.setMonitoringEnabled} value={monitoring.enabled} />
			<NumberInput className="col-span-6" disabled={busy || !monitoring.enabled} endContent="s" label="Interval" minValue={1} onValueChange={sequencer.setMonitoringInterval} value={monitoring.interval} />
			<div className="col-span-full flex items-center justify-between">
				<span className="text-sm font-bold">MONITORS:</span>
				<Button color="success" disabled={busy || !monitoring.enabled} label="Add monitor" onClick={sequencer.addMonitor} startContent={<Icons.Plus />} />
			</div>
			{monitoring.monitors.map((monitor, index) => (
				<MonitorEditor disabled={busy || !monitoring.enabled} index={index} key={monitor.id} />
			))}
		</div>
	)
})

const Notification = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy } = useSnapshot(sequencer.state)
	const notification = useSnapshot(sequencer.state.request.notification)
	const blocked = busy || !notification.enabled
	const hasWeb = notification.channels.some((channel) => channel.type === 'web')
	const hasSystem = notification.channels.some((channel) => channel.type === 'system')
	const webhook = notification.channels.find((channel) => channel.type === 'webhook')

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2">
			<Switch className="col-span-full" disabled={busy} label="Enable notifications" onValueChange={sequencer.setNotificationEnabled} value={notification.enabled} />
			<SequencerNotificationSeveritySelect className="col-span-4" disabled={blocked} onValueChange={sequencer.setNotificationMinimumSeverity} value={notification.minimumSeverity} />
			<Checkbox className="col-span-2" disabled={blocked} label="Web" onValueChange={(value) => sequencer.setNotificationChannel('web', value)} value={hasWeb} />
			<Checkbox className="col-span-3" disabled={blocked} label="System" onValueChange={(value) => sequencer.setNotificationChannel('system', value)} value={hasSystem} />
			<Checkbox className="col-span-3" disabled={blocked} label="Webhook" onValueChange={sequencer.setNotificationWebhook} value={webhook !== undefined} />
			{webhook && webhook.type === 'webhook' && <TextInput className="col-span-full" disabled={blocked} label="Webhook URL" onValueChange={sequencer.setNotificationWebhookUrl} value={webhook.url} />}
			<SequencerNotificationEventSelect className="col-span-full" disabled={blocked} onValueChange={sequencer.setNotificationEvents} value={notification.events} />
		</div>
	)
})

const Footer = memo(() => {
	const sequencer = useContext(SequencerStoreContext)
	const { busy, camera, session, pendingCommand, preflight } = useSnapshot(sequencer.state)
	const paused = session?.state === 'paused'
	const running = session?.state === 'running'
	const pending = pendingCommand !== undefined
	const canStart = !busy && camera?.connected === true && !pending && preflight?.ok !== false

	return (
		<div className="mt-2 flex justify-end gap-2">
			<Button color="warning" disabled={!paused || pending} label="Resume" loading={pendingCommand === 'resume'} onClick={sequencer.resume} startContent={<Icons.Play />} />
			<Button color="secondary" disabled={!running || pending} label="Pause" loading={pendingCommand === 'pause'} onClick={sequencer.pause} startContent={<Icons.TimerPause />} />
			<Button color="danger" disabled={!busy || pending} label="Stop" loading={pendingCommand === 'stop'} onClick={sequencer.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={!canStart} label="Start" loading={pendingCommand === 'start'} onClick={sequencer.start} startContent={<Icons.Play />} />
		</div>
	)
})

function SequencerRetry({ retry, disabled }: { readonly retry: DeepWritable<SequencerRetryPolicy>; readonly disabled?: boolean }) {
	const sequencer = useContext(SequencerStoreContext)
	const value = useSnapshot(retry)

	return (
		<SequencerRetryPolicyPopover
			backoff={value.backoff}
			delay={value.delay}
			disabled={disabled}
			maxAttempts={value.maxAttempts}
			maximumDelay={value.maximumDelay}
			onBackoffChange={(next) => sequencer.updateRetry(retry, 'backoff', next)}
			onDelayChange={(next) => sequencer.updateRetry(retry, 'delay', next)}
			onMaxAttemptsChange={(next) => sequencer.updateRetry(retry, 'maxAttempts', next)}
			onMaximumDelayChange={(next) => sequencer.updateRetry(retry, 'maximumDelay', next)}
			onOnExhaustedChange={(next) => sequencer.updateRetry(retry, 'onExhausted', next)}
			onRetryOnChange={(next) => sequencer.updateRetry(retry, 'retryOn', next)}
			onExhausted={value.onExhausted}
			retryOn={value.retryOn}
		/>
	)
}

function CameraFields({ camera, disabled }: { readonly camera: DeepWritable<Partial<SequencerCamera>>; readonly disabled?: boolean }) {
	const sequencer = useContext(SequencerStoreContext)
	const { camera: device } = useSnapshot(sequencer.state)
	const value = useSnapshot(camera)
	const formats = device?.frameFormats ?? []

	return (
		<>
			<NumberInput disabled={disabled} label="Bin X" minValue={device?.bin.x.min ?? 1} maxValue={device?.bin.x.max ?? 1} onValueChange={(next) => sequencer.updateCamera(camera, 'binX', next)} value={value.binX} />
			<NumberInput disabled={disabled} label="Bin Y" minValue={device?.bin.y.min ?? 1} maxValue={device?.bin.y.max ?? 1} onValueChange={(next) => sequencer.updateCamera(camera, 'binY', next)} value={value.binY} />
			<NumberInput disabled={disabled} label="Gain" minValue={device?.gain.min ?? 0} maxValue={device?.gain.max ?? 0} onValueChange={(next) => sequencer.updateCamera(camera, 'gain', next)} value={value.gain} />
			<NumberInput disabled={disabled} label="Offset" minValue={device?.offset.min ?? 0} maxValue={device?.offset.max ?? 0} onValueChange={(next) => sequencer.updateCamera(camera, 'offset', next)} value={value.offset} />
			<Checkbox disabled={disabled} label="Subframe" onValueChange={(next) => sequencer.updateCamera(camera, 'subframe', next)} value={value.subframe} />
			<NumberInput disabled={disabled || !value.subframe} label="X" minValue={device?.frame.x.min ?? 0} maxValue={device?.frame.x.max ?? 0} onValueChange={(next) => sequencer.updateCamera(camera, 'x', next)} value={value.x} />
			<NumberInput disabled={disabled || !value.subframe} label="Y" minValue={device?.frame.y.min ?? 0} maxValue={device?.frame.y.max ?? 0} onValueChange={(next) => sequencer.updateCamera(camera, 'y', next)} value={value.y} />
			<NumberInput disabled={disabled || !value.subframe} label="Width" minValue={device?.frame.width.min ?? 0} maxValue={device?.frame.width.max ?? 0} onValueChange={(next) => sequencer.updateCamera(camera, 'width', next)} value={value.width} />
			<NumberInput disabled={disabled || !value.subframe} label="Height" minValue={device?.frame.height.min ?? 0} maxValue={device?.frame.height.max ?? 0} onValueChange={(next) => sequencer.updateCamera(camera, 'height', next)} value={value.height} />
			<FrameFormatSelect disabled={disabled || formats.length === 0} items={formats} onValueChange={(next) => sequencer.updateCamera(camera, 'frameFormat', next)} value={value.frameFormat} />
			<CameraTransferFormatSelect disabled={disabled} onValueChange={(next) => sequencer.updateCamera(camera, 'transferFormat', next)} value={value.transferFormat} />
			<Checkbox disabled={disabled} label="Compressed" onValueChange={(next) => sequencer.updateCamera(camera, 'compressed', next)} value={value.compressed} />
		</>
	)
}

interface AuxiliaryCaptureProps {
	readonly label?: React.ReactNode
	readonly capture: DeepWritable<SequencerAuxiliaryCapture>
	readonly disabled?: boolean
	readonly hideFilter?: boolean
}

function AuxiliaryCapture({ label = 'Capture', capture, disabled, hideFilter }: AuxiliaryCaptureProps) {
	const sequencer = useContext(SequencerStoreContext)
	const { wheel, camera } = useSnapshot(sequencer.state)
	const value = useSnapshot(capture)
	const blocked = disabled || !camera?.connected

	return (
		<Popover trigger={<Button color="secondary" disabled={blocked} label={label} startContent={<Icons.Cog />} />}>
			<div className="flex max-w-140 flex-row flex-wrap gap-2 p-2">
				<CameraExposureTimeInput
					disabled={blocked || capture.frameType === 'BIAS'}
					maxValue={camera?.exposure.max ?? 0}
					maxValueUnit="second"
					minValue={camera?.exposure.min ?? 0}
					minValueUnit="second"
					onUnitChange={(value) => (capture.exposureTimeUnit = value)}
					onValueChange={(value) => (capture.exposureTime = value)}
					unit={capture.exposureTimeUnit}
					value={capture.exposureTime}
				/>
				<FrameTypeSelect disabled={blocked} onValueChange={(next) => sequencer.updateAuxiliaryCapture(capture, 'frameType', next)} value={value.frameType} />
				{!hideFilter && wheel && 'filter' in capture && <FilterReferenceInput disabled={blocked} onValueChange={(next) => sequencer.updateAuxiliaryCapture(capture, 'filter', next)} value={'filter' in value ? value.filter : undefined} wheel={wheel} />}
				<CameraFields camera={capture} disabled={blocked} />
			</div>
		</Popover>
	)
}

function FilterReferenceItem(item: string) {
	return <span>{item || 'None'}</span>
}

function FilterReferenceInput({ value, wheel, disabled, onValueChange, className }: { readonly value?: SequencerFilterReference; readonly wheel?: Wheel; readonly disabled?: boolean; readonly onValueChange: (value: SequencerFilterReference | undefined) => void; readonly className?: string }) {
	const names = wheel?.names ?? []
	const current = value?.type === 'name' ? value.name : value?.type === 'position' ? (names[value.position] ?? '') : ''

	if (names.length > 0) {
		return (
			<Select className={className} disabled={disabled} items={['', ...names]} label="Filter" onValueChange={(next) => onValueChange(next ? { type: 'name', name: next } : undefined)} value={current}>
				{FilterReferenceItem}
			</Select>
		)
	}

	return <TextInput className={className} disabled={disabled} label="Filter" onValueChange={(next) => onValueChange(next ? { type: 'name', name: next } : undefined)} value={current} />
}

function GuiderSettle({ settle, disabled }: { readonly settle: DeepWritable<SequencerGuiderSettle>; readonly disabled?: boolean }) {
	const sequencer = useContext(SequencerStoreContext)
	const value = useSnapshot(settle)

	return (
		<>
			<NumberInput className="col-span-4" disabled={disabled} fractionDigits={1} label="Tolerance" minValue={0} onValueChange={(next) => sequencer.updateGuiderSettle(settle, 'tolerance', next)} value={value.tolerance} />
			<NumberInput className="col-span-4" disabled={disabled} endContent="s" label="Time" minValue={0} onValueChange={(next) => sequencer.updateGuiderSettle(settle, 'time', next)} value={value.time} />
			<NumberInput className="col-span-4" disabled={disabled} endContent="s" label="Timeout" minValue={0} onValueChange={(next) => sequencer.updateGuiderSettle(settle, 'timeout', next)} value={value.timeout} />
		</>
	)
}

function FilterOffsetEditor({ index, disabled }: { readonly index: number; readonly disabled?: boolean }) {
	const sequencer = useContext(SequencerStoreContext)
	const { wheel } = useSnapshot(sequencer.state)
	const item = useSnapshot(sequencer.state.request.autofocus.filterOffsets[index])

	if (!item) return null

	return (
		<div className="col-span-full grid grid-cols-12 items-center gap-2">
			<FilterReferenceInput className="col-span-7" disabled={disabled || !wheel} onValueChange={(value) => sequencer.updateFilterOffsetFilter(index, value)} value={item.filter} wheel={wheel} />
			<NumberInput className="col-span-4" disabled={disabled} label="Offset" onValueChange={(value) => sequencer.updateFilterOffset(index, value)} value={item.offset} />
			<IconButton color="danger" disabled={disabled} icon={Icons.Trash} onClick={() => sequencer.removeFilterOffset(index)} size="sm" tooltipContent="Remove" />
		</div>
	)
}

function FilterBrightnessEditor({ index, disabled }: { readonly index: number; readonly disabled?: boolean }) {
	const sequencer = useContext(SequencerStoreContext)
	const { wheel } = useSnapshot(sequencer.state)
	const item = useSnapshot(sequencer.state.request.flatPanel.brightnessByFilter[index])

	if (!item) return null

	return (
		<div className="col-span-full grid grid-cols-12 items-center gap-2">
			<FilterReferenceInput className="col-span-7" disabled={disabled || !wheel} onValueChange={(value) => sequencer.updateFilterBrightnessFilter(index, value)} value={item.filter} wheel={wheel} />
			<NumberInput className="col-span-4" disabled={disabled} label="Brightness" minValue={0} onValueChange={(value) => sequencer.updateFilterBrightness(index, value)} value={item.brightness} />
			<IconButton color="danger" disabled={disabled} icon={Icons.Trash} onClick={() => sequencer.removeFilterBrightness(index)} size="sm" tooltipContent="Remove" />
		</div>
	)
}

function MonitorEditor({ index, disabled }: { readonly index: number; readonly disabled?: boolean }) {
	const sequencer = useContext(SequencerStoreContext)
	const monitor = useSnapshot(sequencer.state.request.monitoring.monitors[index])
	const request = sequencer.state.request.monitoring.monitors[index]

	if (!monitor || !request) return null

	return (
		<div className="col-span-full grid grid-cols-12 items-center gap-2 rounded-lg bg-neutral-900/70 p-2">
			<Switch className="col-span-2" disabled={disabled} label="On" onValueChange={(value) => sequencer.setMonitorEnabled(index, value)} value={monitor.enabled} />
			<TextInput className="col-span-4" disabled={disabled || !monitor.enabled} label="Name" onValueChange={(value) => sequencer.setMonitorName(index, value)} value={monitor.name} />
			<SequencerMonitorTypeSelect className="col-span-3" disabled={disabled || !monitor.enabled} onValueChange={(value) => sequencer.setMonitorType(index, value)} value={monitor.type} />
			<IconButton color="danger" disabled={disabled} icon={Icons.Trash} onClick={() => sequencer.removeMonitor(index)} size="sm" tooltipContent="Remove" />
			<SequencerMonitorSeveritySelect className="col-span-3" disabled={disabled || !monitor.enabled} onValueChange={(value) => sequencer.setMonitorSeverity(index, value)} value={monitor.severity} />
			<NumberInput className="col-span-3" disabled={disabled || !monitor.enabled} endContent="s" label="Assert after" minValue={0} onValueChange={(value) => sequencer.setMonitorAssertAfter(index, value)} value={monitor.assertAfter} />
			<NumberInput className="col-span-3" disabled={disabled || !monitor.enabled} endContent="s" label="Clear after" minValue={0} onValueChange={(value) => sequencer.setMonitorClearAfter(index, value)} value={monitor.clearAfter} />
			<NumberInput className="col-span-3" disabled={disabled || !monitor.enabled} endContent="s" label="Stale after" minValue={0} onValueChange={(value) => sequencer.setMonitorStaleAfter(index, value)} value={monitor.staleAfter} />
			{monitor.type === 'rain' && request.type === 'rain' && <Checkbox className="col-span-4" disabled={disabled || !monitor.enabled} label="Wet is unsafe" onValueChange={(value) => sequencer.setMonitorWetIsUnsafe(index, value)} value={monitor.wetIsUnsafe} />}
			{monitor.type === 'wind' && request.type === 'wind' && (
				<>
					<NumberInput className="col-span-4" disabled={disabled || !monitor.enabled} fractionDigits={1} label="Max speed" minValue={0} onValueChange={(value) => sequencer.setMonitorMaximumSpeed(index, value)} value={monitor.maximumSpeed} />
					<NumberInput className="col-span-4" disabled={disabled || !monitor.enabled} fractionDigits={1} label="Max gust" minValue={0} onValueChange={(value) => sequencer.setMonitorMaximumGust(index, value)} value={monitor.maximumGust} />
				</>
			)}
			{monitor.type === 'humidity' && request.type === 'humidity' && <NumberInput className="col-span-4" disabled={disabled || !monitor.enabled} label="Max humidity" minValue={0} onValueChange={(value) => sequencer.setMonitorMaximumHumidity(index, value)} value={monitor.maximumHumidity} />}
			{monitor.type === 'dewPoint' && request.type === 'dewPoint' && <NumberInput className="col-span-4" disabled={disabled || !monitor.enabled} fractionDigits={1} label="Min difference" onValueChange={(value) => sequencer.setMonitorMinimumDifference(index, value)} value={monitor.minimumDifference} />}
			{monitor.type === 'cloud' && request.type === 'cloud' && <NumberInput className="col-span-4" disabled={disabled || !monitor.enabled} label="Max cloud cover" minValue={0} onValueChange={(value) => sequencer.setMonitorMaximumCloudCover(index, value)} value={monitor.maximumCloudCover} />}
			{monitor.type === 'device' && request.type === 'device' && (
				<>
					<SequencerDeviceRoleSelect className="col-span-full" disabled={disabled || !monitor.enabled} onValueChange={(value) => sequencer.setMonitorDevices(index, value)} value={monitor.devices} />
					<Checkbox className="col-span-4" disabled={disabled || !monitor.enabled} label="Require connected" onValueChange={(value) => sequencer.setMonitorRequireConnected(index, value)} value={monitor.requireConnected} />
					<Checkbox className="col-span-4" disabled={disabled || !monitor.enabled} label="Require available" onValueChange={(value) => sequencer.setMonitorRequireAvailable(index, value)} value={monitor.requireAvailable} />
					<Checkbox className="col-span-4" disabled={disabled || !monitor.enabled} label="Require quiescent" onValueChange={(value) => sequencer.setMonitorRequireQuiescent(index, value)} value={monitor.requireQuiescent} />
				</>
			)}
			{monitor.type === 'storage' && request.type === 'storage' && (
				<>
					<FilePickerInput disabled={disabled || !monitor.enabled} label="Path" mode="directory" onValueChange={(value) => sequencer.setMonitorPath(index, value)} value={monitor.path ?? ''} />
					<NumberInput className="col-span-6" disabled={disabled || !monitor.enabled} label="Min free space" minValue={0} onValueChange={(value) => sequencer.setMonitorMinimumFreeSpace(index, value)} value={monitor.minimumFreeSpace} />
					<Checkbox className="col-span-6" disabled={disabled || !monitor.enabled} label="Require writable" onValueChange={(value) => sequencer.setMonitorRequireWritable(index, value)} value={monitor.requireWritable} />
				</>
			)}
			{monitor.type === 'power' && request.type === 'power' && (
				<>
					<TextInput className="col-span-4" disabled={disabled || !monitor.enabled} label="Source" onValueChange={(value) => sequencer.setMonitorSource(index, value)} value={monitor.source ?? ''} />
					<NumberInput className="col-span-4" disabled={disabled || !monitor.enabled} label="Min battery" minValue={0} onValueChange={(value) => sequencer.setMonitorMinimumBatteryLevel(index, value)} value={monitor.minimumBatteryLevel} />
					<Checkbox className="col-span-4" disabled={disabled || !monitor.enabled} label="Require external power" onValueChange={(value) => sequencer.setMonitorRequireExternalPower(index, value)} value={monitor.requireExternalPower} />
				</>
			)}
			{monitor.type === 'guiding' && request.type === 'guiding' && (
				<>
					<Switch className="col-span-4" disabled={disabled || !monitor.enabled} label="Thresholds" onValueChange={(value) => sequencer.setMonitorThresholdsEnabled(index, value)} value={monitor.thresholds.enabled} />
					<Checkbox className="col-span-8" disabled={disabled || !monitor.enabled || !monitor.thresholds.enabled} label="Pause capture when exceeded" onValueChange={(value) => sequencer.setMonitorThresholdsPauseCaptureWhenExceeded(index, value)} value={monitor.thresholds.pauseCaptureWhenExceeded} />
					<NumberInput className="col-span-4" disabled={disabled || !monitor.enabled || !monitor.thresholds.enabled} fractionDigits={2} label="Max RMS" minValue={0} onValueChange={(value) => sequencer.setMonitorThresholdsMaximumRMS(index, value)} value={monitor.thresholds.maximumRMS ?? 0} />
					<NumberInput
						className="col-span-4"
						disabled={disabled || !monitor.enabled || !monitor.thresholds.enabled}
						fractionDigits={2}
						label="Max RA RMS"
						minValue={0}
						onValueChange={(value) => sequencer.setMonitorThresholdsMaximumRightAscensionRMS(index, value)}
						value={monitor.thresholds.maximumRightAscensionRMS}
					/>
					<NumberInput
						className="col-span-4"
						disabled={disabled || !monitor.enabled || !monitor.thresholds.enabled}
						fractionDigits={2}
						label="Max DEC RMS"
						minValue={0}
						onValueChange={(value) => sequencer.setMonitorThresholdsMaximumDeclinationRMS(index, value)}
						value={monitor.thresholds.maximumDeclinationRMS}
					/>
				</>
			)}
			{monitor.type === 'mountLimit' && request.type === 'mountLimit' && (
				<>
					<AngleInput className="col-span-3" disabled={disabled || !monitor.enabled} label="Min altitude" maxValue={90} minValue={-90} onValueChange={(value) => sequencer.setMonitorMinimumAltitude(index, value)} value={monitor.minimumAltitude ?? 0} />
					<AngleInput className="col-span-3" disabled={disabled || !monitor.enabled} label="Max altitude" maxValue={90} minValue={-90} onValueChange={(value) => sequencer.setMonitorMaximumAltitude(index, value)} value={monitor.maximumAltitude ?? 0} />
					<HourAngleMinutesInput className="col-span-3" disabled={disabled || !monitor.enabled} label="Min hour angle" onValueChange={(value) => sequencer.setMonitorMinimumHourAngle(index, value)} value={monitor.minimumHourAngle ?? 0} />
					<HourAngleMinutesInput className="col-span-3" disabled={disabled || !monitor.enabled} label="Max hour angle" onValueChange={(value) => sequencer.setMonitorMaximumHourAngle(index, value)} value={monitor.maximumHourAngle ?? 0} />
				</>
			)}
			{monitor.type === 'heartbeat' && request.type === 'heartbeat' && (
				<>
					<TextInput className="col-span-8" disabled={disabled || !monitor.enabled} label="Source" onValueChange={(value) => sequencer.setMonitorSource(index, value)} value={monitor.source} />
					<NumberInput className="col-span-4" disabled={disabled || !monitor.enabled} endContent="s" label="Timeout" minValue={0} onValueChange={(value) => sequencer.setMonitorTimeout(index, value)} value={monitor.timeout} />
				</>
			)}
			{monitor.type === 'custom' && request.type === 'custom' && <TextInput className="col-span-full" disabled={disabled || !monitor.enabled} label="Provider" onValueChange={(value) => sequencer.setMonitorProvider(index, value)} value={monitor.provider} />}
		</div>
	)
}

function SafetyActionEditor({ index, disabled }: { readonly index: number; readonly disabled?: boolean }) {
	const sequencer = useContext(SequencerStoreContext)
	const action = useSnapshot(sequencer.state.request.safety.actions[index])
	const request = sequencer.state.request.safety.actions[index]

	if (!action || !request) return null

	return (
		<div className="col-span-full grid grid-cols-12 items-center gap-2 rounded-lg bg-neutral-900/70 p-2">
			<Switch className="col-span-2" disabled={disabled} label="On" onValueChange={(value) => sequencer.setSafetyActionEnabled(index, value)} value={action.enabled} />
			<SequencerSafetyActionTypeSelect className="col-span-4" disabled={disabled || !action.enabled} onValueChange={(value) => sequencer.setSafetyActionType(index, value)} value={action.type} />
			<NumberInput className="col-span-3" disabled={disabled || !action.enabled} endContent="s" label="Timeout" minValue={0} onValueChange={(value) => sequencer.setSafetyActionTimeout(index, value)} value={action.timeout} />
			<Checkbox className="col-span-2" disabled={disabled || !action.enabled} label="Continue on failure" onValueChange={(value) => sequencer.setSafetyActionContinueOnFailure(index, value)} value={action.continueOnFailure} />
			<IconButton color="danger" disabled={disabled} icon={Icons.Trash} onClick={() => sequencer.removeSafetyAction(index)} size="sm" tooltipContent="Remove" />
			{action.type === 'switch' && request.type === 'switch' && (
				<>
					<TextInput className="col-span-4" disabled={disabled || !action.enabled} label="Device" onValueChange={(value) => sequencer.setSafetyActionDevice(index, value)} value={action.device} />
					<TextInput className="col-span-4" disabled={disabled || !action.enabled} label="Switch" onValueChange={(value) => sequencer.setSafetyActionSwitch(index, value)} value={action.switch} />
					<TextInput className="col-span-4" disabled={disabled || !action.enabled} label="Value" onValueChange={(value) => sequencer.setSafetyActionValue(index, value)} value={String(action.value)} />
				</>
			)}
			{action.type === 'custom' && request.type === 'custom' && <TextInput className="col-span-full" disabled={disabled || !action.enabled} label="Handler" onValueChange={(value) => sequencer.setSafetyActionHandler(index, value)} value={action.handler} />}
			<div className="col-span-full">
				<SequencerRetry retry={request.retry} disabled={disabled || !action.enabled} />
			</div>
		</div>
	)
}

function AngleInput({ value, onValueChange, unit = 'deg', ...props }: Omit<React.ComponentProps<typeof NumberInput>, 'value' | 'onValueChange' | 'endContent'> & { readonly value: number; readonly onValueChange: (value: number) => void; readonly unit?: 'deg' | 'arcsec' }) {
	const factor = unit === 'arcsec' ? RAD2DEG * 3600 : RAD2DEG
	return <NumberInput endContent={unit === 'arcsec' ? '"' : '°'} onValueChange={(next) => onValueChange(next / factor)} value={value * factor} {...props} />
}

function HourAngleMinutesInput({ value, onValueChange, ...props }: Omit<React.ComponentProps<typeof NumberInput>, 'value' | 'onValueChange' | 'endContent'> & { readonly value: number; readonly onValueChange: (value: number) => void }) {
	return <NumberInput endContent="min" fractionDigits={1} onValueChange={(next) => onValueChange(next * HA_MINUTE)} value={value / HA_MINUTE} {...props} />
}

function OptionalDateTimeInput({ value, onValueChange, disabled, label, className }: { readonly value?: number; readonly onValueChange: (value: number | undefined) => void; readonly disabled?: boolean; readonly label: string; readonly className?: string }) {
	return <DateTimeInput className={className} disabled={disabled} granularity="second" label={label} onValueChange={(next) => onValueChange(fromPlainDateTime(next))} value={value === undefined ? undefined : toPlainDateTime(value)} />
}

function toPlainDateTime(utc: number) {
	return Temporal.Instant.fromEpochMilliseconds(utc).toZonedDateTimeISO('UTC').toPlainDateTime()
}

function fromPlainDateTime(value: Temporal.PlainDateTime) {
	return value.toZonedDateTime('UTC').toInstant().epochMilliseconds
}
