import type { DomeState } from 'api'
import { cn } from 'cn'
import { type PointerEvent, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { NumberInput } from '../../ui/NumberInput'
import { controlRuntime, deviceStateOf, sendCommand, startCommand, stopCommand } from '../control'
import { type DomeDirection, domeMotionRuntime, pressDomeMotion, releaseDomeMotion } from '../domeMotion'
import { Actions, ConfirmButton, type InterfaceProps, Notice, Readout } from '../parts'

// Controls of a dome: its reported azimuth, shutter, park, home, and slaving, a slew to an azimuth or by an
// angle, the shutter altitude, press-and-hold manual rotation, a stop, and its configuration (sync, park
// position, speed, backlash). Every motion is refused by the server while the driver slaves the dome to
// the mount, and nothing here bypasses an interlock of the driver. Angles are shown and entered in degrees.

// Display name of each shutter state.
const SHUTTER_LABELS: Readonly<Record<DomeState['shutterState'], string>> = { UNKNOWN: 'Unknown', OPEN: 'Open', CLOSED: 'Closed', OPENING: 'Opening', CLOSING: 'Closing', ERROR: 'Error' }

// Returns degrees from radians.
function degrees(angle: number) {
	return (angle * 180) / Math.PI
}

// Motion state of a dome as one line.
function motionOf(dome: DomeState) {
	if (dome.homing) return 'Homing'
	if (dome.parking) return 'Parking'
	if (dome.moving) return dome.direction === 'COUNTER_CLOCKWISE' ? 'Rotating counterclockwise' : 'Rotating clockwise'
	if (dome.slewing) return 'Slewing'
	if (dome.parked) return 'Parked'
	return dome.atHome ? 'At home' : 'Idle'
}

// Controls of a dome.
export function DomeControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const dome = deviceStateOf(control.states, 'dome', device.id)!
	const [azimuth, setAzimuth] = useState(Math.round(degrees(dome.azimuth.value)))
	const [delta, setDelta] = useState(10)
	const [altitude, setAltitude] = useState(Math.round(degrees(dome.altitude.value)))
	const [sync, setSync] = useState(Math.round(degrees(dome.azimuth.value)))
	const [speed, setSpeed] = useState(dome.speed.value)
	const [backlash, setBacklash] = useState(dome.backlash.value)
	const busy = control.pending[device.id] !== undefined
	const shutterMoving = dome.shutterState === 'OPENING' || dome.shutterState === 'CLOSING'
	const moving = dome.slewing || dome.moving || dome.homing || dome.parking || shutterMoving
	const locked = dome.slaved || dome.parked || dome.parking
	const blocked = busy || moving || locked

	function run(action: string, label: string, body?: object) {
		void startCommand(controlRuntime, { type: 'dome', deviceId: device.id, action, label, body })
	}

	function set(action: string, label: string, body?: object) {
		return sendCommand(controlRuntime, { type: 'dome', deviceId: device.id, action, label, body })
	}

	return (
		<>
			<PanelSection title="Dome">
				<Readout label="State">{motionOf(dome)}</Readout>
				<Readout label="Azimuth">{`${degrees(dome.azimuth.value).toFixed(1)}°`}</Readout>
				{dome.canSetAltitude && <Readout label="Shutter altitude">{`${degrees(dome.altitude.value).toFixed(1)}°`}</Readout>}
				{dome.hasShutter && <Readout label="Shutter">{SHUTTER_LABELS[dome.shutterState]}</Readout>}
				{dome.canSlave && <Readout label="Slaving">{dome.slaved ? 'Following the mount' : 'Off'}</Readout>}
				{moving && dome.canAbort && (
					<Actions>
						<Button onClick={() => void stopCommand(controlRuntime, { type: 'dome', deviceId: device.id, action: 'stop' })}>Abort</Button>
					</Actions>
				)}
				{dome.slaved && <Notice>The driver moves the dome with the mount; switch slaving off to move it from here.</Notice>}
			</PanelSection>
			{(dome.canSetAzimuth || dome.canRelativeMove || dome.canSetAltitude || dome.canMove) && (
				<PanelSection title="Position">
					{dome.canSetAzimuth && (
						<div className="flex items-end gap-2">
							<NumberInput className="min-w-0 flex-1" label="Target azimuth" value={azimuth} min={0} max={360} step={1} suffix="°" onChange={setAzimuth} />
							<Button disabled={blocked} onClick={() => run('slew', 'Slew', { azimuth })}>
								Slew
							</Button>
						</div>
					)}
					{dome.canRelativeMove && (
						<div className="flex items-end gap-2">
							<NumberInput className="min-w-0 flex-1" label="Rotate by" value={delta} min={0} max={360} step={1} suffix="°" onChange={setDelta} />
							<Button variant="secondary" disabled={blocked || !(delta > 0)} onClick={() => run('move-by', 'Rotate', { delta: -delta })}>
								CCW
							</Button>
							<Button variant="secondary" disabled={blocked || !(delta > 0)} onClick={() => run('move-by', 'Rotate', { delta })}>
								CW
							</Button>
						</div>
					)}
					{dome.canSetAltitude && (
						<div className="flex items-end gap-2">
							<NumberInput className="min-w-0 flex-1" label="Shutter altitude" value={altitude} min={Math.round(degrees(dome.altitude.min))} max={Math.round(degrees(dome.altitude.max))} step={1} suffix="°" onChange={setAltitude} />
							<Button variant="secondary" disabled={blocked} onClick={() => run('altitude', 'Altitude', { altitude })}>
								Move Shutter
							</Button>
						</div>
					)}
					{dome.canMove && <ManualRotation connectionId={device.connectionId} deviceId={device.id} disabled={busy || locked || (moving && !dome.moving)} />}
				</PanelSection>
			)}
			{(dome.canPark || dome.canUnpark || dome.canFindHome || (dome.hasShutter && dome.canSetShutter) || dome.canSlave) && (
				<PanelSection title="Shutter, Park & Home">
					<Actions>
						{dome.hasShutter && dome.canSetShutter && (
							<>
								<Button variant="secondary" disabled={busy || moving || dome.shutterState === 'OPEN'} onClick={() => run('shutter', 'Open shutter', { open: true })}>
									Open Shutter
								</Button>
								<Button variant="secondary" disabled={busy || moving || dome.shutterState === 'CLOSED'} onClick={() => run('shutter', 'Close shutter', { open: false })}>
									Close Shutter
								</Button>
							</>
						)}
						{dome.canPark && !dome.parked && (
							<Button variant="secondary" disabled={busy || moving || dome.slaved} onClick={() => run('park', 'Park')}>
								Park
							</Button>
						)}
						{dome.canUnpark && dome.parked && (
							<Button variant="secondary" disabled={busy || moving} onClick={() => run('unpark', 'Unpark')}>
								Unpark
							</Button>
						)}
						{dome.canFindHome && (
							<ConfirmButton title="Find home?" message="The dome rotates until its sensor finds the home position." confirmLabel="Find Home" disabled={blocked} onConfirm={() => run('home', 'Find Home')}>
								Find Home
							</ConfirmButton>
						)}
					</Actions>
					{dome.parked && !dome.canUnpark && <Notice>This driver cannot unpark the dome from here.</Notice>}
					{dome.canSlave && <Checkbox label="Follow the mount (driver slaving)" checked={dome.slaved} disabled={busy || moving} onChange={(enabled) => void set('slaving', enabled ? 'Slaving on' : 'Slaving off', { enabled })} />}
				</PanelSection>
			)}
			{(dome.canSync || dome.canSetPark || dome.canSetSpeed || dome.hasBacklash) && (
				<PanelSection title="Configuration">
					{dome.canSync && (
						<div className="flex items-end gap-2">
							<NumberInput className="min-w-0 flex-1" label="Sync azimuth" value={sync} min={0} max={360} step={1} suffix="°" onChange={setSync} />
							<ConfirmButton title="Sync the dome?" message={`The dome will report ${sync}° where it stands now, without moving. Every later slew and the slaving use the new reference.`} confirmLabel="Sync" disabled={blocked} onConfirm={() => void set('sync', 'Sync', { azimuth: sync })}>
								Sync
							</ConfirmButton>
						</div>
					)}
					{dome.canSetSpeed && (
						<div className="flex items-end gap-2">
							<NumberInput className="min-w-0 flex-1" label="Speed" value={speed} min={dome.speed.min} max={dome.speed.max} step={dome.speed.step > 0 ? dome.speed.step : 0.1} suffix="RPM" onChange={setSpeed} />
							<Button variant="secondary" disabled={busy || speed === dome.speed.value} onClick={() => void set('speed', 'Speed', { value: speed })}>
								Apply
							</Button>
						</div>
					)}
					{dome.hasBacklash && (
						<>
							<Checkbox label="Backlash compensation" checked={dome.backlashEnabled} disabled={busy || moving} onChange={(enabled) => void set('backlash', 'Backlash', { enabled })} />
							<div className="flex items-end gap-2">
								<NumberInput className="min-w-0 flex-1" label="Backlash" value={backlash} min={dome.backlash.min} max={dome.backlash.max} step={dome.backlash.step > 0 ? dome.backlash.step : 1} suffix="steps" onChange={setBacklash} />
								<Button variant="secondary" disabled={busy || moving || backlash === dome.backlash.value} onClick={() => void set('backlash', 'Backlash', { steps: backlash })}>
									Apply
								</Button>
							</div>
						</>
					)}
					{dome.canSetPark && (
						<Actions>
							<ConfirmButton title="Set park position?" message="The current azimuth becomes the park position of the dome, replacing the one it knows." confirmLabel="Set Park" disabled={blocked} onConfirm={() => void set('set-park', 'Set Park')}>
								Set Park
							</ConfirmButton>
						</Actions>
					)}
				</PanelSection>
			)}
			{dome.measurements && (
				<PanelSection title="Geometry">
					<Readout label="Radius">{`${dome.measurements.radius} m`}</Readout>
					<Readout label="Shutter width">{`${dome.measurements.shutterWidth} m`}</Readout>
					<Readout label="Mount offset N / E / Up">{`${dome.measurements.northDisplacement} / ${dome.measurements.eastDisplacement} / ${dome.measurements.upDisplacement} m`}</Readout>
					<Readout label="OTA offset">{`${dome.measurements.otaOffset} m · ${dome.measurements.otaSide.toLowerCase()}`}</Readout>
				</PanelSection>
			)}
		</>
	)
}

