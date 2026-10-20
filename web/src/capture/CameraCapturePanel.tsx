import type { CameraCapabilities, CaptureFrame, CaptureOutputMode, CaptureRequest, CaptureSession } from 'api'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { roleAvailability } from '../equipment/availability'
import { useRoleDevice } from '../equipment/useEquipment'
import { FileExplorerModal } from '../files/FileExplorerModal'
import { operationsState } from '../operations'
import { acquisitionSettings, activeProfile, type CameraAcquisitionSettings, profileState, setAcquisitionSettings } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { IconButton } from '../ui/IconButton'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { abortCapture, cameraKey, captureCount, captureElapsed, captureRequest, captureRuntime, captureRunning, captureStatus, FILE_STATE_LABELS, fileState, FRAME_STATE_LABELS, type FrameState, frameState, refreshCapabilities, startCapture, stopCapture } from './capture'
import { DecimalInput } from './DecimalInput'
import type { CaptureModePanelProps } from './modes'

// Contextual panel sections of the Camera Capture mode: the exposure, the acquisition mode with its start
// and stop commands, the state of the running or last capture, the less frequent camera settings, the
// output with a server directory chooser, and the latest frame, whose own state and file state are shown
// apart from the outcome of the capture that took it. The form is the camera view's, kept in the profile;
// the capture it starts is the server's, run on the device the view's role resolves to when it starts, and
// shown here from the server state whichever tab started it. Controls that would change a running capture
// are disabled; a control the camera does not support is not shown, and the values sent are fitted to the
// camera's reported capabilities.

// Acquisition modes, in display order.
const EXPOSURE_MODES: readonly CaptureRequest['exposureMode'][] = ['single', 'fixed', 'loop']

// Label of each acquisition mode.
const EXPOSURE_MODE_LABELS: Readonly<Record<CaptureRequest['exposureMode'], string>> = { single: 'Single', fixed: 'Fixed', loop: 'Loop' }

// Label of the start command of each acquisition mode.
const START_LABELS: Readonly<Record<CaptureRequest['exposureMode'], string>> = { single: 'Capture', fixed: 'Start Sequence', loop: 'Start Loop' }

// Frame types, in display order.
const FRAME_TYPES: readonly CaptureRequest['frameType'][] = ['LIGHT', 'DARK', 'FLAT', 'BIAS']

// Output modes, in display order.
const OUTPUT_MODES: readonly CaptureOutputMode[] = ['preview-save', 'preview-only']

// Label of each output mode.
const OUTPUT_MODE_LABELS: Readonly<Record<CaptureOutputMode, string>> = { 'preview-save': 'Preview + Save', 'preview-only': 'Preview Only' }

// Largest frame count of a fixed capture.
const MAX_FRAME_COUNT = 100000

