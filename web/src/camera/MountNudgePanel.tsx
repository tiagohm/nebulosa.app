import type { CaptureSession, DeviceSummary, MountNudgeDirection, MountState } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, startCommand, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { roleAvailability } from '../equipment/availability'
import { deviceState, ROLE_STATUS_LABELS, switchDevice } from '../equipment/equipment'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import type { RoleDevice } from '../equipment/useEquipment'
import { MISSING } from '../format'
import { operationsState, runningOn } from '../operations'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { useMediaQuery, WIDE_SCREEN } from '../shell/useMediaQuery'
import { formatDeclination, formatRightAscension } from '../sky/format'
import { Button } from '../ui/Button'
import { DataList, DataRow } from '../ui/DataRow'
import { Icon } from '../ui/Icon'
import { Notice } from '../ui/Notice'
import { Select } from '../ui/Select'
import { cameraKey, captureRunning, captureRuntime } from './capture'
import { NUDGE_DIRECTION_LABELS, nudgeDirectionSupported, nudgeKey, type NudgePress, nudgeRunning, nudgeRuntime, pressNudge, releaseNudge, setNudgeSlewRate, stopNudges, watchNudgeMount } from './nudge'
import { AXIS_MAPPING, type NudgeOrientation, PAD_ARROW_ROTATIONS, PAD_CELL_LABELS, PAD_GRID, PAD_KEYS, type PadCell, padMapping, orientationStale } from './nudgepad'

// Contextual panel sections of Mount Nudge, a camera operation of the Images camera tabs:
// press-and-hold manual motion of a mount, named with the camera in the Equipment section (each linked to Equipment
// Control), on a pad of eight cells around a STOP, at a manual speed preset the mount reports, with the state of the
// motion, the mount's tracking and position, and, read only, the camera's acquisition. The mount is the MOUNT of the
// active equipment setup, the one associated with every camera of its connection; a missing one is reported, never
// replaced by another connected mount. With the orientation of a solved frame of the camera (nudgepad.ts), each cell
// moves the field toward that edge of the frame; without one, or once the mount reports another pier side than the
// frame's, the cells follow the mount axes. A cell is held with the pointer, or from the keyboard with Space or Enter on
// it or an arrow key anywhere on the pad. The motion is the server's: a press only lasts while its pointer or key is
// held, and is released when the pointer is lifted or canceled, its capture is lost, the key is lifted, the pad loses
// focus, the window loses focus or is hidden, the mount followed changes (a profile switch), or the panel unmounts,
// which switching tool, camera tab, or workspace does. Why no press can start is said beside the pad, with the one
// action that clears it when there is one (Equipment Setup, Connect, Unpark). The panel never touches the camera: a
// capture keeps running underneath, and the viewer and its reticle stay as they are.

// Why no press can start, in a word for the Movement row and a sentence for the pad, and what clears it.
interface NudgeBlocker {
	// State of the mount in a word.
	readonly word: string
	// Why no press can start.
	readonly reason: string
	// The action that clears it, when the panel offers one.
	readonly remedy?: 'setup' | 'connect' | 'unpark'
}

// Mount a nudge panel moves and the camera whose acquisition it shows.
export interface MountNudgeTarget {
	// Mount and its state.
	readonly mount: RoleDevice
	// Camera whose acquisition is shown, read only.
	readonly camera?: DeviceSummary
	// Orientation of the camera's frames, from a solved frame; absent when none was solved.
	readonly orientation?: NudgeOrientation
}

