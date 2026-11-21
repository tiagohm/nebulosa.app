import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { controlRuntime, deviceStateOf, sendCommand, startCommand } from '../control'
import { useDraft } from '../draft'
import { slotLabel } from '../lexicon'
import { CollapsedSection, type InterfaceProps } from '../parts'
import { firstReason, useBusyReason } from '../useControl'

// Controls of a filter wheel: a change to another slot sent only by an explicit action, its target following the
// reported filter until another one is chosen; then, collapsed, the renaming of the slots when the driver allows it.
// Its filter is in the header of the device. Slots are 0-based in the API and shown from 1; a slot without a name is
// shown as "Slot n", never as an invented filter.

// Controls of a filter wheel.
export function FilterWheelControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const wheel = deviceStateOf(control.states, 'wheel', device.id)!
	const target = useDraft(String(wheel.position))
	const [names, setNames] = useState<string[]>()
	const busy = useBusyReason(device)
	const slots = Array.from({ length: wheel.count }, (_, slot) => String(slot))
	const slot = Number(target.value)
	const blocked = firstReason(busy, wheel.moving && 'Wait until the filter change ends')
	const changeReason = firstReason(blocked, !target.edited && 'Choose a filter other than the current one')

	// Saves the names typed, then closes the editor.
	async function saveNames(edited: readonly string[]) {
		if (await sendCommand(controlRuntime, { type: 'wheel', deviceId: device.id, action: 'names', label: 'Rename', body: { names: edited.map((name) => name.trim()) } })) setNames(undefined)
	}

	return (
		<>
			<PanelSection title="Filter Wheel">
				<DataRow label="Slots">{wheel.count}</DataRow>
				{wheel.count > 0 && (
					<div className="flex items-end gap-2">
						<Select label="Target filter" options={slots} value={slots.includes(target.value) ? target.value : slots[0]} format={(value) => slotLabel(wheel, Number(value))} onChange={target.set} />
						<Button
							disabled={!!changeReason}
							title={changeReason}
							onClick={() => {
								void startCommand(controlRuntime, { type: 'wheel', deviceId: device.id, action: 'move', label: `Change to ${slotLabel(wheel, slot)}`, body: { slot } })
								target.reset()
							}}
						>
							Change Filter
						</Button>
					</div>
				)}
				<Notice>A filter wheel cannot be stopped once moving; a change always completes.</Notice>
			</PanelSection>
			{wheel.canSetNames && (
				<CollapsedSection title="Filter Names" open={names !== undefined || undefined}>
					{names ? (
						<>
							{names.map((name, index) => (
								<TextInput key={index} label={`Slot ${index + 1}`} value={name} onChange={(e) => setNames(names.map((n, i) => (i === index ? e.target.value : n)))} />
							))}
							<Actions>
								<Button variant="secondary" onClick={() => setNames(undefined)}>
									Cancel
								</Button>
								<Button disabled={!!blocked} title={blocked} onClick={() => void saveNames(names)}>
									Save Names
								</Button>
							</Actions>
						</>
					) : (
						<>
							{Array.from({ length: wheel.count }, (_, index) => (
								<DataRow key={index} label={`Slot ${index + 1}`}>
									{wheel.names[index]?.trim() || 'No name'}
								</DataRow>
							))}
							<Actions>
								<Button variant="secondary" disabled={wheel.count === 0} title={wheel.count === 0 ? 'The wheel reports no slot' : undefined} onClick={() => setNames(Array.from({ length: wheel.count }, (_, index) => wheel.names[index] ?? ''))}>
									Edit Names
								</Button>
							</Actions>
						</>
					)}
				</CollapsedSection>
			)}
		</>
	)
}
