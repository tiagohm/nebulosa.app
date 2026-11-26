import type { CalibrationMasterSummary, DeviceSummary, IPolarSession, IPolarSessionSummary } from 'api'
import { cn } from 'cn'
import { toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import type { BindableDevice } from '../equipment/catalog'
import { CatalogCameraNotice, useBoundCamera } from '../equipment/CatalogCameraNotice'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import type { RoleDevice } from '../equipment/useEquipment'
import { formatArcmin, formatArcsec, formatClockDuration, formatClockTime, formatDegrees, formatExposureTime, formatFixed, formatTemperature, MISSING } from '../format'
import { useActiveSite, useDisplayZone } from '../location/useLocation'
import { operationsState } from '../operations'
import { CameraPlateSolvingSection } from '../platesolving/CameraPlateSolvingSection'
import { activeProfile, cameraPlateSolving, exposureSettings, ipolarSettings, profileState, setIPolarSettings } from '../profile/profile'
import { type CameraIdentity, DEFAULT_IPOLAR_DARK_SETTINGS, IPOLAR_MAXIMUM_ROTATION, IPOLAR_MINIMUM_ROTATION, type IPolarDarkSettings, type IPolarSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { LinkButton } from '../ui/LinkButton'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { useNow } from '../useNow'
import { CameraAcquisitionSection } from './CameraAcquisitionSection'
import { cameraKey } from './capture'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameProgress } from './FrameProgress'
import {
	confirmIPolarRotation,
	finishIPolar,
	ipolarConvergenceText,
	ipolarCorrectionText,
	ipolarDarkText,
	IPOLAR_DIRECTION_LABELS,
	IPOLAR_DIRECTIONS,
	IPOLAR_MODE_LABELS,
	IPOLAR_MODES,
	IPOLAR_REJECTION_LABELS,
	IPOLAR_STATE_LABELS,
	ipolarBlocker,
	ipolarMountSupport,
	ipolarRequest,
	ipolarRetryText,
	ipolarRunning,
	ipolarRuntime,
	ipolarSlewRate,
	ipolarSummaryText,
	ipolarWithinTarget,
	startIPolar,
	startIPolarRefinement,
	stopIPolar,
	stopIPolarRefinement,
} from './ipolar'
import { loadLiveMasters } from './livestacking'
import { SessionStateText } from './SessionStateText'

// Contextual panel sections of iPolar, a camera operation of the Images camera tabs. The session leads: its state with
// the time a solve or a rotation has taken, the polar error as the panel's one Readout with the moves of the mount pole
// in words, as the server decided them from the visible pole, the step instruction, the mode and what Start does, the
// commands, and why a start is blocked with the way to fix it; then the calibration, collapsed once a measurement leads;
// then the settings, collapsed with a summary (rotation, acquisition, dark, plate solving, refinement), and the
// equipment last. Frames are taken with the exposure time of this form and the camera's camera settings, edited only in
// Camera Acquisition, and solved with the camera's plate solving settings; the site is always the profile's active
// observing site, which the panel does not show. The camera is the panel's target and the mount the MOUNT of the active
// equipment setup, required only for the automatic rotation. The forms are the camera's, kept in the profile, and stay
// locked showing the values applied while a session runs. The session is the server's, shown here whichever tab
// started it, and keeps running when the panel unmounts.

// Classes of the session commands: a touch target of 44 px on a coarse pointer, since they are pressed at the mount.
const COMMAND_CLASS = 'pointer-coarse:min-h-[44px]'

// Time a frame has been solving after which the panel says a solve over the whole sky can take minutes, in seconds.
const SLOW_SOLVE = 20

// Camera an iPolar panel aligns with and the forms it edits.
export interface IPolarTarget {
	// Camera, when present on the watched connection.
	readonly device?: DeviceSummary
	// Whether the camera can take frames now, and why not.
	readonly availability: RoleAvailability
	// Mount of the equipment setup and its state.
	readonly mount: RoleDevice
	// Camera whose forms are edited; absent when the profile has no saved connection, so the defaults are shown and
	// nothing is kept.
	readonly settings?: CameraIdentity
}

// iPolar panel sections of a camera.
export function IPolarSections({ device, availability, mount, settings: identity }: IPolarTarget) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(ipolarRuntime)
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const site = useActiveSite()
	const profile = activeProfile(profiles)
	const settings = ipolarSettings(profile.settings, identity)
	const exposure = exposureSettings(profile.settings, identity)
	const solving = cameraPlateSolving(profile.settings, identity)
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const details = session ? runtime.details[session.sessionId] : undefined
	const capabilities = watchedDeviceState(control, 'camera', device)
	const mountState = watchedDeviceState(control, 'mount', mount.device)
	const running = ipolarRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const locked = running || pending
	// While running, the form shows the values the session applied.
	const shown: Readonly<IPolarSettings> = running && session ? appliedSettings(session) : settings
	const automatic = shown.mode === 'automatic'
	const slewRate = running && session ? session.request.slewRate : ipolarSlewRate(settings, mountState)
	const mountAvailability = roleAvailability('MOUNT', mount, operations, automatic ? ipolarMountSupport(mountState) : undefined)
	const blocker = running ? undefined : ipolarBlocker({ camera: availability, mount: mountAvailability, mode: settings.mode, mountState, slewRate, site, dark: settings.dark })
	const slewRates = mountState?.slewRates ?? []
	const acquisition = running && session ? session.request.capture : exposure
	const direction = IPOLAR_DIRECTION_LABELS[shown.direction]
	const dark = shown.dark ?? DEFAULT_IPOLAR_DARK_SETTINGS
	// Where the blocker is fixed: the observing sites of Settings, the equipment setup, or the mount's own page (busy,
	// disconnected, parked, no preset); nothing to open for the camera, which is the tab's, or the dark, which is below.
	const fix =
		blocker === undefined || availability.status !== 'ready' || (settings.dark?.enabled && settings.dark.masterId === undefined) ? undefined : !site ? 'site' : automatic && (mountAvailability.status === 'notSelected' || mountAvailability.status === 'unsupported') ? 'setup' : mount.device ? 'mount' : undefined

	// Updates fields of the camera's iPolar form.
	function update(patch: Partial<IPolarSettings>) {
		setIPolarSettings(profileState, identity, patch)
	}

	function start() {
		if (!device || !site) return
		// A manual session uses the setup's mount only when it is ready; without one, nothing is held but the camera.
		const used = mount.device && mountAvailability.status === 'ready' ? { connectionId: mount.device.connectionId, deviceId: mount.device.id } : undefined
		void startIPolar(ipolarRuntime, device.connectionId, device.id, ipolarRequest(settings, exposure, solving, site, used, slewRate, capabilities))
	}

	return (
		<>
			<CollapsibleSection id="images.ipolar.session" title={running ? 'Current Session' : session ? 'Last Session' : 'Session'} summary={session && ipolarSummaryText(session)}>
				{session && <SessionState session={session} details={details} />}
				{session?.measurement && <PolarError session={session} ended={!running} timeZone={site?.timeZone} />}
				{session?.state === 'waitingForRotation' && (
					<Notice>
						Turn the RA axis by hand {IPOLAR_MINIMUM_ROTATION}° to {IPOLAR_MAXIMUM_ROTATION}° now (20° to 40° is best), keeping DEC still, then press Rotation Done.
					</Notice>
				)}
				{session?.state === 'readyToRefine' && <Notice>Start the refinement, then turn the azimuth and altitude knobs of the mount base while the error refreshes.</Notice>}
				{session?.state === 'refining' && <Notice>Turn the azimuth and altitude knobs of the mount base until the pole marker sits on the RA axis marker; the mount is not moved. The error refreshes with every frame.</Notice>}
				{!running && <SegmentedControl label="RA Rotation" options={IPOLAR_MODES} value={shown.mode} format={(mode) => IPOLAR_MODE_LABELS[mode]} disabled={locked} onChange={(mode) => update({ mode })} />}
				{!running && blocker === undefined && automatic && (
					<Notice warning>
						Start turns {mount.device?.name ?? 'the mount'} in RA by itself, about {formatFixed(shown.rotation, 0)}° towards the {direction.toLowerCase()}: make sure counterweights, cables, the pier, and the roof leave it clear.
					</Notice>
				)}
				{!running && blocker === undefined && !automatic && <Notice>After the first frame, you turn the RA axis by hand; nothing is moved by the software.</Notice>}
				<div className="flex flex-wrap gap-2">
					{running ? (
						<>
							{session!.state === 'waitingForRotation' && (
								<Button className={COMMAND_CLASS} title="Tell iPolar the RA axis was turned; nothing is moved" disabled={pending} onClick={() => void confirmIPolarRotation(ipolarRuntime, session!)}>
									Rotation Done
								</Button>
							)}
							{(session!.state === 'readyToRefine' || session!.state === 'refinementPaused') && (
								<Button className={COMMAND_CLASS} title="Take frames and refresh the error while you turn the knobs" disabled={pending} onClick={() => void startIPolarRefinement(ipolarRuntime, session!)}>
									{session!.state === 'readyToRefine' ? 'Start Refinement' : 'Resume Refinement'}
								</Button>
							)}
							{session!.state === 'refining' && (
								<Button variant="secondary" className={COMMAND_CLASS} title="Stop taking frames; the devices stay held" disabled={pending} onClick={() => void stopIPolarRefinement(ipolarRuntime, session!)}>
									Pause Refinement
								</Button>
							)}
							{session!.calibration && session!.state !== 'stopping' && (
								<Button variant="secondary" className={COMMAND_CLASS} title="End the session as completed and keep its last measurement" disabled={pending} onClick={() => void finishIPolar(ipolarRuntime, session!)}>
									Finish
								</Button>
							)}
							<Button
								variant={session!.state === 'rotating' ? 'primary' : 'secondary'}
								className={COMMAND_CLASS}
								title={session!.state === 'rotating' ? 'Stop the RA rotation and end the session' : 'End the session as stopped'}
								disabled={pending || session!.state === 'stopping'}
								onClick={() => void stopIPolar(ipolarRuntime, session!)}
							>
								{session!.state === 'stopping' ? 'Stopping…' : 'Stop'}
							</Button>
						</>
					) : (
						<Button className={COMMAND_CLASS} title={blocker} disabled={blocker !== undefined || pending} onClick={start}>
							Start Polar Alignment
						</Button>
					)}
				</div>
				{blocker && <Notice>{blocker}</Notice>}
				{fix === 'setup' && <EquipmentSetupButton />}
				{fix === 'site' && (
					<LinkButton className="self-start text-xs" onClick={() => navigate(routeState, { workspace: 'settings', section: 'observing-sites' })}>
						Open the observing sites in Settings
					</LinkButton>
				)}
				{fix === 'mount' && mount.device && (
					<LinkButton className="self-start text-xs" onClick={() => navigate(routeState, { workspace: 'equipment', device: mount.device!.id })}>
						Open {mount.device.name} in Equipment Control
					</LinkButton>
				)}
				{error && <Notice error>{error}</Notice>}
				{session && <SessionNotes session={session} />}
			</CollapsibleSection>
			{session && <Calibration session={session} details={details} />}
			<CollapsibleSection id="images.ipolar.rotation" title="Rotation" summary={automatic ? `${IPOLAR_MODE_LABELS.automatic} · ${direction} · ${formatFixed(shown.rotation, 0)}° · settle ${shown.settleDelay} s` : `${IPOLAR_MODE_LABELS.manual} · settle ${shown.settleDelay} s`} defaultOpen={false}>
				{automatic && (
					<>
						<SegmentedControl label="RA Direction" options={IPOLAR_DIRECTIONS} value={shown.direction} format={(direction) => IPOLAR_DIRECTION_LABELS[direction]} disabled={locked} onChange={(direction) => update({ direction })} />
						{slewRates.length > 0 ? (
							<Select label="Slew Rate" options={slewRates.map((rate) => rate.name)} value={slewRate ?? slewRates[0].name} format={(name) => slewRates.find((rate) => rate.name === name)?.label.trim() || name} disabled={locked} onChange={(name) => update({ slewRate: name })} />
						) : (
							<Notice>Slew Rate: {running ? shown.slewRate : 'the mount reports no preset yet.'}</Notice>
						)}
						<NumberInput label="RA Rotation" value={shown.rotation} min={IPOLAR_MINIMUM_ROTATION} max={IPOLAR_MAXIMUM_ROTATION} step={1} suffix="°" disabled={locked} onChange={(rotation) => update({ rotation })} />
					</>
				)}
				<NumberInput label="Settle Time" value={shown.settleDelay} min={0} max={120} step={0.5} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
				<Notice>
					{automatic ? 'The mount turns in bounded steps; the rotation is measured by plate solving, never assumed from the motion time.' : 'The rotation is measured by plate solving.'} The camera must be fixed to the part of the mount that turns in RA: moving DEC, the camera, or the optics after the
					calibration needs a new one.
				</Notice>
				{!automatic && mountAvailability.status !== 'ready' && mountAvailability.status !== 'busy' && <Notice>Without a mount, its declination and pier side cannot be watched, so the RA-only motion rests on your word.</Notice>}
			</CollapsibleSection>
			<CameraAcquisitionSection
				id="images.ipolar.acquisition"
				device={device}
				exposure={acquisition}
				capabilities={capabilities}
				defaultOpen={false}
				summary={`${formatExposureTime(shown.exposureTime)} · ${acquisition.binX}×${acquisition.binY}`}
				description="Frames are LIGHT, taken with the exposure time above and the camera settings of Camera Acquisition, and kept in memory only. Keep the binning and the subframe unchanged during a session."
			>
				<ExposureTimeInput value={shown.exposureTime} exposure={capabilities?.exposure} disabled={locked} onChange={(exposureTime) => update({ exposureTime })} />
			</CameraAcquisitionSection>
			<DarkSection device={device} dark={dark} exposureTime={shown.exposureTime} locked={locked} session={running ? session : undefined} onChange={(patch) => update({ dark: { ...(settings.dark ?? DEFAULT_IPOLAR_DARK_SETTINGS), ...patch } })} />
			<CameraPlateSolvingSection
				id="images.ipolar.plate-solver"
				device={device}
				solving={running && session ? session.request.solving : solving}
				defaultOpen={false}
				description={(solver, assisted) => (
					<>
						Each frame is solved with the Plate Solving settings ({solver} solver, {assisted ? 'around the position the mount reports during an automatic rotation, else over the whole sky' : 'over the whole sky'}); the rotation and the polar error are measured from the solutions.
					</>
				)}
			/>
			<CollapsibleSection id="images.ipolar.refinement" title="Refinement" summary={`every ${shown.refinementDelay} s · target ${shown.completionThreshold}″`} defaultOpen={false}>
				<NumberInput label="Refinement Interval" value={shown.refinementDelay} min={0} max={600} step={0.5} suffix="s" disabled={locked} onChange={(refinementDelay) => update({ refinementDelay })} />
				<NumberInput label="Target Error" value={shown.completionThreshold} min={1} max={3600} step={5} suffix="″" disabled={locked} onChange={(completionThreshold) => update({ completionThreshold })} />
				<Checkbox label="Correct for atmospheric refraction" checked={shown.refraction} disabled={locked} onChange={(refraction) => update({ refraction })} />
				<Notice>The target error is a requested threshold, not a measure of accuracy.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.ipolar.equipment" title="Equipment" summary={mount.device?.name ?? 'No mount'} defaultOpen={false}>
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} />
					</DataRow>
					<DataRow label="Mount">
						<DeviceLink device={mount.device} fallback="Not assigned" />
					</DataRow>
				</DataList>
				{!running && automatic && mountAvailability.status !== 'ready' && <Notice>{mountAvailability.message}</Notice>}
			</CollapsibleSection>
		</>
	)
}