// Mount Nudge panel sections of a mount.
export function MountNudgeSections({ mount, camera, orientation }: MountNudgeTarget) {
	const runtime = useSnapshot(nudgeRuntime)
	const control = useSnapshot(controlRuntime)
	const operations = useSnapshot(operationsState)
	const captures = useSnapshot(captureRuntime)
	const devices = useSnapshot(deviceState)
	// On a narrow screen the panel is a sheet under the viewer, so the Equipment section starts collapsed and the pad leads.
	const wide = useMediaQuery(WIDE_SCREEN)
	const device = mount.device
	const connectionId = device?.connectionId
	const id = device?.id
	const { press } = runtime
	const state = watchedDeviceState(control, 'mount', runtime.target)
	const session = connectionId && id ? runtime.sessions[nudgeKey(connectionId, id)] : undefined
	const availability = roleAvailability('MOUNT', mount, operations)
	// While a press is held, its own operation holds the mount; only other holders make it busy.
	const holders = connectionId && id ? runningOn(operations, connectionId, id).filter((operation) => operation.operationId !== (session?.token === press?.token ? session?.operationId : undefined)) : []
	const blocker = press ? undefined : nudgeBlocker(mount, availability.status === 'ready' || availability.status === 'busy' ? undefined : availability.message, state, holders.length > 0)
	const cameraSession = camera ? captures.sessions[cameraKey(camera.connectionId, camera.id)] : undefined
	const stale = orientation !== undefined && orientationStale(orientation, state)
	const framed = orientation !== undefined && !stale
	const mapping = framed ? padMapping(orientation) : AXIS_MAPPING
	// Key holding the press started from the keyboard, so only its release ends it.
	const heldKey = useRef<string | undefined>(undefined)
	const otherNudge = nudgeRunning(session) && session?.token !== press?.token

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

	// Why a cell cannot start a press, or undefined when it can; the cell of the press held is never disabled.
	function cellDisabled(direction: MountNudgeDirection): string | undefined {
		if (press?.direction === direction) return undefined
		if (blocker) return blocker.reason
		if (press) return 'Release the direction held first.'
		if (!nudgeDirectionSupported(state, direction)) return `The mount cannot move ${direction.includes('N') || direction.includes('S') ? 'north or south' : 'east or west'}.`
		return undefined
	}

	// Starts a press from a key held down, unless the key repeats, a modifier is held, or the cell is disabled.
	function keyPress(event: KeyboardEvent, direction: MountNudgeDirection) {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
		event.preventDefault()
		if (event.repeat || heldKey.current || cellDisabled(direction)) return
		heldKey.current = event.key
		void pressNudge(nudgeRuntime, direction)
	}

	// Releases a press started from the keyboard.
	function keyRelease() {
		if (!heldKey.current) return
		heldKey.current = undefined
		void releaseNudge(nudgeRuntime)
	}

	// Arrow keys anywhere on the pad hold the cell in their direction. Focus moves to that cell first: the others are
	// disabled while it is held, and a focused cell turning disabled would blur the pad and release the press.
	function padKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const cell = PAD_KEYS[event.key]
		if (!cell || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
		if (!event.repeat && !heldKey.current && !cellDisabled(mapping[cell])) event.currentTarget.querySelector<HTMLButtonElement>(`[data-cell="${cell}"]`)?.focus()
		keyPress(event, mapping[cell])
	}

	function padKeyUp(event: KeyboardEvent<HTMLDivElement>) {
		if (event.key === heldKey.current) keyRelease()
	}

	const stopReason = press || nudgeRunning(session) ? undefined : 'Nothing is moving.'
	const speedReason = blocker?.reason ?? (press ? 'Release the direction held first.' : runtime.sending ? 'Changing the manual speed…' : undefined)

	return (
		<>
			<CollapsibleSection id="images.mount-nudge.equipment" title="Equipment" summary={device?.name ?? (mount.status === 'notSelected' ? 'No mount' : undefined)} defaultOpen={wide}>
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={camera} />
					</DataRow>
					<DataRow label="Mount">
						<DeviceLink device={device} fallback={mount.status === 'notSelected' ? 'None selected' : 'Unavailable'} />
					</DataRow>
				</DataList>
			</CollapsibleSection>
			<CollapsibleSection id="images.mount-nudge.manual-movement" title="Manual Movement">
				<div className="grid grid-cols-3 gap-3" onKeyDown={padKeyDown} onKeyUp={padKeyUp} onBlur={keyRelease}>
					{PAD_GRID.map((cell) =>
						cell === 'STOP' ? (
							<button
								key={cell}
								type="button"
								title={stopReason ?? 'Stop manual movement'}
								disabled={stopReason !== undefined}
								onClick={() => void stopNudges(nudgeRuntime)}
								className="flex h-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border border-danger bg-transparent text-sm font-medium text-danger transition-colors duration-150 select-none hover:bg-danger/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:border-transparent disabled:bg-base-300 disabled:text-ink-300 disabled:hover:bg-base-300 motion-reduce:transition-none"
							>
								<Icon name="stop" className="size-4" />
								STOP
							</button>
						) : (
							<DirectionButton key={cell} cell={cell} direction={mapping[cell]} framed={framed} press={press} disabled={cellDisabled(mapping[cell])} onKeyPress={keyPress} onKeyRelease={keyRelease} />
						),
					)}
				</div>
				{blocker ? (
					<>
						<Notice warning={blocker.remedy !== undefined}>{blocker.reason}</Notice>
						<NudgeRemedy blocker={blocker} mount={device} connecting={id !== undefined && devices.pending[id] === 'connect'} parking={state?.parking === true} />
					</>
				) : (
					<Notice>{padNote(framed, stale)}</Notice>
				)}
				{slewRates.length > 0 ? (
					<Select
						label="Manual Speed"
						options={slewRates.map((rate) => rate.name)}
						value={slewRate?.name ?? slewRates[0].name}
						format={(name) => slewRates.find((rate) => rate.name === name)?.label || name}
						disabled={speedReason !== undefined}
						title={speedReason}
						onChange={(name) => void setNudgeSlewRate(nudgeRuntime, name)}
					/>
				) : (
					state?.connected && <Notice>The driver offers no manual speed choice; it moves at its own rate.</Notice>
				)}
			</CollapsibleSection>
			<CollapsibleSection id="images.mount-nudge.movement-status" title="Movement Status" summary={movementStatus(press, blocker, otherNudge, runtime.error !== undefined)}>
				<DataList>
					<DataRow label="Movement" tone={runtime.error && !press ? 'danger' : undefined}>
						{movementStatus(press, blocker, otherNudge, runtime.error !== undefined)}
					</DataRow>
					<DataRow label="Tracking" tone={state?.connected && !state.parked && !state.tracking ? 'warning' : undefined}>
						{state?.connected ? (state.tracking ? 'On' : 'Off') : MISSING}
					</DataRow>
					<DataRow label="RA (JNow)">{state?.connected ? formatRightAscension(state.rightAscension) : MISSING}</DataRow>
					<DataRow label="Dec (JNow)">{state?.connected ? formatDeclination(state.declination) : MISSING}</DataRow>
					<DataRow label="Camera">{cameraStatus(cameraSession)}</DataRow>
				</DataList>
				{!blocker && !captureRunning(cameraSession) && <Notice>Start a loop in Acquisition to watch the field move; it keeps running when you come back here.</Notice>}
				{runtime.error && <Notice error>{runtime.error}</Notice>}
			</CollapsibleSection>
		</>
	)
}

