import type { CaptureSession, DeviceSummary, MountNudgeDirection, MountState } from 'api'
import { cn } from 'cn'
import { type PointerEvent, useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { roleAvailability } from '../equipment/availability'
import { deviceState } from '../equipment/equipment'
import type { RoleDevice } from '../equipment/useEquipment'
import { operationsState, runningOn } from '../operations'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import { cameraKey, captureRunning, captureRuntime } from './capture'
import { NUDGE_DIRECTION_LABELS, nudgeDirectionSupported, nudgeKey, type NudgePress, nudgeRunning, nudgeRuntime, pressNudge, releaseNudge, setNudgeSlewRate, stopNudges, watchNudgeMount } from './nudge'

// Contextual panel sections of Mount Nudge, a camera operation of the Images camera tabs:
// press-and-hold manual motion of a mount, named with the camera in the Equipment section (each linked to Equipment
// Control), in eight directions at a speed preset the mount
// reports, with a STOP in the middle, and the state of the motion and, read only, of the camera's acquisition. The
// mount is the MOUNT of the active equipment setup, the one associated with every camera of its connection; a missing
// one is reported, never replaced by another connected mount. The motion is the server's: a press only lasts while
// its pointer is held, and is released when the pointer is lifted or canceled, its capture is lost, the window loses
// focus or is hidden, the mount followed changes (a profile switch), or the panel unmounts, which switching tool,
// camera tab, or workspace does. The panel never touches the camera: a capture keeps running
// underneath, and the viewer and its reticle stay as they are. Directions are those of the mount axes, never of the
// image.

// Why no press can start while another operation holds the mount.
const BUSY = 'The mount is busy with another operation.'

// Cells of the direction grid, row by row; STOP is the middle one.
const GRID: readonly (MountNudgeDirection | 'STOP')[] = ['NW', 'N', 'NE', 'W', 'STOP', 'E', 'SW', 'S', 'SE']

// Mount a nudge panel moves and the camera whose acquisition it shows.
export interface MountNudgeTarget {
	// Mount and its state.
	readonly mount: RoleDevice
	// Camera whose acquisition is shown, read only.
	readonly camera?: DeviceSummary
}

// Mount Nudge panel sections of a mount.
export function MountNudgeSections({ mount, camera }: MountNudgeTarget) {
	const runtime = useSnapshot(nudgeRuntime)
	const control = useSnapshot(controlRuntime)
	const operations = useSnapshot(operationsState)
	const captures = useSnapshot(captureRuntime)
	const device = mount.device
	const connectionId = device?.connectionId
	const id = device?.id
	const { press } = runtime
	const state = watchedDeviceState(control, 'mount', runtime.target)
	const session = connectionId && id ? runtime.sessions[nudgeKey(connectionId, id)] : undefined
	const availability = roleAvailability('MOUNT', mount, operations)
	// While a press is held, its own operation holds the mount; only other holders make it busy.
	const holders = connectionId && id ? runningOn(operations, connectionId, id).filter((operation) => operation.operationId !== (session?.token === press?.token ? session?.operationId : undefined)) : []
	// Busy is judged here from the other holders, so the role only contributes connection problems.
	const roleProblem = availability.status === 'ready' || availability.status === 'busy' ? undefined : availability.message
	const blocker = press ? undefined : nudgeBlocker(roleProblem, state, holders.length > 0)
	const cameraSession = camera ? captures.sessions[cameraKey(camera.connectionId, camera.id)] : undefined

	useEffect(() => {
		watchNudgeMount(nudgeRuntime, connectionId && id ? { connectionId, id } : undefined)
	}, [connectionId, id])

	// Control of a press is lost with the window's focus or visibility, and with the panel itself.
	useEffect(() => {
		const release = () => void releaseNudge(nudgeRuntime)
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

	const slewRates = state?.slewRates ?? []
	const slewRate = slewRates.find((rate) => rate.name === state?.slewRate)

	return (
		<>
			<PanelSection title="Equipment">
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					<dt className="text-ink-300">Camera</dt>
					<dd className="m-0 min-w-0 truncate text-right">
						<DeviceLink device={camera} fallback="—" />
					</dd>
					<dt className="text-ink-300">Mount</dt>
					<dd className="m-0 min-w-0 truncate text-right">
						<DeviceLink device={device} fallback={mount.status === 'notSelected' ? 'None selected' : 'Unavailable'} />
					</dd>
				</dl>
				{mount.status === 'notSelected' && (
					<Button variant="secondary" className="self-start" onClick={() => (deviceState.open = true)}>
						Equipment Setup
					</Button>
				)}
			</PanelSection>
			<PanelSection title="Manual Movement">
				{slewRates.length > 0 ? (
					<Select
						label="Slew Rate"
						options={slewRates.map((rate) => rate.name)}
						value={slewRate?.name ?? slewRates[0].name}
						format={(name) => slewRates.find((rate) => rate.name === name)?.label || name}
						disabled={press !== undefined || runtime.sending || blocker !== undefined}
						onChange={(name) => void setNudgeSlewRate(nudgeRuntime, name)}
					/>
				) : (
					state?.connected && <p className="m-0 text-xs leading-4 text-ink-300">The driver offers no slew rate choice; it moves at its own rate.</p>
				)}
				<div className="grid grid-cols-3 gap-2">
					{GRID.map((cell) =>
						cell === 'STOP' ? (
							<button
								key={cell}
								type="button"
								title="Stop manual movement"
								disabled={!press && !nudgeRunning(session)}
								onClick={() => void stopNudges(nudgeRuntime)}
								className="flex h-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border border-danger bg-transparent text-xs font-medium text-danger transition-colors duration-150 select-none hover:bg-danger/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:border-line-100 disabled:text-ink-300 disabled:hover:bg-transparent"
							>
								<Icon name="stop" className="size-4" />
								STOP
							</button>
						) : (
							<DirectionButton key={cell} direction={cell} press={press} disabled={blocker !== undefined || !nudgeDirectionSupported(state, cell) || (press !== undefined && press.direction !== cell)} />
						),
					)}
				</div>
				<p className="m-0 text-xs leading-4 text-ink-300">Hold a direction to move; release to stop. Directions follow the mount axes, not the image.</p>
			</PanelSection>
			<PanelSection title="Movement Status">
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					<dt className="text-ink-300">Movement</dt>
					<dd className={cn('m-0 text-right', runtime.error && !press && 'text-danger')}>{movementStatus(press, blocker, nudgeRunning(session) && session?.token !== press?.token, runtime.error !== undefined)}</dd>
					<dt className="text-ink-300">Slew Rate</dt>
					<dd className="m-0 truncate text-right">{slewRate?.label || slewRate?.name || 'Driver default'}</dd>
					<dt className="text-ink-300">Camera</dt>
					<dd className="m-0 text-right">{cameraStatus(cameraSession)}</dd>
				</dl>
				{blocker && !press && <p className="m-0 text-xs leading-4 text-ink-300">{blocker}</p>}
				{runtime.error && <p className="m-0 text-xs leading-4 text-danger">{runtime.error}</p>}
			</PanelSection>
		</>
	)
}

interface DirectionButtonProps {
	// Direction the button moves in.
	readonly direction: MountNudgeDirection
	// Press held by this tab, if any.
	readonly press?: Readonly<NudgePress>
	// Whether the button cannot start a press; the button of the press held is never disabled, so its
	// release is always delivered.
	readonly disabled: boolean
}

// Press-and-hold button of one direction. The pointer is captured on press, so the release arrives here
// even when it happens outside the button, and every way the press can end releases it.
function DirectionButton({ direction, press, disabled }: DirectionButtonProps) {
	const held = press?.direction === direction

	function down(event: PointerEvent<HTMLButtonElement>) {
		if (event.button !== 0 || disabled) return
		event.preventDefault()
		event.currentTarget.setPointerCapture(event.pointerId)
		void pressNudge(nudgeRuntime, direction)
	}

	function release() {
		if (held) void releaseNudge(nudgeRuntime)
	}

	return (
		<button
			type="button"
			title={`Hold to move ${NUDGE_DIRECTION_LABELS[direction].toLowerCase()}`}
			disabled={disabled && !held}
			onPointerDown={down}
			onPointerUp={release}
			onPointerCancel={release}
			onLostPointerCapture={release}
			onContextMenu={(event) => event.preventDefault()}
			className={cn(
				'flex h-14 cursor-pointer touch-none items-center justify-center rounded-md border border-line-200 bg-transparent font-mono text-sm font-medium text-ink-100 transition-colors duration-150 select-none hover:border-ink-300 hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-line-100 disabled:text-ink-300 disabled:hover:bg-transparent',
				held && 'border-accent bg-accent-subtle text-accent hover:border-accent hover:bg-accent-subtle',
			)}
		>
			{direction}
		</button>
	)
}

// Returns why no press can start on the mount, or undefined when one can: the role's own problem, an
// unknown or unsuited mount state, or another operation holding the mount. The server checks again.
function nudgeBlocker(roleProblem: string | undefined, state: Readonly<MountState> | undefined, busy: boolean): string | undefined {
	if (roleProblem) return roleProblem
	if (!state) return 'The mount state is not known yet.'
	if (!state.connected) return 'The mount is disconnected.'
	if (!state.canMove) return 'The mount cannot move manually.'
	if (state.parked || state.parking) return 'The mount is parked.'
	if (busy) return BUSY
	return undefined
}

// Text of the movement state: the press of this tab, another tab's nudge, the blocker, the error of the
// latest command or press, or idle.
function movementStatus(press: Readonly<NudgePress> | undefined, blocker: string | undefined, otherNudge: boolean, failed: boolean) {
	if (press?.phase === 'starting') return 'Starting…'
	if (press?.phase === 'moving') return `Moving ${NUDGE_DIRECTION_LABELS[press.direction]}`
	if (press?.phase === 'stopping') return 'Stopping…'
	if (otherNudge) return 'Busy (moved by another tab)'
	if (blocker === BUSY) return 'Busy'
	if (blocker) return 'Unavailable'
	return failed ? 'Error' : 'Idle'
}

// Text of the camera acquisition, read only.
function cameraStatus(session: Readonly<CaptureSession> | undefined) {
	if (!session) return 'Camera idle'
	if (captureRunning(session)) return session.request.exposureMode === 'loop' ? 'Camera loop running' : 'Camera capturing'
	return 'Camera acquisition finished'
}
