import { cn } from 'cn'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { type PointerEvent, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { controlRuntime, deviceStateOf, sendCommand, startCommand } from '../control'
import { type DomeDirection, domeMotionRuntime, pressDomeMotion, releaseDomeMotion } from '../domeMotion'
import { useDraft } from '../draft'
import { domeMoving } from '../lexicon'
import { CollapsedSection, type InterfaceProps } from '../parts'
import { firstReason, useBusyReason } from '../useControl'

// Controls of a dome: its slaving, a slew to an azimuth or by an angle, the shutter altitude, press-and-hold manual
// rotation, the shutter, park, and home; then, collapsed, its configuration (sync, park position, speed, backlash) and
// its geometry. Its azimuth, state, and the stop of its motion are in the header of the device. Every motion is refused
// by the server while the driver slaves the dome to the mount, and nothing here bypasses an interlock of the driver.
// The fields follow the reported values until edited, so a command never starts from a stale value. Angles are shown
// and entered in degrees.

// Controls of a dome.
export function DomeControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const dome = deviceStateOf(control.states, 'dome', device.id)!
	const azimuth = useDraft(Math.round(toDeg(dome.azimuth.value)))
	const [delta, setDelta] = useState(10)
	const altitude = useDraft(Math.round(toDeg(dome.altitude.value)))
	const sync = useDraft(Math.round(toDeg(dome.azimuth.value)))
	const speed = useDraft(dome.speed.value)
	const backlash = useDraft(dome.backlash.value)
	const busy = useBusyReason(device)
	const moving = domeMoving(dome)
	const motion = moving && 'Wait until the dome stops moving'
	const slaved = dome.slaved && 'The driver moves the dome with the mount; switch slaving off first'
	const parked = (dome.parked || dome.parking) && 'Unpark the dome first'
	const blocked = firstReason(busy, motion, slaved, parked)
	const slewReason = firstReason(blocked, !azimuth.edited && 'Enter a target azimuth other than the current one')
	const rotateReason = firstReason(blocked, !(delta > 0) && 'Enter an angle above 0°')
	const altitudeReason = firstReason(blocked, !altitude.edited && 'Enter a shutter altitude other than the current one')
	const shutterReason = firstReason(busy, motion)
	const syncReason = firstReason(blocked, !sync.edited && 'Enter the azimuth the dome should report')
	const speedReason = firstReason(busy, !speed.edited && 'Change the speed first')
	const backlashReason = firstReason(shutterReason, !backlash.edited && 'Change the backlash first')
	const parkReason = firstReason(shutterReason, slaved)

	function run(action: string, label: string, body?: object) {
		void startCommand(controlRuntime, { type: 'dome', deviceId: device.id, action, label, body })
	}

	function set(action: string, label: string, body?: object) {
		return sendCommand(controlRuntime, { type: 'dome', deviceId: device.id, action, label, body })
	}

	// Sends the setting of a draft, then lets its field follow the reported value again.
	async function apply(action: string, label: string, body: object, draft: { readonly reset: () => void }) {
		if (await set(action, label, body)) draft.reset()
	}

	return (
		<>
			{dome.canSlave && (
				<PanelSection title="Slaving">
					<DataRow label="Slaving">{dome.slaved ? 'Following the mount' : 'Off'}</DataRow>
					<Checkbox label="Follow the mount (driver slaving)" checked={dome.slaved} disabled={!!shutterReason} title={shutterReason} onChange={(enabled) => void set('slaving', enabled ? 'Slaving on' : 'Slaving off', { enabled })} />
					{dome.slaved && <Notice>The driver moves the dome with the mount; switch slaving off to move it from here.</Notice>}
				</PanelSection>
			)}
			{(dome.canSetAzimuth || dome.canRelativeMove || dome.canSetAltitude || dome.canMove) && (
				<PanelSection title="Position">
					{dome.canSetAzimuth && (
						<div className="flex items-end gap-2">
							<NumberInput className="min-w-0 flex-1" label="Target azimuth" value={azimuth.value} min={0} max={360} step={1} suffix="°" onChange={azimuth.set} />
							<Button
								disabled={!!slewReason}
								title={slewReason}
								onClick={() => {
									run('slew', 'Slew', { azimuth: azimuth.value })
									azimuth.reset()
								}}
							>
								Slew
							</Button>
						</div>
					)}
					{dome.canRelativeMove && (
						<div className="flex flex-wrap items-end gap-2">
							<NumberInput className="min-w-32 flex-1" label="Rotate by" value={delta} min={0} max={360} step={1} suffix="°" onChange={setDelta} />
							<div className="flex gap-2">
								<Button variant="secondary" disabled={!!rotateReason} title={rotateReason} onClick={() => run('move-by', 'Rotate counterclockwise', { delta: -delta })}>
									Counterclockwise
								</Button>
								<Button variant="secondary" disabled={!!rotateReason} title={rotateReason} onClick={() => run('move-by', 'Rotate clockwise', { delta })}>
									Clockwise
								</Button>
							</div>
						</div>
					)}
					{dome.canSetAltitude && (
						<div className="flex items-end gap-2">
							<NumberInput className="min-w-0 flex-1" label="Shutter altitude" value={altitude.value} min={Math.round(toDeg(dome.altitude.min))} max={Math.round(toDeg(dome.altitude.max))} step={1} suffix="°" onChange={altitude.set} />
							<Button
								variant="secondary"
								disabled={!!altitudeReason}
								title={altitudeReason}
								onClick={() => {
									run('altitude', 'Move shutter', { altitude: altitude.value })
									altitude.reset()
								}}
							>
								Move Shutter
							</Button>
						</div>
					)}
					{dome.canMove && <ManualRotation connectionId={device.connectionId} deviceId={device.id} disabled={firstReason(busy, slaved, parked, moving && !dome.moving && 'Wait until the dome stops moving')} />}
				</PanelSection>
			)}
			{(dome.canPark || dome.canUnpark || dome.canFindHome || (dome.hasShutter && dome.canSetShutter)) && (
				<PanelSection title="Shutter, Park & Home">
					<Actions>
						{dome.hasShutter && dome.canSetShutter && (
							<>
								<Button variant="secondary" disabled={!!shutterReason || dome.shutterState === 'OPEN'} title={firstReason(shutterReason, dome.shutterState === 'OPEN' && 'The shutter is open')} onClick={() => run('shutter', 'Open shutter', { open: true })}>
									Open Shutter
								</Button>
								<Button variant="secondary" disabled={!!shutterReason || dome.shutterState === 'CLOSED'} title={firstReason(shutterReason, dome.shutterState === 'CLOSED' && 'The shutter is closed')} onClick={() => run('shutter', 'Close shutter', { open: false })}>
									Close Shutter
								</Button>
							</>
						)}
						{dome.canPark && !dome.parked && (
							<Button variant="secondary" disabled={!!parkReason} title={parkReason} onClick={() => run('park', 'Park')}>
								Park
							</Button>
						)}
						{dome.canUnpark && dome.parked && (
							<Button variant="secondary" disabled={!!shutterReason} title={shutterReason} onClick={() => run('unpark', 'Unpark')}>
								Unpark
							</Button>
						)}
						{dome.canFindHome && (
							<ConfirmButton title="Find home?" message="The dome rotates until its sensor finds the home position." confirmLabel="Find Home" disabled={!!blocked} tooltip={blocked} onConfirm={() => run('home', 'Find Home')}>
								Find Home
							</ConfirmButton>
						)}
					</Actions>
					{dome.parked && !dome.canUnpark && <Notice>This driver cannot unpark the dome from here.</Notice>}
				</PanelSection>
			)}
			{(dome.canSync || dome.canSetPark || dome.canSetSpeed || dome.hasBacklash) && (
				<CollapsedSection title="Configuration">
					{dome.canSync && (
						<div className="flex items-end gap-2">
							<NumberInput className="min-w-0 flex-1" label="Sync azimuth" value={sync.value} min={0} max={360} step={1} suffix="°" onChange={sync.set} />
							<ConfirmButton
								title="Sync the dome?"
								message={`The dome will report ${sync.value}° where it stands now, without moving. Every later slew and the slaving use the new reference.`}
								confirmLabel="Sync"
								disabled={!!syncReason}
								tooltip={syncReason}
								onConfirm={() => void apply('sync', 'Sync', { azimuth: sync.value }, sync)}
							>
								Sync
							</ConfirmButton>
						</div>
					)}
					{dome.canSetSpeed && (
						<div className="flex items-end gap-2">
							<NumberInput className="min-w-0 flex-1" label="Speed" value={speed.value} min={dome.speed.min} max={dome.speed.max} step={dome.speed.step > 0 ? dome.speed.step : 0.1} suffix="RPM" onChange={speed.set} />
							<Button variant="secondary" disabled={!!speedReason} title={speedReason} onClick={() => void apply('speed', 'Speed', { value: speed.value }, speed)}>
								Apply
							</Button>
						</div>
					)}
					{dome.hasBacklash && (
						<>
							<Checkbox label="Backlash compensation" checked={dome.backlashEnabled} disabled={!!shutterReason} title={shutterReason} onChange={(enabled) => void set('backlash', 'Backlash', { enabled })} />
							<div className="flex items-end gap-2">
								<NumberInput className="min-w-0 flex-1" label="Backlash" value={backlash.value} min={dome.backlash.min} max={dome.backlash.max} step={dome.backlash.step > 0 ? dome.backlash.step : 1} suffix="steps" onChange={backlash.set} />
								<Button variant="secondary" disabled={!!backlashReason} title={backlashReason} onClick={() => void apply('backlash', 'Backlash', { steps: backlash.value }, backlash)}>
									Apply
								</Button>
							</div>
						</>
					)}
					{dome.canSetPark && (
						<Actions>
							<ConfirmButton title="Set park position?" message="The current azimuth becomes the park position of the dome, replacing the one it knows." confirmLabel="Set Park" disabled={!!blocked} tooltip={blocked} onConfirm={() => void set('set-park', 'Set Park')}>
								Set Park
							</ConfirmButton>
						</Actions>
					)}
				</CollapsedSection>
			)}
			{dome.measurements && (
				<CollapsedSection title="Geometry">
					<DataRow label="Radius">{`${dome.measurements.radius} m`}</DataRow>
					<DataRow label="Shutter width">{`${dome.measurements.shutterWidth} m`}</DataRow>
					<DataRow label="Mount offset N / E / Up">{`${dome.measurements.northDisplacement} / ${dome.measurements.eastDisplacement} / ${dome.measurements.upDisplacement} m`}</DataRow>
					<DataRow label="OTA offset">{`${dome.measurements.otaOffset} m · ${dome.measurements.otaSide.toLowerCase()}`}</DataRow>
				</CollapsedSection>
			)}
		</>
	)
}

