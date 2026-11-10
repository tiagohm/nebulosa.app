import type { MountCoordinate, MountState } from 'api'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatDegrees, formatElevation, formatGeographic, formatZonedDateTime } from '../../format'
import { connectionCameraTab } from '../../images/cameratabs'
import { imagesState, selectImage, selectImageTool } from '../../images/images'
import { useActiveSite, useActiveTimeZone } from '../../location/useLocation'
import { activeProfile, activeSetup, profileState } from '../../profile/profile'
import { PanelSection } from '../../shell/ContextualPanel'
import { navigate, routeState } from '../../shell/route'
import { formatDeclination, formatRightAscension } from '../../sky/format'
import { horizontalOf } from '../../sky/mount'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataRow } from '../../ui/DataRow'
import { LinkButton } from '../../ui/LinkButton'
import { Notice } from '../../ui/Notice'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { controlRuntime, deviceStateOf, sendCommand, startCommand, stopCommand } from '../control'
import type { InterfaceProps } from '../parts'

// Controls of a mount: where it points, a coordinate to go to, flip to, or sync on, tracking and its rate,
// the manual-motion speed, park and home, and the site and clock it uses. Every value shown is the one the
// mount reports; a command only says it was sent until the mount reports its effect. Manual motion stays in
// the Mount Nudge operation of an Images camera tab, reached from here.

// Frames a coordinate target can be entered in.
const FRAMES = ['JNOW', 'J2000', 'ALTAZ', 'ECLIPTIC', 'GALACTIC'] as const satisfies readonly MountCoordinate['frame'][]

// Display name of each frame.
const FRAME_LABELS: Readonly<Record<MountCoordinate['frame'], string>> = { JNOW: 'JNow', J2000: 'J2000', ALTAZ: 'Alt/Az', ECLIPTIC: 'Ecliptic', GALACTIC: 'Galactic' }

// Labels of the longitude-like and latitude-like components of each frame.
const COMPONENT_LABELS: Readonly<Record<MountCoordinate['frame'], readonly [string, string]>> = {
	JNOW: ['RA (h)', 'Dec (°)'],
	J2000: ['RA (h)', 'Dec (°)'],
	ALTAZ: ['Azimuth (°)', 'Altitude (°)'],
	ECLIPTIC: ['Longitude (°)', 'Latitude (°)'],
	GALACTIC: ['Longitude (°)', 'Latitude (°)'],
}

// Display name of each tracking rate.
const TRACK_MODE_LABELS: Readonly<Record<MountState['trackMode'], string>> = { SIDEREAL: 'Sidereal', SOLAR: 'Solar', LUNAR: 'Lunar', KING: 'King', CUSTOM: 'Custom' }

// Display name of each pier side.
const PIER_SIDE_LABELS: Readonly<Record<MountState['pierSide'], string>> = { EAST: 'East', WEST: 'West', NEITHER: 'Unknown' }

// Motion state of a mount as one line.
function motionOf(mount: MountState) {
	if (mount.homing) return 'Homing'
	if (mount.parking) return 'Parking'
	if (mount.moving) return 'Moving'
	if (mount.slewing) return 'Slewing'
	if (mount.parked) return 'Parked'
	return mount.tracking ? 'Tracking' : 'Stopped'
}

// Opens the Images workspace on a camera tab with its Mount Nudge tool; nothing moves until a direction is held.
function openMountNudge(tab: string) {
	selectImage(imagesState, tab)
	selectImageTool(imagesState, tab, 'mount-nudge')
	navigate(routeState, { workspace: 'images' })
}

