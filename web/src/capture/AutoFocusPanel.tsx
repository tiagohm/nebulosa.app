import type { AutoFocusSessionSummary } from 'api'
import { cn } from 'cn'
import { type ReactNode, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, deviceStateOf } from '../equipment-control/control'
import { Notice } from '../equipment-control/parts'
import { roleAvailability } from '../equipment/availability'
import { useRoleDevice } from '../equipment/useEquipment'
import { operationsState } from '../operations'
import { activeProfile, AUTO_FOCUS_APERTURE, type AutoFocusSettings, autoFocusSettings, profileState, setAutoFocusSettings } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { AcceptanceControls, DetectorControls, DetectorSettingsControls, useAstapConfigured } from '../stars/StarRequestControls'
import { PROVIDER_LABELS } from '../stars/stars'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { AUTO_FOCUS_STATE_LABELS, autoFocusRequest, autoFocusRunning, autoFocusRuntime, defaultStepSize, FITTING_MODE_LABELS, FITTING_MODES, startAutoFocus, stopAutoFocus, VERIFICATION_LABELS } from './autofocus'
import { cameraKey, captureRuntime, refreshCapabilities } from './capture'
import { ExposureTimeInput } from './ExposureTimeInput'
import type { CaptureModePanelProps } from './modes'

// Contextual panel sections of the Auto Focus mode: how each frame is measured (exposure, camera settings, the
// star detector with its grown aperture, the star overlay), the routine the server's runner follows (fitting,
// step size, positions per side, and the advanced settings collapsed), and the state of the running or last
// session with its Run and Stop commands. The camera is the view's and the focuser the one the equipment setup
// assigns; the filter wheel, when assigned, is shown and never moved. The form is the view's, kept in the
// profile apart from the Camera Capture form; the session is the server's, shown here from the server state
// whichever tab started it, and keeps running when the panel unmounts.