// Camera Capture panel sections.
export function CameraCapturePanel({ camera: role }: CaptureModePanelProps) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(captureRuntime)
	const operations = useSnapshot(operationsState)
	const target = useRoleDevice(role)
	const settings = acquisitionSettings(activeProfile(profiles).settings.capture, role)
	const { device } = target
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const capabilities = key ? runtime.capabilities[key] : undefined
	const frame = key ? runtime.frames[key] : undefined
	const running = captureRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const availability = roleAvailability(role, target, operations)
	const locked = running || pending
	const [choosingDirectory, setChoosingDirectory] = useState(false)

	useEffect(() => {
		if (device?.connected) void refreshCapabilities(captureRuntime, device.connectionId, device.id)
	}, [device?.connectionId, device?.id, device?.connected])

	// Updates fields of the view's form.
	function update(patch: Partial<CameraAcquisitionSettings>) {
		setAcquisitionSettings(profileState, role, patch)
	}

	// Updates fields of the view's output.
	function updateOutput(patch: Partial<CameraAcquisitionSettings['output']>) {
		update({ output: { ...settings.output, ...patch } })
	}

	function start() {
		if (device) void startCapture(captureRuntime, device.connectionId, device.id, captureRequest(settings, capabilities))
	}

	const xisf = capabilities?.transferFormats.includes('XISF') === true

	return (
		<>
			<PanelSection title="Exposure">
				<DecimalInput label="Exposure Time" suffix="s" value={settings.exposureTime} min={0} exclusiveMin disabled={locked} onChange={(exposureTime) => update({ exposureTime })} />
				{capabilities?.exposure && (
					<p className="m-0 text-xs leading-4 text-ink-300">
						{formatSeconds(capabilities.exposure.min)} – {formatSeconds(capabilities.exposure.max)} s supported by the camera.
					</p>
				)}
				<Select label="Frame Type" options={FRAME_TYPES} value={settings.frameType} disabled={locked} onChange={(frameType) => update({ frameType })} />
			</PanelSection>
			<PanelSection title="Acquisition">
				<SegmentedControl label="Mode" options={EXPOSURE_MODES} value={settings.exposureMode} format={(mode) => EXPOSURE_MODE_LABELS[mode]} disabled={locked} onChange={(exposureMode) => update({ exposureMode })} />
				{settings.exposureMode === 'fixed' && <NumberInput label="Frame Count" value={settings.count} min={1} max={MAX_FRAME_COUNT} disabled={locked} onChange={(count) => update({ count })} />}
				{settings.exposureMode !== 'single' && (
					<>
						<NumberInput label="Delay" suffix="s" value={settings.delay} min={0} disabled={locked} onChange={(delay) => update({ delay })} />
						<p className="m-0 text-xs leading-4 text-ink-300">Wait after each capture before starting the next one.</p>
					</>
				)}
				<CaptureCommands
					session={session}
					capabilities={capabilities}
					mode={settings.exposureMode}
					pending={pending}
					startable={availability.status === 'ready' && device !== undefined}
					onStart={start}
					onStop={() => device && void stopCapture(captureRuntime, device.connectionId, device.id)}
					onAbort={() => device && void abortCapture(captureRuntime, device.connectionId, device.id)}
				/>
				{availability.status !== 'ready' && !running && <p className="m-0 text-xs leading-4 text-ink-300">{availability.message}</p>}
				{error && <p className="m-0 text-xs leading-4 text-danger">{error}</p>}
			</PanelSection>
			{session && <CaptureState session={session} />}
			<CameraSettings settings={settings} capabilities={capabilities} disabled={locked} onChange={update} />
			<PanelSection title="Output">
				<SegmentedControl options={OUTPUT_MODES} value={settings.output.mode} format={(mode) => OUTPUT_MODE_LABELS[mode]} disabled={locked} onChange={(mode) => updateOutput({ mode })} />
				{settings.output.mode === 'preview-save' && (
					<>
						<div className="flex items-end gap-1">
							<TextInput label="Server Directory" className="flex-1" placeholder="~/Nebulosa/captures" value={settings.output.directory ?? ''} disabled={locked} onChange={(e) => updateOutput({ directory: e.target.value.trim() || undefined })} />
							<IconButton icon="folder" label="Choose directory" className="size-[38px]" disabled={locked} onClick={() => setChoosingDirectory(true)} />
						</div>
						<TextInput label="Filename Template" placeholder="{date}_{time}_{camera}_{type}_{seq}" value={settings.output.filenameTemplate ?? ''} disabled={locked} onChange={(e) => updateOutput({ filenameTemplate: e.target.value || undefined })} />
						<p className="m-0 text-xs leading-4 text-ink-300">{'{camera} {type} {date} {time} {seq}'}; existing files are never replaced.</p>
						<Select label="Format" options={xisf ? (['FITS', 'XISF'] as const) : (['FITS'] as const)} value={xisf ? settings.output.format : 'FITS'} disabled={locked} onChange={(format) => updateOutput({ format })} />
					</>
				)}
				{settings.output.mode === 'preview-only' && <p className="m-0 text-xs leading-4 text-ink-300">Frames are kept in memory for viewing only; nothing is written.</p>}
			</PanelSection>
			{frame && <LastFrame frame={frame} state={frameState(frame, key ? runtime.renderings[key] : undefined, key ? runtime.renderErrors[key] : undefined, session?.previewError)} />}
			<FileExplorerModal
				open={choosingDirectory}
				mode="directory"
				title="Capture Directory"
				initialPath={settings.output.directory}
				onClose={() => setChoosingDirectory(false)}
				onChoose={(directory) => {
					setChoosingDirectory(false)
					updateOutput({ directory })
				}}
			/>
		</>
	)
}

interface CaptureCommandsProps {
	// Latest session of the camera, running or ended.
	readonly session?: CaptureSession
	// Capabilities of the camera, when known.
	readonly capabilities?: CameraCapabilities
	// Acquisition mode of the form.
	readonly mode: CaptureRequest['exposureMode']
	// Whether a command of this tab is waiting for the server.
	readonly pending: boolean
	// Whether the camera is ready for a new capture.
	readonly startable: boolean
	readonly onStart: () => void
	readonly onStop: () => void
	readonly onAbort: () => void
}