interface ManualRotationProps {
	// Id of the open connection that provides the dome.
	readonly connectionId: string
	// Exact device id of the dome.
	readonly deviceId: string
	// Whether a press cannot start; the button of the press held is never disabled, so its release is
	// always delivered.
	readonly disabled: boolean
}

// Press-and-hold buttons rotating a dome while held. Control of a press is lost with the window's focus or
// visibility, and with the panel itself, which all release it.
function ManualRotation({ connectionId, deviceId, disabled }: ManualRotationProps) {
	const runtime = useSnapshot(domeMotionRuntime)
	const press = runtime.press?.deviceId === deviceId ? runtime.press : undefined

	useEffect(() => {
		const release = () => void releaseDomeMotion(domeMotionRuntime)
		const hidden = () => document.visibilityState === 'hidden' && release()

		window.addEventListener('blur', release)
		window.addEventListener('pagehide', release)
		document.addEventListener('visibilitychange', hidden)

		return () => {
			window.removeEventListener('blur', release)
			window.removeEventListener('pagehide', release)
			document.removeEventListener('visibilitychange', hidden)
			release()
		}
	}, [])

	return (
		<>
			<div className="grid grid-cols-2 gap-2">
				<RotationButton direction="COUNTER_CLOCKWISE" label="Hold CCW" connectionId={connectionId} deviceId={deviceId} held={press?.direction === 'COUNTER_CLOCKWISE'} disabled={disabled || (runtime.press !== undefined && press === undefined)} />
				<RotationButton direction="CLOCKWISE" label="Hold CW" connectionId={connectionId} deviceId={deviceId} held={press?.direction === 'CLOCKWISE'} disabled={disabled || (runtime.press !== undefined && press === undefined)} />
			</div>
			{runtime.error && <Notice error>{runtime.error}</Notice>}
		</>
	)
}