// The form values a running session applied, as the form shows them (degrees and arcseconds).
function appliedSettings({ request }: IPolarSessionSummary): IPolarSettings {
	return {
		exposureTime: request.capture.exposureTime,
		mode: request.mode,
		direction: request.direction,
		slewRate: request.slewRate,
		rotation: toDeg(request.rotation),
		settleDelay: request.settleDelay,
		refinementDelay: request.refinementDelay,
		completionThreshold: toArcsec(request.completionThreshold),
		refraction: request.refraction,
		...(request.dark && { dark: { enabled: true, ...request.dark } }),
	}
}

// Returns the instant, Unix milliseconds, at which key last changed, starting with the first render: the start of the
// step a session is in, for the time it has taken.
function useSince(key: string): number {
	const [since, setSince] = useState(() => ({ key, at: Date.now() }))
	if (since.key === key) return since.at
	const next = { key, at: Date.now() }
	setSince(next)
	return next.at
}

interface SessionStateProps {
	// Session shown.
	readonly session: IPolarSessionSummary
	// Its complete record, once fetched, for the rotation the last candidate reached.
	readonly details?: IPolarSession
}

// Headline of the running or last session: its state; the progress of the frame being exposed; while a frame solves or
// the mount turns, the time the step has taken, measured from when this tab saw it begin, with the rotation the last
// candidate reached and why a solve can be slow; and its failure.
function SessionState({ session, details }: SessionStateProps) {
	const failed = session.state === 'failed'
	const exposing = session.state === 'capturing' || session.state === 'refining'
	const waiting = session.endedAt === undefined && (session.state === 'solving' || session.state === 'rotating')
	const since = useSince(`${session.sessionId}:${session.state}:${session.frameCount}:${session.attemptCount}`)
	// Only the elapsed time is refreshed here; the session itself runs on the server.
	const now = useNow(waiting)
	const elapsed = (now - since) / 1000
	const turned = session.state === 'rotating' && !session.calibration ? details?.attempts.at(-1)?.rotation : undefined

	return (
		<>
			<SessionStateText failed={failed}>{IPOLAR_STATE_LABELS[session.state]}</SessionStateText>
			{exposing && <FrameProgress exposure={session.exposure} />}
			{waiting && (
				<p className="m-0 text-xs leading-4 text-ink-300 tabular-nums">
					{session.state === 'solving' ? `Frame #${session.frameCount}` : turned !== undefined ? `${formatDegrees(turned, 1)} of ${formatDegrees(session.request.rotation, 0)} turned so far` : 'Turning'} · {formatClockDuration(elapsed)} elapsed
				</p>
			)}
			{waiting && session.state === 'solving' && elapsed >= SLOW_SOLVE && <Notice>A frame solved over the whole sky can take minutes.</Notice>}
			{failed && session.error && <Notice error>{sentence(session.error)}</Notice>}
		</>
	)
}