interface DirectionButtonProps {
	// Place of the cell on the pad.
	readonly cell: PadCell
	// Direction the cell moves the mount in.
	readonly direction: MountNudgeDirection
	// Whether the cell moves by the orientation of a solved frame rather than by the mount axes.
	readonly framed: boolean
	// Press held by this tab, if any.
	readonly press?: Readonly<NudgePress>
	// Why the button cannot start a press, or undefined when it can; the button of the press held is never disabled,
	// so its release is always delivered.
	readonly disabled?: string
	// Starts a press from a key held on the cell (Space or Enter).
	readonly onKeyPress: (event: KeyboardEvent, direction: MountNudgeDirection) => void
	// Releases a press started from the keyboard.
	readonly onKeyRelease: () => void
}

// Press-and-hold button of one cell. The pointer is captured on press, so the release arrives here even when it
// happens outside the button, and every way the press can end releases it; Space and Enter hold it from the keyboard.
function DirectionButton({ cell, direction, framed, press, disabled, onKeyPress, onKeyRelease }: DirectionButtonProps) {
	const held = press?.direction === direction
	const name = NUDGE_DIRECTION_LABELS[direction].toLowerCase()

	function down(event: PointerEvent<HTMLButtonElement>) {
		if (event.button !== 0 || disabled) return
		event.preventDefault()
		event.currentTarget.setPointerCapture(event.pointerId)
		void pressNudge(nudgeRuntime, direction)
	}

	function release() {
		if (held) void releaseNudge(nudgeRuntime)
	}

	function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
		if (event.key !== ' ' && event.key !== 'Enter') return
		event.stopPropagation()
		onKeyPress(event, direction)
	}

	function keyUp(event: KeyboardEvent<HTMLButtonElement>) {
		if (event.key !== ' ' && event.key !== 'Enter') return
		event.preventDefault()
		onKeyRelease()
	}

	return (
		<button
			type="button"
			data-cell={cell}
			title={disabled ?? (framed ? `Hold to move the field ${PAD_CELL_LABELS[cell]} (${name})` : `Hold to move ${name}`)}
			disabled={disabled !== undefined && !held}
			onPointerDown={down}
			onPointerUp={release}
			onPointerCancel={release}
			onLostPointerCapture={release}
			onKeyDown={keyDown}
			onKeyUp={keyUp}
			onContextMenu={(event) => event.preventDefault()}
			className={cn(
				'flex h-14 cursor-pointer touch-none flex-col items-center justify-center gap-0.5 rounded-md border border-line-200 bg-transparent font-mono text-sm font-medium text-ink-100 transition-colors duration-150 select-none hover:border-ink-300 hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-transparent disabled:bg-base-300 disabled:text-ink-300 disabled:hover:border-transparent motion-reduce:transition-none',
				held && 'border-accent bg-accent-subtle text-accent hover:border-accent hover:bg-accent-subtle',
			)}
		>
			{framed ? (
				<>
					<Icon name="arrow" className={cn('size-4', PAD_ARROW_ROTATIONS[cell])} />
					<span className={cn('text-xs leading-none', held ? 'text-accent' : 'text-ink-300')}>{direction}</span>
				</>
			) : (
				direction
			)}
		</button>
	)
}