interface RotationButtonProps {
	// Direction rotated in while held.
	readonly direction: DomeDirection
	// Button text.
	readonly label: string
	// Id of the open connection that provides the dome.
	readonly connectionId: string
	// Exact device id of the dome.
	readonly deviceId: string
	// Whether this button holds the press of this tab.
	readonly held: boolean
	// Whether the button cannot start a press.
	readonly disabled: boolean
}

// Press-and-hold button of one direction. The pointer is captured on press, so the release arrives here
// even when it happens outside the button, and every way the press can end releases it.
function RotationButton({ direction, label, connectionId, deviceId, held, disabled }: RotationButtonProps) {
	function down(event: PointerEvent<HTMLButtonElement>) {
		if (event.button !== 0 || disabled) return
		event.preventDefault()
		event.currentTarget.setPointerCapture(event.pointerId)
		void pressDomeMotion(domeMotionRuntime, connectionId, deviceId, direction)
	}

	function release() {
		if (held) void releaseDomeMotion(domeMotionRuntime)
	}

	return (
		<button
			type="button"
			disabled={disabled && !held}
			onPointerDown={down}
			onPointerUp={release}
			onPointerCancel={release}
			onLostPointerCapture={release}
			onContextMenu={(event) => event.preventDefault()}
			className={cn(
				'flex h-11 cursor-pointer touch-none items-center justify-center rounded-md border border-line-200 bg-transparent font-mono text-[13px] font-medium text-ink-100 transition-colors duration-150 select-none hover:border-ink-300 hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-line-100 disabled:text-ink-300 disabled:hover:bg-transparent',
				held && 'border-accent bg-accent-subtle text-accent hover:border-accent hover:bg-accent-subtle',
			)}
		>
			{label}
		</button>
	)
}