interface PolarErrorProps {
	// Session with a measurement.
	readonly session: IPolarSessionSummary
	// Whether the session ended, so the measurement is its last one.
	readonly ended: boolean
	// Zone of the active site, for the time of the measurement.
	readonly timeZone?: string
}

// The polar error of the latest measurement as the panel's Readout: the total error, said within the target when it
// is current and within the requested threshold, or stale; the moves of the mount pole in azimuth and altitude in
// words; and how long it stayed within the target. A later frame that gave no measurement says why.
function PolarError({ session, ended, timeZone }: PolarErrorProps) {
	const { zone } = useDisplayZone(timeZone ? { timeZone } : undefined)
	const measurement = session.measurement!
	const { convergence, rejection } = session
	const within = ipolarWithinTarget(session)
	const correction = ipolarCorrectionText(measurement)

	return (
		<>
			<div className="flex flex-col gap-0.5">
				<p className={cn('m-0 text-3xl leading-9 font-semibold tracking-[-0.01em] tabular-nums', session.current ? 'text-ink-100' : 'text-ink-300')}>{formatArcmin(measurement.totalError)}</p>
				<p className="m-0 text-xs leading-4 text-ink-300">
					{within && <span className="text-success">Within target · </span>}
					{!session.current && <span className="text-warning">Stale · </span>}
					{`${ended ? 'Last polar error' : 'Polar error'}, frame #${measurement.frame} at ${formatClockTime(measurement.time, zone, { seconds: true })}`}
				</p>
			</div>
			<DataList>
				<DataRow label="Azimuth">{correction.azimuth}</DataRow>
				<DataRow label="Altitude">{correction.altitude}</DataRow>
				<DataRow label="Target" tone={convergence.converged ? 'success' : 'default'}>
					{ipolarConvergenceText(session)}
				</DataRow>
			</DataList>
			{!session.current && rejection && (
				<Notice warning>
					Frame #{rejection.frame} gave no measurement: {IPOLAR_REJECTION_LABELS[rejection.reason]}. The error above is from frame #{measurement.frame}.
				</Notice>
			)}
		</>
	)
}