// Start command of the form's mode while the camera is idle; Stop, and Abort when the driver can abort,
// while it captures.
function CaptureCommands({ session, capabilities, mode, pending, startable, onStart, onStop, onAbort }: CaptureCommandsProps) {
	if (!captureRunning(session)) {
		return (
			<Button disabled={!startable || pending} onClick={onStart}>
				{START_LABELS[mode]}
			</Button>
		)
	}

	return (
		<div className="flex gap-2">
			<Button className="flex-1" variant="secondary" disabled={pending || session!.stopping} onClick={onStop}>
				{session!.stopping ? 'Stopping…' : 'Stop'}
			</Button>
			{capabilities?.canAbort && (
				<Button className="flex-1" variant="secondary" disabled={pending} onClick={onAbort}>
					Abort
				</Button>
			)}
		</div>
	)
}

// Formats a duration in seconds without float noise, such as 0.0001 or 3600.
function formatSeconds(value: number) {
	return String(Number(value.toPrecision(6)))
}

interface CaptureStateProps {
	// Session shown.
	readonly session: CaptureSession
}

// State of the camera's latest capture: what it does, its progress, and its counts. Once the capture ended
// it is titled as the last acquisition, so its counts are not read as the form's.
function CaptureState({ session }: CaptureStateProps) {
	const running = captureRunning(session)
	const [now, setNow] = useState(Date.now)

	// Only the elapsed time is refreshed here; the capture itself runs on the server.
	useEffect(() => {
		if (!running) return
		const timer = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(timer)
	}, [running])

	const progress = session.phase === 'exposing' ? session.exposure?.progress : session.phase === 'waiting' ? session.delay?.progress : undefined
	const failed = session.phase === 'failed' || session.phase === 'aborted'

	return (
		<PanelSection title={running ? 'Acquisition Status' : 'Last Acquisition'}>
			<p className={failed ? 'm-0 text-danger' : 'm-0 text-ink-100'}>{captureStatus(session)}</p>
			{running && <div className="h-1 overflow-hidden rounded-full bg-base-300">{progress === undefined ? <div className="h-full w-1/3 animate-pulse bg-accent/60" /> : <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.min(100, progress)}%` }} />}</div>}
			<dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1">
				<dt className="text-ink-300">{captureCount(session)}</dt>
				<dd className="m-0 text-right tabular-nums">{session.request.output.mode === 'preview-save' ? `Saved ${session.saved}` : 'Not Saved'}</dd>
				<dt className="text-ink-300">Elapsed</dt>
				<dd className="m-0 text-right tabular-nums">{formatElapsed(captureElapsed(session, now))}</dd>
			</dl>
			{session.phase === 'failed' && session.captured > 0 && (
				<p className="m-0 text-xs leading-4 text-ink-300">
					The capture did not complete: {session.captured} frames taken, {session.saved} saved.
				</p>
			)}
			{session.previewError && <p className="m-0 text-xs leading-4 text-danger">{session.previewError}</p>}
		</PanelSection>
	)
}

// Formats an elapsed time in seconds as m:ss, or h:mm:ss from one hour.
function formatElapsed(seconds: number) {
	const total = Math.floor(seconds)
	const s = String(total % 60).padStart(2, '0')
	const m = Math.floor(total / 60) % 60
	const h = Math.floor(total / 3600)
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

interface CameraSettingsProps {
	// Form of the view.
	readonly settings: Readonly<CameraAcquisitionSettings>
	// Capabilities of the camera, when known.
	readonly capabilities?: CameraCapabilities
	// Whether a running capture locks the controls.
	readonly disabled: boolean
	// Updates fields of the form.
	readonly onChange: (patch: Partial<CameraAcquisitionSettings>) => void
}

// Settings changed less often, collapsed by default: gain, offset, binning, readout mode, and subframe, each
// only when the camera reports it, and the sensor temperature and cooler state.
function CameraSettings({ settings, capabilities, disabled, onChange }: CameraSettingsProps) {
	const [open, setOpen] = useState(false)

	if (!capabilities) {
		return (
			<PanelSection title="Camera">
				<p className="m-0 text-ink-300">Camera settings appear once the camera reports them.</p>
			</PanelSection>
		)
	}

	const { gain, offset, bin, subframe, frameFormats, temperature, cooler } = capabilities
	const formats = frameFormats.map((format) => format.name)

	return (
		<PanelSection title="Camera">
			{(temperature !== undefined || cooler) && (
				<p className="m-0 tabular-nums">
					{temperature !== undefined && `Sensor ${temperature.toFixed(1)} °C`}
					{temperature !== undefined && cooler && ' · '}
					{cooler && `Cooler ${cooler.enabled === false ? 'off' : `${Math.round(cooler.power)} %`}`}
				</p>
			)}
			<Button variant="ghost" className="self-start px-1" onClick={() => setOpen(!open)}>
				{open ? 'Hide settings' : 'Show settings'}
			</Button>
			{open && (
				<>
					{gain && <NumberInput label="Gain" value={Math.min(gain.max, Math.max(gain.min, settings.gain))} min={gain.min} max={gain.max} disabled={disabled} onChange={(value) => onChange({ gain: value })} />}
					{offset && <NumberInput label="Offset" value={Math.min(offset.max, Math.max(offset.min, settings.offset))} min={offset.min} max={offset.max} disabled={disabled} onChange={(value) => onChange({ offset: value })} />}
					{bin && <NumberInput label="Binning" value={Math.min(bin.x, settings.binX)} min={1} max={Math.min(bin.x, bin.y)} disabled={disabled} onChange={(value) => onChange({ binX: value, binY: value })} />}
					{formats.length > 0 && (
						<Select
							label="Readout Mode"
							options={formats}
							value={formats.includes(settings.frameFormat) ? settings.frameFormat : capabilities.frameFormat || formats[0]}
							format={(name) => frameFormats.find((format) => format.name === name)?.label || name}
							disabled={disabled}
							onChange={(frameFormat) => onChange({ frameFormat })}
						/>
					)}
					{subframe && (
						<>
							<Checkbox label="Subframe (ROI)" checked={settings.subframe} disabled={disabled} onChange={(checked) => onChange({ subframe: checked, ...(checked && settings.width <= 0 && { x: 0, y: 0, width: subframe.width, height: subframe.height }) })} />
							{settings.subframe && (
								<div className="grid grid-cols-2 gap-2">
									<NumberInput label="X" value={settings.x} min={0} max={subframe.width - 1} disabled={disabled} onChange={(x) => onChange({ x })} />
									<NumberInput label="Y" value={settings.y} min={0} max={subframe.height - 1} disabled={disabled} onChange={(y) => onChange({ y })} />
									<NumberInput label="Width" value={settings.width} min={1} max={subframe.width} disabled={disabled} onChange={(width) => onChange({ width })} />
									<NumberInput label="Height" value={settings.height} min={1} max={subframe.height} disabled={disabled} onChange={(height) => onChange({ height })} />
								</div>
							)}
						</>
					)}
					{!gain && !offset && !bin && formats.length === 0 && !subframe && <p className="m-0 text-ink-300">The camera reports no adjustable settings.</p>}
				</>
			)}
		</PanelSection>
	)
}

interface LastFrameProps {
	// Latest previewed frame of the camera.
	readonly frame: CaptureFrame
	// State of the frame in this tab.
	readonly state: FrameState
}

// State and metadata of the camera's latest frame, as its header and the capture report them; a datum the
// frame does not carry is not shown. The frame and its file keep their own states whatever the outcome of
// the capture, so the last frame of an aborted capture is still shown as ready and saved.
function LastFrame({ frame, state }: LastFrameProps) {
	const { acquisition } = frame
	const file = fileState(frame)
	const rows: [string, string, boolean?][] = [
		['Frame', `#${frame.generation} · ${frame.frameType}`],
		['State', FRAME_STATE_LABELS[state], state === 'error'],
		['File', FILE_STATE_LABELS[file], file === 'failed'],
		['Dimensions', `${frame.width} × ${frame.height}${frame.channels === 3 ? ' RGB' : frame.cfa ? ` ${frame.cfa}` : ''}`],
	]

	if (acquisition.camera) rows.push(['Camera', acquisition.camera])
	if (acquisition.exposure !== undefined) rows.push(['Exposure', `${formatSeconds(acquisition.exposure)} s`])
	if (acquisition.gain !== undefined) rows.push(['Gain', String(acquisition.gain)])
	if (acquisition.offset !== undefined) rows.push(['Offset', String(acquisition.offset)])
	if (acquisition.binning) rows.push(['Binning', `${acquisition.binning.x} × ${acquisition.binning.y}`])
	if (frame.bitpix !== undefined) rows.push(['Bit Depth', frame.bitpix < 0 ? `${-frame.bitpix}-bit float` : `${frame.bitpix}-bit`])
	if (acquisition.temperature !== undefined) rows.push(['Temperature', `${acquisition.temperature.toFixed(1)} °C`])
	rows.push(['Acquired', new Date(frame.time).toLocaleTimeString()])

	return (
		<PanelSection title="Last Frame">
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				{rows.map(([label, value, danger]) => (
					<div key={label} className="contents">
						<dt className="text-ink-300">{label}</dt>
						<dd className={cn('m-0 min-w-0 truncate text-right tabular-nums', danger && 'text-danger')}>{value}</dd>
					</div>
				))}
			</dl>
			{frame.path && (
				<p className="m-0 truncate font-mono text-xs leading-4 text-ink-300" title={frame.path}>
					{frame.path}
				</p>
			)}
		</PanelSection>
	)
}