// Auto Focus panel sections.
export function AutoFocusPanel({ camera: role }: CaptureModePanelProps) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(autoFocusRuntime)
	const captures = useSnapshot(captureRuntime)
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const camera = useRoleDevice(role)
	const focuser = useRoleDevice('FOCUSER')
	const wheel = useRoleDevice('FILTER_WHEEL')
	const astapConfigured = useAstapConfigured()
	const settings = autoFocusSettings(activeProfile(profiles).settings.capture, role)
	const key = camera.device && cameraKey(camera.device.connectionId, camera.device.id)
	const session = key ? runtime.sessions[key] : undefined
	const capabilities = key ? captures.capabilities[key] : undefined
	const focuserState = focuser.device && deviceStateOf(control.states, 'focuser', focuser.device.id)
	const wheelState = wheel.device && deviceStateOf(control.states, 'wheel', wheel.device.id)
	const running = autoFocusRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const locked = running || pending
	const stepSize = settings.stepSize ?? (focuserState ? defaultStepSize(focuserState.position.min, focuserState.position.max) : 100)
	const blocker = running ? undefined : startBlocker()

	useEffect(() => {
		if (camera.device?.connected) void refreshCapabilities(captureRuntime, camera.device.connectionId, camera.device.id)
	}, [camera.device?.connectionId, camera.device?.id, camera.device?.connected])

	// Returns why no session can start now, from the availability of both devices, the capabilities of the
	// focuser, and the detector; the server checks again.
	function startBlocker(): string | undefined {
		const cameraAvailability = roleAvailability(role, camera, operations)
		if (cameraAvailability.status !== 'ready') return cameraAvailability.message
		const focuserAvailability = roleAvailability('FOCUSER', focuser, operations)
		if (focuserAvailability.status !== 'ready') return focuserAvailability.message
		if (!focuserState) return 'The focuser state is not known yet.'
		if (!focuserState.canAbsoluteMove) return 'The focuser cannot move to absolute positions, which the Auto Focus needs.'
		if (settings.detection.detector.provider === 'astap' && !astapConfigured) return 'ASTAP is not configured.'
		return undefined
	}

	// Updates fields of the view's form.
	function update(patch: Partial<AutoFocusSettings>) {
		setAutoFocusSettings(profileState, role, patch)
	}

	function start() {
		if (!camera.device || !focuser.device) return
		const request = autoFocusRequest(settings, { connectionId: focuser.device.connectionId, deviceId: focuser.device.id }, stepSize, capabilities)
		void startAutoFocus(autoFocusRuntime, camera.device.connectionId, camera.device.id, request)
	}

	const { detection } = settings
	const builtin = detection.detector.provider === 'builtin' ? detection.detector : undefined
	const filter = wheelState && (wheelState.names[wheelState.position] || `Slot ${wheelState.position + 1}`)

	return (
		<>
			<PanelSection title="Measurement">
				<ExposureTimeInput value={settings.exposureTime} exposure={capabilities?.exposure} disabled={locked} onChange={(exposureTime) => update({ exposureTime })} />
				{capabilities?.gain && <NumberInput label="Gain" value={Math.min(capabilities.gain.max, Math.max(capabilities.gain.min, settings.gain))} min={capabilities.gain.min} max={capabilities.gain.max} disabled={locked} onChange={(gain) => update({ gain })} />}
				{capabilities?.offset && <NumberInput label="Offset" value={Math.min(capabilities.offset.max, Math.max(capabilities.offset.min, settings.offset))} min={capabilities.offset.min} max={capabilities.offset.max} disabled={locked} onChange={(offset) => update({ offset })} />}
				{capabilities?.bin && <NumberInput label="Binning" value={Math.min(capabilities.bin.x, settings.bin)} min={1} max={Math.min(capabilities.bin.x, capabilities.bin.y)} disabled={locked} onChange={(bin) => update({ bin })} />}
				{wheel.device && <p className="m-0 text-xs leading-4 text-ink-300">Filter: {filter ?? 'unknown'} — the Auto Focus measures through the current filter and never changes it.</p>}
				<DetectorControls request={detection} disabled={locked} onChange={(request) => update({ detection: request })} />
				<details>
					<summary className="cursor-pointer text-ink-200 select-none">{PROVIDER_LABELS[detection.detector.provider]} detector settings</summary>
					<div className="mt-2 flex flex-col gap-2">
						<DetectorSettingsControls request={detection} disabled={locked} onChange={(request) => update({ detection: request })} />
						{builtin && (
							<>
								<NumberInput label="Aperture radius" value={builtin.maximumRadius ?? AUTO_FOCUS_APERTURE} min={4} max={256} suffix="px" disabled={locked} onChange={(maximumRadius) => update({ detection: { ...detection, detector: { ...builtin, maximumRadius } } })} />
								<Notice>Largest aperture the HFD of a star is measured in; it must hold the most defocused stars of the curve.</Notice>
							</>
						)}
						<AcceptanceControls request={detection} disabled={locked} onChange={(request) => update({ detection: request })} />
					</div>
				</details>
				<p className="m-0 text-xs leading-4 text-ink-300">Each frame is measured by the median HFD of its accepted stars (Multi-Star); frames are kept in memory only.</p>
				<Checkbox label="Show star overlay" checked={settings.overlay} onChange={(overlay) => update({ overlay })} />
			</PanelSection>
			<PanelSection title="Focus Routine">
				<Select label="Curve Fitting" options={FITTING_MODES} value={settings.fittingMode} format={(mode) => FITTING_MODE_LABELS[mode]} disabled={locked} onChange={(fittingMode) => update({ fittingMode })} />
				<NumberInput label="Step Size" value={stepSize} min={1} max={focuserState ? Math.max(1, focuserState.position.max - focuserState.position.min) : undefined} suffix="steps" disabled={locked} onChange={(value) => update({ stepSize: value })} />
				<NumberInput label="Positions per Side" value={settings.initialOffsetSteps} min={1} max={50} disabled={locked} onChange={(initialOffsetSteps) => update({ initialOffsetSteps })} />
				<p className="m-0 text-xs leading-4 text-ink-300">
					The sweep starts {settings.initialOffsetSteps * stepSize} steps {settings.reversed ? 'inward' : 'outward'} and extends until both sides of the minimum have {settings.initialOffsetSteps} positions.
				</p>
				<details>
					<summary className="cursor-pointer text-ink-200 select-none">Advanced settings</summary>
					<div className="mt-2 flex flex-col gap-2">
						<Checkbox label="Start the sweep inward" checked={settings.reversed} disabled={locked} onChange={(reversed) => update({ reversed })} />
						<NumberInput label="Settle Time" value={settings.settleDelay} min={0} max={600} step={0.1} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
						<NumberInput label="Measurement Timeout" value={settings.measureTimeout} min={1} max={3600} suffix="s" disabled={locked} onChange={(measureTimeout) => update({ measureTimeout })} />
						<NumberInput label="Max RMSD / HFD" value={settings.rmsdThreshold} min={0} max={10} step={0.01} disabled={locked} onChange={(rmsdThreshold) => update({ rmsdThreshold })} />
						<Notice>A fitted curve whose error relative to its best HFD exceeds this is rejected; 0 accepts any fit. Backlash is compensated as saved for the focuser in Equipment Control.</Notice>
					</div>
				</details>
			</PanelSection>
			<PanelSection title="Current Session">
				{session && <SessionState session={session} position={focuserState?.position.value} moving={focuserState?.moving} />}
				{running ? (
					<Button variant="secondary" disabled={pending || session!.state === 'stopping'} onClick={() => void stopAutoFocus(autoFocusRuntime, session!)}>
						{session!.state === 'stopping' ? 'Stopping…' : 'Stop'}
					</Button>
				) : (
					<Button disabled={blocker !== undefined || pending} onClick={start}>
						Run Auto Focus
					</Button>
				)}
				{blocker && <p className="m-0 text-xs leading-4 text-ink-300">{blocker}</p>}
				{running && <p className="m-0 text-xs leading-4 text-ink-300">A stop leaves the focuser where it stands.</p>}
				{error && <p className="m-0 text-xs leading-4 text-danger">{error}</p>}
			</PanelSection>
		</>
	)
}