// What the session did to the mount besides turning it (the slew rate restored) and its latest warning, under the
// commands.
function SessionNotes({ session }: { readonly session: IPolarSessionSummary }) {
	return (
		<>
			{session.slewRateRestored === true && session.previousSlewRate && <Notice>The slew rate was restored to {session.previousSlewRate}.</Notice>}
			{session.warnings.length > 0 && <Notice warning>{session.warnings.at(-1)}</Notice>}
		</>
	)
}

interface CalibrationProps {
	// Session shown.
	readonly session: IPolarSessionSummary
	// Its complete record, once fetched.
	readonly details?: IPolarSession
}

// The calibration: frames and candidates, the rotation fitted, its quality, and the last rejected candidate with what
// follows it; collapsed with a summary once a measurement leads the session.
function Calibration({ session, details }: CalibrationProps) {
	const { calibration } = session
	const rejected = details?.attempts.at(-1)

	return (
		<CollapsibleSection id="images.ipolar.calibration" title="Calibration" defaultOpen={session.measurement === undefined} summary={calibration ? `${formatDegrees(calibration.rotation, 1)} · ${calibration.verified ? 'watched' : 'stated'} RA-only` : `${session.frameCount} frames`}>
			<DataList>
				<DataRow label="Frames">{session.frameCount}</DataRow>
				<DataRow label="Rotation Attempts">{session.attemptCount}</DataRow>
				<DataRow label="RA Rotation">{calibration ? `${formatDegrees(calibration.rotation, 1)}${calibration.preferred ? '' : ' (outside 20°–40°)'}` : MISSING}</DataRow>
				<DataRow label="Fit Residual">{calibration ? formatArcsec(calibration.residual) : MISSING}</DataRow>
				<DataRow label="Error at Calibration">{calibration ? formatArcmin(calibration.axisOffset) : MISSING}</DataRow>
				<DataRow label="RA-Only Motion">{calibration ? (calibration.verified ? 'Watched on the mount' : 'Operator stated') : MISSING}</DataRow>
			</DataList>
			{!calibration && rejected && (
				<Notice>
					Last frame after the rotation{rejected.rotation !== undefined ? ` (${formatDegrees(rejected.rotation, 1)})` : ''}: {IPOLAR_REJECTION_LABELS[rejected.reason]}
					{ipolarRetryText(session.request.mode, rejected.retry)}
				</Notice>
			)}
		</CollapsibleSection>
	)
}

