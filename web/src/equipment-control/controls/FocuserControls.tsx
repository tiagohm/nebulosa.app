import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatTemperature } from '../../format'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { controlRuntime, deviceStateOf, sendCommand, startCommand } from '../control'
import { useDraft } from '../draft'
import { focuserBacklashKey, focuserBacklashRuntime } from '../focuserBacklash'
import { CollapsedSection, type InterfaceProps } from '../parts'
import { firstReason, useBusyReason } from '../useControl'
import { FocuserBacklash } from './FocuserBacklash'

// Controls of a focuser: its range and temperature, a move to a position, and a move by a number of steps inward or
// outward; then, collapsed, the sync of the position counter, the motion direction, and the backlash compensation. Its
// position and the stop of its motion are in the header of the device. Limits come from what the focuser reports; the
// target and sync fields follow the reported position until edited, so a move never starts from a stale value, and the
// numbers typed are only requests until the focuser reports them. Positions to move to are logical: with an ABSOLUTE
// compensation the reported position differs from them by the offset the server publishes.

// Steps of a relative move when the panel opens.
const DEFAULT_STEPS = 100

// Controls of a focuser.
export function FocuserControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const focuser = deviceStateOf(control.states, 'focuser', device.id)!
	const { position } = focuser
	const backlash = useSnapshot(focuserBacklashRuntime).states[focuserBacklashKey(focuser.connectionId, focuser.id)]
	const offset = backlash?.offset ?? 0
	const logical = position.value - offset
	const target = useDraft(logical)
	const sync = useDraft(position.value)
	const [steps, setSteps] = useState(DEFAULT_STEPS)
	const busy = useBusyReason(device)
	const step = position.step > 0 ? position.step : 1
	const blocked = firstReason(busy, focuser.moving && 'Wait until the focuser stops moving')
	const moveToReason = firstReason(blocked, !target.edited && 'Enter a target position other than the current one')
	const relativeReason = firstReason(blocked, !(steps > 0) && 'Enter a number of steps above 0')
	const syncReason = firstReason(blocked, !sync.edited && 'Enter the position the focuser should report')

	function move(action: string, label: string, body: object) {
		void startCommand(controlRuntime, { type: 'focuser', deviceId: device.id, action, label, body })
	}

	// Syncs the position counter on a position, then lets the field follow the reported position again.
	async function syncTo(value: number) {
		if (await sendCommand(controlRuntime, { type: 'focuser', deviceId: device.id, action: 'sync', label: 'Sync', body: { position: value } })) sync.reset()
	}

	return (
		<>
			<PanelSection title="Focuser">
				<DataRow label="Range">{`${position.min}–${position.max} steps`}</DataRow>
				{offset !== 0 && <DataRow label="Reported position">{`${position.value} steps`}</DataRow>}
				{focuser.temperature !== undefined && <DataRow label="Temperature">{formatTemperature(focuser.temperature)}</DataRow>}
				{focuser.canAbsoluteMove && (
					<div className="flex items-end gap-2">
						<NumberInput className="min-w-0 flex-1" label="Target position" value={target.value} min={position.min} max={position.max} step={step} suffix="steps" onChange={target.set} />
						<Button
							disabled={!!moveToReason}
							title={moveToReason}
							onClick={() => {
								move('move-to', 'Move To', { position: target.value })
								target.reset()
							}}
						>
							Move To
						</Button>
					</div>
				)}
				{(focuser.canRelativeMove || focuser.canAbsoluteMove) && (
					<div className="flex items-end gap-2">
						<NumberInput className="min-w-0 flex-1" label="Relative move" value={steps} min={1} max={position.max - position.min || undefined} step={step} suffix="steps" onChange={setSteps} />
						<Button variant="secondary" disabled={!!relativeReason} title={relativeReason} onClick={() => move('move', 'Move In', { direction: 'IN', steps })}>
							Move In
						</Button>
						<Button variant="secondary" disabled={!!relativeReason} title={relativeReason} onClick={() => move('move', 'Move Out', { direction: 'OUT', steps })}>
							Move Out
						</Button>
					</div>
				)}
				{!focuser.canAbort && <Notice>This focuser cannot be stopped once moving.</Notice>}
			</PanelSection>
			{(focuser.canSync || focuser.canReverse) && (
				<CollapsedSection title="Configuration" summary={focuser.canReverse && focuser.reversed ? 'Reversed' : undefined}>
					{focuser.canSync && (
						<div className="flex items-end gap-2">
							<NumberInput className="min-w-0 flex-1" label="Sync position" value={sync.value} min={position.min} max={position.max} step={step} suffix="steps" onChange={sync.set} />
							<ConfirmButton
								title="Sync the focuser?"
								message={`The focuser will report position ${sync.value} where it stands now, without moving. Positions stored for this focuser, such as focus points, no longer match afterwards.`}
								confirmLabel="Sync"
								disabled={!!syncReason}
								tooltip={syncReason}
								onConfirm={() => void syncTo(sync.value)}
							>
								Sync
							</ConfirmButton>
						</div>
					)}
					{focuser.canReverse && <Checkbox label="Reverse motion" checked={focuser.reversed} disabled={!!blocked} title={blocked} onChange={(enabled) => void sendCommand(controlRuntime, { type: 'focuser', deviceId: device.id, action: 'reverse', label: 'Reverse', body: { enabled } })} />}
				</CollapsedSection>
			)}
			<FocuserBacklash focuser={focuser} />
		</>
	)
}