// Controls of a mount.
export function MountControls({ device }: InterfaceProps) {
	const timeZone = useActiveTimeZone()
	const control = useSnapshot(controlRuntime)
	const profiles = useSnapshot(profileState)
	const images = useSnapshot(imagesState)
	const mount = deviceStateOf(control.states, 'mount', device.id)!
	const profile = activeProfile(profiles)
	const observer = useActiveSite()
	const busy = control.pending[device.id] !== undefined
	const moving = mount.slewing || mount.parking || mount.homing || mount.moving
	const setup = activeSetup(profile)
	const nudgeable = setup.MOUNT?.id === device.id
	// Camera tab whose Mount Nudge moves this mount: the Main Camera's, or another camera of the connection.
	const nudgeTab = connectionCameraTab(images, device.connectionId, setup.MAIN_CAMERA?.id)
	const horizontal = observer && horizontalOf(mount, Date.now(), observer)

	function run(action: string, label: string, body?: object) {
		void startCommand(controlRuntime, { type: 'mount', deviceId: device.id, action, label, body })
	}

	function set(action: string, label: string, body?: object) {
		void sendCommand(controlRuntime, { type: 'mount', deviceId: device.id, action, label, body })
	}

	return (
		<>
			<PanelSection title="Mount">
				<DataRow label="State">{motionOf(mount)}</DataRow>
				<DataRow label="RA (JNow)">{formatRightAscension(mount.rightAscension)}</DataRow>
				<DataRow label="Dec (JNow)">{formatDeclination(mount.declination)}</DataRow>
				{horizontal && (
					<>
						<DataRow label="Altitude">{formatDeclination(horizontal.altitude)}</DataRow>
						<DataRow label="Azimuth">{formatDegrees(horizontal.azimuth)}</DataRow>
					</>
				)}
				{mount.hasPierSide && <DataRow label="Pier side">{PIER_SIDE_LABELS[mount.pierSide]}</DataRow>}
				<Notice>{horizontal ? 'Altitude and azimuth are geometric, for the observing site of the profile.' : 'Select an observing site in the top bar to see altitude and azimuth.'}</Notice>
				{moving && mount.canAbort && (
					<Actions>
						<Button onClick={() => void stopCommand(controlRuntime, { type: 'mount', deviceId: device.id, action: 'stop' })}>Abort Motion</Button>
					</Actions>
				)}
			</PanelSection>
			<TargetSection mount={mount} deviceId={device.id} busy={busy} observer={observer} />
			{(mount.canTracking || mount.trackModes.length > 1 || mount.slewRates.length > 0) && (
				<PanelSection title="Tracking">
					{mount.canTracking && <Checkbox label="Tracking" checked={mount.tracking} disabled={busy || mount.parked} onChange={(enabled) => set('tracking', enabled ? 'Tracking on' : 'Tracking off', { enabled })} />}
					{mount.trackModes.length > 1 && <Select label="Tracking rate" options={mount.trackModes} value={mount.trackMode} format={(mode) => TRACK_MODE_LABELS[mode]} disabled={busy} onChange={(mode) => set('track-mode', 'Tracking rate', { mode })} />}
					{mount.slewRates.length > 0 && (
						<Select
							label="Manual speed"
							options={mount.slewRates.map((rate) => rate.name)}
							value={mount.slewRate ?? mount.slewRates[0].name}
							format={(name) => mount.slewRates.find((rate) => rate.name === name)?.label ?? name}
							disabled={busy}
							onChange={(name) => set('slew-rate', 'Manual speed', { name })}
						/>
					)}
				</PanelSection>
			)}
			{(mount.canPark || mount.canHome || mount.canFindHome || mount.canSetHome || mount.canSetPark) && (
				<PanelSection title="Park & Home">
					<DataRow label="Parked">{mount.parked ? 'Yes' : mount.parking ? 'Parking' : 'No'}</DataRow>
					<Actions>
						{mount.canPark &&
							(mount.parked ? (
								<Button variant="secondary" disabled={busy || moving} onClick={() => run('unpark', 'Unpark')}>
									Unpark
								</Button>
							) : (
								<Button variant="secondary" disabled={busy || moving} onClick={() => run('park', 'Park')}>
									Park
								</Button>
							))}
						{mount.canHome && (
							<Button variant="secondary" disabled={busy || moving || mount.parked} onClick={() => run('home', 'Go Home')}>
								Go Home
							</Button>
						)}
						{mount.canFindHome && (
							<ConfirmButton title="Find home?" message="The mount moves its axes until its sensors find the home position. Make sure nothing obstructs the telescope." confirmLabel="Find Home" disabled={busy || moving || mount.parked} onConfirm={() => run('find-home', 'Find Home')}>
								Find Home
							</ConfirmButton>
						)}
						{mount.canSetHome && (
							<ConfirmButton title="Set home position?" message="The current position becomes the home position of the mount, replacing the one it knows." confirmLabel="Set Home" disabled={busy || moving} onConfirm={() => set('set-home', 'Set Home')}>
								Set Home
							</ConfirmButton>
						)}
						{mount.canSetPark && (
							<ConfirmButton title="Set park position?" message="The current position becomes the park position of the mount, replacing the one it knows." confirmLabel="Set Park" disabled={busy || moving} onConfirm={() => set('set-park', 'Set Park')}>
								Set Park
							</ConfirmButton>
						)}
					</Actions>
				</PanelSection>
			)}
			<PanelSection title="Site & Time">
				<DataRow label="Location">{formatGeographic(toDeg(mount.site.latitude), toDeg(mount.site.longitude))}</DataRow>
				<DataRow label="Elevation">{formatElevation(mount.site.elevation)}</DataRow>
				<DataRow label="Time">{mount.time.utc > 0 ? formatZonedDateTime(mount.time.utc, timeZone) : 'Not reported'}</DataRow>
				<Actions>
					{observer && (
						<ConfirmButton
							title={`Send ${observer.name} to the mount?`}
							message={`The mount will use latitude ${observer.latitude}°, longitude ${observer.longitude}°, and elevation ${observer.elevation} m of the active site for its own coordinate conversions. Selecting a site never sends it by itself.`}
							confirmLabel="Send"
							disabled={busy}
							onConfirm={() => set('site', 'Send site', { site: { latitude: observer.latitude, longitude: observer.longitude, elevation: observer.elevation } })}
						>
							Send Active Site to Mount
						</ConfirmButton>
					)}
					<ConfirmButton title="Send the computer clock?" message="The mount clock is set to the current time of this computer and its time zone offset." confirmLabel="Send" disabled={busy} onConfirm={() => set('time', 'Send time', { utc: Date.now(), offset: -new Date().getTimezoneOffset() })}>
						Send Computer Clock
					</ConfirmButton>
				</Actions>
			</PanelSection>
			{mount.canMove && (
				<PanelSection title="Manual Motion">
					{nudgeable ? (
						<>
							<Actions>
								<Button variant="secondary" disabled={!nudgeTab} onClick={() => nudgeTab && openMountNudge(nudgeTab)}>
									Open Mount Nudge
								</Button>
							</Actions>
							{!nudgeTab && <Notice>Mount Nudge is a tool of the Images camera tabs; connect a camera of this connection to open it.</Notice>}
						</>
					) : (
						<Notice>Mount Nudge moves the mount assigned to the Mount role in Equipment Setup; assign this mount to use it.</Notice>
					)}
				</PanelSection>
			)}
		</>
	)
}

