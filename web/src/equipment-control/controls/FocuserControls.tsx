import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { NumberInput } from '../../ui/NumberInput'
import { controlRuntime, deviceStateOf, sendCommand, startCommand, stopCommand } from '../control'
import { Actions, ConfirmButton, type InterfaceProps, Notice, Readout } from '../parts'

// Controls of a focuser: its reported position and temperature, a move to a position, a move by a number
// of steps inward or outward, a stop, a sync of the position counter, and the motion direction. Limits come
// from what the focuser reports; the numbers typed here are only requests until the focuser reports them.

// Steps of a relative move when the panel opens.
const DEFAULT_STEPS = 100

// Controls of a focuser.
export function FocuserControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const focuser = deviceStateOf(control.states, 'focuser', device.id)!
	const { position } = focuser
	const [target, setTarget] = useState(position.value)
	const [steps, setSteps] = useState(DEFAULT_STEPS)
	const [sync, setSync] = useState(position.value)
	const busy = control.pending[device.id] !== undefined
	const step = position.step > 0 ? position.step : 1

	function move(action: string, label: string, body: object) {
		void startCommand(controlRuntime, { type: 'focuser', deviceId: device.id, action, label, body })
	}

	return (
		<PanelSection title="Focuser">
			<Readout label="Position">{`${position.value} of ${position.min}–${position.max} steps`}</Readout>
			<Readout label="State">{focuser.moving ? 'Moving' : 'Idle'}</Readout>
			{focuser.temperature !== undefined && <Readout label="Temperature">{`${focuser.temperature.toFixed(1)} °C`}</Readout>}
			{focuser.moving && focuser.canAbort && (
				<Actions>
					<Button onClick={() => void stopCommand(controlRuntime, { type: 'focuser', deviceId: device.id, action: 'stop' })}>Stop</Button>
				</Actions>
			)}
			{focuser.canAbsoluteMove && (
				<div className="flex items-end gap-2">
					<NumberInput className="min-w-0 flex-1" label="Target position" value={target} min={position.min} max={position.max} step={step} suffix="steps" onChange={setTarget} />
					<Button disabled={busy || focuser.moving || target === position.value} onClick={() => move('move-to', 'Move To', { position: target })}>
						Move To
					</Button>
				</div>
			)}
			{(focuser.canRelativeMove || focuser.canAbsoluteMove) && (
				<div className="flex items-end gap-2">
					<NumberInput className="min-w-0 flex-1" label="Relative move" value={steps} min={1} max={position.max - position.min || undefined} step={step} suffix="steps" onChange={setSteps} />
					<Button variant="secondary" disabled={busy || focuser.moving || !(steps > 0)} onClick={() => move('move', 'Move In', { direction: 'IN', steps })}>
						Move In
					</Button>
					<Button variant="secondary" disabled={busy || focuser.moving || !(steps > 0)} onClick={() => move('move', 'Move Out', { direction: 'OUT', steps })}>
						Move Out
					</Button>
				</div>
			)}
			{focuser.canSync && (
				<div className="flex items-end gap-2">
					<NumberInput className="min-w-0 flex-1" label="Sync position" value={sync} min={position.min} max={position.max} step={step} suffix="steps" onChange={setSync} />
					<ConfirmButton
						title="Sync the focuser?"
						message={`The focuser will report position ${sync} where it stands now, without moving. Positions stored for this focuser, such as focus points, no longer match afterwards.`}
						confirmLabel="Sync"
						disabled={busy || focuser.moving}
						onConfirm={() => void sendCommand(controlRuntime, { type: 'focuser', deviceId: device.id, action: 'sync', label: 'Sync', body: { position: sync } })}
					>
						Sync
					</ConfirmButton>
				</div>
			)}
			{focuser.canReverse && <Checkbox label="Reverse motion" checked={focuser.reversed} disabled={busy || focuser.moving} onChange={(enabled) => void sendCommand(controlRuntime, { type: 'focuser', deviceId: device.id, action: 'reverse', label: 'Reverse', body: { enabled } })} />}
			{!focuser.canAbort && <Notice>This focuser cannot be stopped once moving.</Notice>}
		</PanelSection>
	)
}
