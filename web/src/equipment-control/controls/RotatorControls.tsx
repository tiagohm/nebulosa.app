import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { NumberInput } from '../../ui/NumberInput'
import { controlRuntime, deviceStateOf, sendCommand, startCommand, stopCommand } from '../control'
import { Actions, ConfirmButton, type InterfaceProps, Notice, Readout } from '../parts'

// Controls of a field rotator: its reported mechanical angle and range, a move to an angle or by an angle,
// a move home, a stop, a sync of the angle, and the rotation direction. The mechanical angle is not the
// position angle of the image on the sky; the server keeps targets inside the range the driver publishes.

// Rotation of a relative move when the panel opens, in degrees.
const DEFAULT_DELTA = 10

// Controls of a rotator.
export function RotatorControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const rotator = deviceStateOf(control.states, 'rotator', device.id)!
	const { angle } = rotator
	const [target, setTarget] = useState(angle.value)
	const [delta, setDelta] = useState(DEFAULT_DELTA)
	const [sync, setSync] = useState(angle.value)
	const busy = control.pending[device.id] !== undefined
	const blocked = busy || rotator.moving
	const step = angle.step > 0 ? angle.step : 0.1

	function move(action: string, label: string, body?: object) {
		void startCommand(controlRuntime, { type: 'rotator', deviceId: device.id, action, label, body })
	}

	return (
		<PanelSection title="Rotator">
			<Readout label="Mechanical angle">{`${angle.value.toFixed(2)}°`}</Readout>
			<Readout label="Range">{`${angle.min}° to ${angle.max}°`}</Readout>
			<Readout label="State">{rotator.moving ? 'Moving' : 'Idle'}</Readout>
			{rotator.moving && rotator.canAbort && (
				<Actions>
					<Button onClick={() => void stopCommand(controlRuntime, { type: 'rotator', deviceId: device.id, action: 'stop' })}>Stop</Button>
				</Actions>
			)}
			<div className="flex items-end gap-2">
				<NumberInput className="min-w-0 flex-1" label="Target angle" value={target} min={angle.min} max={angle.max} step={step} suffix="°" onChange={setTarget} />
				<Button disabled={blocked} onClick={() => move('move-to', 'Move To', { angle: target })}>
					Move To
				</Button>
			</div>
			<div className="flex items-end gap-2">
				<NumberInput className="min-w-0 flex-1" label="Relative move" value={delta} step={step} suffix="°" onChange={setDelta} />
				<Button variant="secondary" disabled={blocked || delta === 0} onClick={() => move('move-by', 'Rotate', { delta: -delta })}>
					−
				</Button>
				<Button variant="secondary" disabled={blocked || delta === 0} onClick={() => move('move-by', 'Rotate', { delta })}>
					+
				</Button>
			</div>
			{rotator.canHome && (
				<Actions>
					{rotator.canHome && (
						<Button variant="secondary" disabled={blocked} onClick={() => move('home', 'Go Home')}>
							Go Home
						</Button>
					)}
				</Actions>
			)}
			{rotator.canSync && (
				<div className="flex items-end gap-2">
					<NumberInput className="min-w-0 flex-1" label="Sync angle" value={sync} min={angle.min} max={angle.max} step={step} suffix="°" onChange={setSync} />
					<ConfirmButton
						title="Sync the rotator?"
						message={`The rotator will report ${sync}° where it stands now, without moving. Angles stored for framing no longer match afterwards.`}
						confirmLabel="Sync"
						disabled={blocked}
						onConfirm={() => void sendCommand(controlRuntime, { type: 'rotator', deviceId: device.id, action: 'sync', label: 'Sync', body: { angle: sync } })}
					>
						Sync
					</ConfirmButton>
				</div>
			)}
			{rotator.canReverse && <Checkbox label="Reverse rotation" checked={rotator.reversed} disabled={blocked} onChange={(enabled) => void sendCommand(controlRuntime, { type: 'rotator', deviceId: device.id, action: 'reverse', label: 'Reverse', body: { enabled } })} />}
			<Notice>The mechanical angle is not the position angle of the image on the sky.</Notice>
		</PanelSection>
	)
}