interface TargetSectionProps {
	// Mount commanded.
	readonly mount: MountState
	// Exact id of the mount.
	readonly deviceId: string
	// Whether a command of the mount is in flight.
	readonly busy: boolean
	// Observer of the profile, whose horizon a goto must be above.
	readonly observer?: { readonly latitude: number; readonly longitude: number; readonly elevation: number }
}

// Coordinate entry with goto, flip, and sync. The coordinate is only text typed by the user until a
// command sends it; the server parses it and refuses targets below the observer's horizon.
function TargetSection({ mount, deviceId, busy, observer }: TargetSectionProps) {
	const [frame, setFrame] = useState<MountCoordinate['frame']>('JNOW')
	const [x, setX] = useState('')
	const [y, setY] = useState('')

	if (!mount.canGoTo && !mount.canFlip && !mount.canSync) return null

	const target: MountCoordinate = { frame, x: x.trim(), y: y.trim() }
	const incomplete = !target.x || !target.y
	const blocked = busy || mount.parked || mount.parking || incomplete
	const [xLabel, yLabel] = COMPONENT_LABELS[frame]

	function useCurrent() {
		setFrame('JNOW')
		setX(((mount.rightAscension * 12) / Math.PI).toFixed(5))
		setY(((mount.declination * 180) / Math.PI).toFixed(4))
	}

	function slew(action: 'goto' | 'flip') {
		if (!observer) return
		const site = { latitude: observer.latitude, longitude: observer.longitude, elevation: observer.elevation }
		void startCommand(controlRuntime, { type: 'mount', deviceId, action, label: action === 'goto' ? 'GoTo' : 'Flip', body: { target, observer: site } })
	}

	return (
		<PanelSection title="Target">
			<Select label="Frame" options={FRAMES} value={frame} format={(value) => FRAME_LABELS[value]} onChange={setFrame} />
			<div className="grid grid-cols-2 gap-2">
				<TextInput label={xLabel} value={x} onChange={(e) => setX(e.target.value)} placeholder={frame === 'JNOW' || frame === 'J2000' ? '05 35 17' : '120.5'} />
				<TextInput label={yLabel} value={y} onChange={(e) => setY(e.target.value)} placeholder="-05 23 28" />
			</div>
			<Actions>
				<Button variant="ghost" onClick={useCurrent}>
					Use Current
				</Button>
				{mount.canGoTo && (
					<Button disabled={blocked || !observer} onClick={() => slew('goto')}>
						GoTo
					</Button>
				)}
				{mount.canFlip && (
					<Button variant="secondary" disabled={blocked || !observer} onClick={() => slew('flip')}>
						Flip
					</Button>
				)}
				{mount.canSync && (
					<ConfirmButton
						title="Sync the mount?"
						message="The mount takes the entered coordinate as the place it points at now, without moving. A wrong coordinate misplaces every later goto."
						confirmLabel="Sync"
						disabled={blocked}
						onConfirm={() => void sendCommand(controlRuntime, { type: 'mount', deviceId, action: 'sync', label: 'Sync', body: { target } })}
					>
						Sync
					</ConfirmButton>
				)}
			</Actions>
			{mount.parked && <Notice>Unpark the mount to point it.</Notice>}
			{!observer && (mount.canGoTo || mount.canFlip) && <Notice>Select an observing site in the top bar: a goto is refused below its horizon.</Notice>}
			{(mount.canGoTo || mount.canFlip) && (
				<Notice>
					Flip only moves the mount. To flip at the meridian while pausing the capture and guiding around it, use the Executor of the <LinkButton onClick={() => navigate(routeState, { workspace: 'tools', tool: 'meridian-flip-monitor' })}>Meridian Flip tool</LinkButton>.
				</Notice>
			)}
			<Notice>Sexagesimal or decimal; right ascension in hours, every other component in degrees.</Notice>
		</PanelSection>
	)
}