interface NudgeRemedyProps {
	// Why no press can start.
	readonly blocker: NudgeBlocker
	// Mount the panel moves; absent when none is selected or available.
	readonly mount?: DeviceSummary
	// Whether the mount is being connected.
	readonly connecting: boolean
	// Whether the mount is parking.
	readonly parking: boolean
}

// The one action that clears why no press can start: Equipment Setup without a mount, Connect for a disconnected
// mount, Unpark for a parked one; nothing otherwise.
function NudgeRemedy({ blocker, mount, connecting, parking }: NudgeRemedyProps) {
	switch (blocker.remedy) {
		case 'setup':
			return <EquipmentSetupButton />
		case 'connect':
			return (
				mount && (
					<Button variant="secondary" className="self-start" disabled={connecting} title={connecting ? 'Connecting…' : undefined} onClick={() => void switchDevice(deviceState, mount.id, true)}>
						{connecting ? 'Connecting…' : 'Connect'}
					</Button>
				)
			)
		case 'unpark':
			return (
				mount && (
					<Button variant="secondary" className="self-start" disabled={parking} title={parking ? 'Wait until the mount is parked.' : undefined} onClick={() => void startCommand(controlRuntime, { type: 'mount', deviceId: mount.id, action: 'unpark', label: 'Unpark' })}>
						Unpark
					</Button>
				)
			)
		default:
			return null
	}
}

// Returns the note under the pad while a press can start: how to move, and by what the cells move.
function padNote(framed: boolean, stale: boolean) {
	if (framed) return 'Hold a cell, or press an arrow key, to move the field toward that edge of the frame; release to stop. The cells follow the latest solved frame of this camera; solve again after turning the camera.'
	if (stale) return 'Hold a cell, or press an arrow key, to move; release to stop. The mount changed its pier side since the frame was solved, so the cells follow the mount axes; solve a new frame to move by the image.'
	return 'Hold a cell, or press an arrow key, to move; release to stop. The cells follow the mount axes, not the image; solve a frame to move by the image.'
}

// Returns why no press can start on the mount, or undefined when one can: the role's own problem, an unknown or
// unsuited mount state, or another operation holding the mount. The server checks again.
function nudgeBlocker(mount: Pick<RoleDevice, 'status'>, roleProblem: string | undefined, state: Readonly<MountState> | undefined, busy: boolean): NudgeBlocker | undefined {
	if (roleProblem) return { word: ROLE_STATUS_LABELS[mount.status], reason: roleProblem, ...(mount.status === 'notSelected' ? { remedy: 'setup' } : mount.status === 'disconnected' ? { remedy: 'connect' } : {}) }
	if (!state) return { word: 'Unknown', reason: 'The mount state is not known yet.' }
	if (!state.connected) return { word: 'Disconnected', reason: 'The mount is disconnected.', remedy: 'connect' }
	if (!state.canMove) return { word: 'Cannot move', reason: 'The mount cannot move manually.' }
	if (state.parking) return { word: 'Parking', reason: 'The mount is parking.' }
	if (state.parked) return { word: 'Parked', reason: 'The mount is parked.', ...(state.canPark && { remedy: 'unpark' }) }
	if (busy) return { word: 'Busy', reason: 'The mount is busy with another operation; its Abort is in the status bar.' }
	return undefined
}

// Text of the movement state: the press of this tab, another tab's nudge, the blocker, the error of the
// latest command or press, or idle.
function movementStatus(press: Readonly<NudgePress> | undefined, blocker: NudgeBlocker | undefined, otherNudge: boolean, failed: boolean) {
	if (press?.phase === 'starting') return 'Starting…'
	if (press?.phase === 'moving') return `Moving ${NUDGE_DIRECTION_LABELS[press.direction]}`
	if (press?.phase === 'stopping') return 'Stopping…'
	if (otherNudge) return 'Moved by another tab'
	if (blocker) return blocker.word
	return failed ? 'Error' : 'Idle'
}

// Text of the camera acquisition, read only.
function cameraStatus(session: Readonly<CaptureSession> | undefined) {
	if (!session) return 'Idle'
	if (captureRunning(session)) return session.request.exposureMode === 'loop' ? 'Looping' : 'Capturing'
	return 'Finished'
}
