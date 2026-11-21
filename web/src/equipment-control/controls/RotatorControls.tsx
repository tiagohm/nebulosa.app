import { useState } from 'react'
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
import { useDraft } from '../draft'
import { CollapsedSection, type InterfaceProps } from '../parts'
import { firstReason, useBusyReason } from '../useControl'

// Controls of a field rotator: its range, a move to an angle or by an angle that decreases or increases it, and a move
// home; then, collapsed, the sync of the angle and the rotation direction. Its mechanical angle and the stop of its
// motion are in the header of the device. The mechanical angle is not the position angle of the image on the sky; the
// server keeps targets inside the range the driver publishes. The target and sync fields follow the reported angle
// until edited, so a move never starts from a stale value.

// Rotation of a relative move when the panel opens, in degrees.
const DEFAULT_DELTA = 10

// Controls of a rotator.
export function RotatorControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const rotator = deviceStateOf(control.states, 'rotator', device.id)!
	const { angle } = rotator
	const target = useDraft(angle.value)
	const sync = useDraft(angle.value)
	const [delta, setDelta] = useState(DEFAULT_DELTA)
	const busy = useBusyReason(device)
	const blocked = firstReason(busy, rotator.moving && 'Wait until the rotator stops moving')
	const moveToReason = firstReason(blocked, !target.edited && 'Enter a target angle other than the current one')
	const relativeReason = firstReason(blocked, delta === 0 && 'Enter an angle other than 0°')
	const syncReason = firstReason(blocked, !sync.edited && 'Enter the angle the rotator should report')
	const step = angle.step > 0 ? angle.step : 0.1

	function move(action: string, label: string, body?: object) {
		void startCommand(controlRuntime, { type: 'rotator', deviceId: device.id, action, label, body })
	}

	// Syncs the angle, then lets the field follow the reported angle again.
	async function syncTo(value: number) {
		if (await sendCommand(controlRuntime, { type: 'rotator', deviceId: device.id, action: 'sync', label: 'Sync', body: { angle: value } })) sync.reset()
	}

	return (
		<>
			<PanelSection title="Rotator">
				<DataRow label="Range">{`${angle.min}° to ${angle.max}°`}</DataRow>
				<div className="flex items-end gap-2">
					<NumberInput className="min-w-0 flex-1" label="Target angle" value={target.value} min={angle.min} max={angle.max} step={step} suffix="°" onChange={target.set} />
					<Button
						disabled={!!moveToReason}
						title={moveToReason}
						onClick={() => {
							move('move-to', 'Move To', { angle: target.value })
							target.reset()
						}}
					>
						Move To
					</Button>
				</div>
				<div className="flex flex-wrap items-end gap-2">
					<NumberInput className="min-w-32 flex-1" label="Relative move" value={delta} step={step} suffix="°" onChange={setDelta} />
					<div className="flex gap-2">
						<Button variant="secondary" disabled={!!relativeReason} title={relativeReason ?? `Decrease the angle by ${delta}°`} onClick={() => move('move-by', 'Decrease angle', { delta: -delta })}>
							Decrease
						</Button>
						<Button variant="secondary" disabled={!!relativeReason} title={relativeReason ?? `Increase the angle by ${delta}°`} onClick={() => move('move-by', 'Increase angle', { delta })}>
							Increase
						</Button>
					</div>
				</div>
				{rotator.canHome && (
					<Actions>
						<Button variant="secondary" disabled={!!blocked} title={blocked} onClick={() => move('home', 'Go Home')}>
							Go Home
						</Button>
					</Actions>
				)}
				<Notice>The mechanical angle is not the position angle of the image on the sky.</Notice>
			</PanelSection>
			{(rotator.canSync || rotator.canReverse) && (
				<CollapsedSection title="Configuration" summary={rotator.canReverse && rotator.reversed ? 'Reversed' : undefined}>
					{rotator.canSync && (
						<div className="flex items-end gap-2">
							<NumberInput className="min-w-0 flex-1" label="Sync angle" value={sync.value} min={angle.min} max={angle.max} step={step} suffix="°" onChange={sync.set} />
							<ConfirmButton title="Sync the rotator?" message={`The rotator will report ${sync.value}° where it stands now, without moving. Angles stored for framing no longer match afterwards.`} confirmLabel="Sync" disabled={!!syncReason} tooltip={syncReason} onConfirm={() => void syncTo(sync.value)}>
								Sync
							</ConfirmButton>
						</div>
					)}
					{rotator.canReverse && <Checkbox label="Reverse rotation" checked={rotator.reversed} disabled={!!blocked} title={blocked} onChange={(enabled) => void sendCommand(controlRuntime, { type: 'rotator', deviceId: device.id, action: 'reverse', label: 'Reverse', body: { enabled } })} />}
				</CollapsedSection>
			)}
		</>
	)
}