interface SessionStateProps {
	// Session shown.
	readonly session: AutoFocusSessionSummary
	// Logical position the focuser reports now, in steps.
	readonly position?: number
	// Whether the focuser reports a motion.
	readonly moving?: boolean
}

// State of the running or last session: its step, the focuser, the latest measurement, and once placed, the
// best focus the curve estimated apart from the position reached and the HFD verified there.
function SessionState({ session, position, moving }: SessionStateProps) {
	const running = autoFocusRunning(session)
	const [now, setNow] = useState(Date.now)

	// Only the elapsed time is refreshed here; the session itself runs on the server.
	useEffect(() => {
		if (!running) return
		const timer = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(timer)
	}, [running])

	const last = session.lastMeasurement
	const failed = session.state === 'failed'

	return (
		<>
			<p className={cn('m-0', failed ? 'text-danger' : 'text-ink-100')}>
				{AUTO_FOCUS_STATE_LABELS[session.state]}
				{session.target !== undefined && running && ` — ${session.target}`}
			</p>
			{failed && session.error && <p className="m-0 text-xs leading-4 text-danger">{session.error}</p>}
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<Row label="Focuser">{position === undefined ? '—' : `${position}${moving ? ' (moving)' : ''}`}</Row>
				{session.initialPosition !== undefined && <Row label="Start Position">{session.initialPosition}</Row>}
				<Row label="Samples">{session.measurementCount}</Row>
				{last && <Row label="Last HFD">{last.hfd === undefined ? `— at ${last.requestedPosition}` : `${last.hfd.toFixed(2)} px at ${last.requestedPosition}`}</Row>}
				{last && <Row label="Stars">{`${last.acceptedCount} / ${last.detectedCount}`}</Row>}
				<Row label="Estimated Best">{session.estimatedPosition ?? '—'}</Row>
				{session.estimatedHfd !== undefined && <Row label="Fitted HFD">{`${session.estimatedHfd.toFixed(2)} px`}</Row>}
				<Row label="Final Position">{session.finalPosition ?? '—'}</Row>
				<Row label="Verification">{session.verification === 'measured' && session.verifiedHfd !== undefined ? `${session.verifiedHfd.toFixed(2)} px measured` : session.verification === 'pending' ? 'Pending' : VERIFICATION_LABELS[session.verification]}</Row>
				<Row label="Elapsed">{formatElapsed(((session.endedAt ?? now) - session.startedAt) / 1000)}</Row>
			</dl>
			{last && last.warnings.length > 0 && <p className="m-0 text-xs leading-4 text-ink-300">{last.warnings.join(' ')}</p>}
			{session.verificationError && <p className="m-0 text-xs leading-4 text-ink-300">{session.verificationError}</p>}
			{session.state === 'cancelled' && <p className="m-0 text-xs leading-4 text-ink-300">The focuser was left where the stop found it.</p>}
		</>
	)
}

// Label and value of a session row.
function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="contents">
			<dt className="text-ink-300">{label}</dt>
			<dd className="m-0 min-w-0 truncate text-right tabular-nums">{children}</dd>
		</div>
	)
}

// Formats an elapsed time in seconds as m:ss, or h:mm:ss from one hour.
function formatElapsed(seconds: number) {
	const total = Math.max(0, Math.floor(seconds))
	const s = String(total % 60).padStart(2, '0')
	const m = Math.floor(total / 60) % 60
	const h = Math.floor(total / 3600)
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