interface ManualRotationProps {
	// Id of the open connection that provides the dome.
	readonly connectionId: string
	// Exact device id of the dome.
	readonly deviceId: string
	// Why a press cannot start, shown as the tooltip of both buttons; undefined when it can. The button of the press
	// held is never disabled, so its release is always delivered.
	readonly disabled?: string
}

// Press-and-hold buttons rotating a dome while held. Control of a press is lost with the window's focus or
// visibility, and with the panel itself, which all release it.
function ManualRotation({ connectionId, deviceId, disabled }: ManualRotationProps) {
	const runtime = useSnapshot(domeMotionRuntime)
	const press = runtime.press?.deviceId === deviceId ? runtime.press : undefined
	const reason = firstReason(disabled, runtime.press !== undefined && press === undefined && 'Another dome rotation is held in this tab')

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
				<RotationButton direction="COUNTER_CLOCKWISE" label="Hold Counterclockwise" connectionId={connectionId} deviceId={deviceId} held={press?.direction === 'COUNTER_CLOCKWISE'} disabled={reason} />
				<RotationButton direction="CLOCKWISE" label="Hold Clockwise" connectionId={connectionId} deviceId={deviceId} held={press?.direction === 'CLOCKWISE'} disabled={reason} />
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
	// Why the button cannot start a press, shown as its tooltip; undefined when it can.
	readonly disabled?: string
}

// Press-and-hold button of one direction. The pointer is captured on press, so the release arrives here
// even when it happens outside the button, and every way the press can end releases it.
function RotationButton({ direction, label, connectionId, deviceId, held, disabled }: RotationButtonProps) {
	function down(event: PointerEvent<HTMLButtonElement>) {
		if (event.button !== 0 || (disabled && !held)) return
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
			disabled={!!disabled && !held}
			title={held ? undefined : disabled}
			onPointerDown={down}
			onPointerUp={release}
			onPointerCancel={release}
			onLostPointerCapture={release}
			onContextMenu={(event) => event.preventDefault()}
			className={cn(
				'flex min-h-11 cursor-pointer touch-none items-center justify-center rounded-md border border-line-200 bg-transparent px-2 py-1 text-center font-mono text-sm leading-5 font-medium text-ink-100 transition-colors duration-150 select-none hover:border-ink-300 hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-line-100 disabled:text-ink-300 disabled:hover:bg-transparent',
				held && 'border-accent bg-accent-subtle text-accent hover:border-accent hover:bg-accent-subtle',
			)}
		>
			{label}
		</button>
	)
}