interface DarkSectionProps {
	// Camera of the session, whose camera of the Equipment Catalog the darks come from.
	readonly device: BindableDevice | undefined
	// Master dark of the form, or the one a running session applies.
	readonly dark: IPolarDarkSettings
	// Exposure time of the frames, in seconds, which a master must have exactly.
	readonly exposureTime: number
	// Whether the form is locked by a session or a command in flight.
	readonly locked: boolean
	// Running session, whose latest frame's dark outcome is shown.
	readonly session?: IPolarSessionSummary
	// Updates fields of the form's dark.
	readonly onChange: (patch: Partial<IPolarDarkSettings>) => void
}

// Option of the master selector meaning no master chosen yet.
const NO_MASTER = ''

// The master dark of the Calibration Library the frames are solved less: the operator pins one among the darks of the
// camera of the Equipment Catalog the camera is bound to (none is chosen automatically), what a frame it does not fit does,
// and, while a session runs, how it went for the latest frame. The masters are listed from the library; the server checks
// the pinned one against the camera and the header of every frame. Collapsed with a summary, open while an enabled dark
// waits for its master, which blocks a start.
function DarkSection({ device, dark, exposureTime, locked, session, onChange }: DarkSectionProps) {
	const [masters, setMasters] = useState<readonly CalibrationMasterSummary[]>()
	const exposure = Math.round(exposureTime * 1e6)
	const cameraId = useBoundCamera(device)
	const unchosen = dark.enabled && dark.masterId === undefined

	useEffect(() => {
		if (!dark.enabled || session) return
		let current = true
		void loadLiveMasters('dark', cameraId).then((loaded) => current && setMasters(loaded))
		return () => {
			current = false
		}
	}, [dark.enabled, session, cameraId])

	const ids = (masters ?? []).map((master) => String(master.masterId))
	const selected = dark.masterId === undefined ? NO_MASTER : String(dark.masterId)
	const listed = selected === NO_MASTER || ids.includes(selected)
	const policy = dark.onUnavailable === 'continue' ? 'solve without' : 'stop'

	function describe(id: string) {
		if (id === NO_MASTER) return 'Choose a master dark'
		const master = masters?.find((candidate) => String(candidate.masterId) === id)
		if (!master) return `#${id}`
		const { metadata } = master
		const temperature = metadata.setTemperature.value ?? metadata.sensorTemperature.value
		const parts = [
			`#${master.masterId}`,
			metadata.exposure.value === undefined ? MISSING : formatExposureTime(metadata.exposure.value / 1e6),
			metadata.gain.value === undefined ? undefined : `gain ${metadata.gain.value}`,
			metadata.binX.value === undefined ? undefined : `bin ${metadata.binX.value}×${metadata.binY.value ?? metadata.binX.value}`,
			temperature === undefined ? undefined : formatTemperature(temperature),
			`${master.frames} frames`,
			metadata.cameraName,
		]
		return parts.filter(Boolean).join(' · ')
	}

	function choose(id: string) {
		const master = masters?.find((candidate) => String(candidate.masterId) === id)
		if (master) onChange({ masterId: master.masterId, digest: master.contentDigest })
	}

	return (
		<CollapsibleSection id="images.ipolar.dark" title="Dark" summary={!dark.enabled ? 'Off' : unchosen ? 'No master chosen' : `#${dark.masterId} · ${policy}`} defaultOpen={unchosen}>
			<Checkbox label="Subtract a Calibration Library dark" checked={dark.enabled} disabled={locked} onChange={(enabled) => onChange({ enabled })} />
			{dark.enabled && <CatalogCameraNotice device={device} lead="Darks come from" purpose="to use the Calibration Library" />}
			{dark.enabled && (
				<>
					{session ? (
						<DataList>
							<DataRow label="Master">{dark.masterId === undefined ? MISSING : `#${dark.masterId}`}</DataRow>
						</DataList>
					) : (
						<Select
							label="Master"
							options={[NO_MASTER, ...ids]}
							value={listed ? selected : NO_MASTER}
							format={describe}
							disabledReason={(id) => (id === NO_MASTER ? undefined : masters?.find((candidate) => String(candidate.masterId) === id)?.metadata.exposure.value !== exposure ? 'Exposure differs from the frames' : undefined)}
							disabled={locked}
							onChange={choose}
						/>
					)}
					<SegmentedControl label="When It Does Not Fit" options={['continue', 'stop'] as const} value={dark.onUnavailable} format={(policy) => (policy === 'continue' ? 'Solve Without' : 'Stop')} disabled={locked} onChange={(onUnavailable) => onChange({ onUnavailable })} />
					{!session && masters !== undefined && masters.length === 0 && <Notice>The Calibration Library has no master dark yet; make one with the Dark Library Wizard.</Notice>}
					{!session && !listed && <Notice>The dark #{dark.masterId} is no longer in the Calibration Library; choose another one.</Notice>}
					{session?.dark && <Notice error={session.dark.state === 'failed' || (session.dark.state === 'notApplied' && dark.onUnavailable === 'stop')}>{ipolarDarkText(session.dark, dark.onUnavailable)}</Notice>}
					{dark.masterId !== undefined && <Notice>The camera a master came from cannot be verified; the server checks the master against the exposure, size, gain, offset, binning, and temperature of every frame, and only the frame itself is shown.</Notice>}
				</>
			)}
		</CollapsibleSection>
	)
}

// Returns a failure detail as a sentence: its first letter in upper case and a final period.
function sentence(text: string) {
	const capitalized = text.charAt(0).toUpperCase() + text.slice(1)
	return capitalized.endsWith('.') ? capitalized : `${capitalized}.`
}
