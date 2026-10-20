import type { WheelState } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { controlRuntime, deviceStateOf, sendCommand, startCommand } from '../control'
import { Actions, type InterfaceProps, Notice, Readout } from '../parts'

// Controls of a filter wheel: the filter it reports, a change to another slot sent only by an explicit
// action, and the renaming of the slots when the driver allows it. Slots are 0-based in the API and shown
// from 1; a slot without a name is shown as "Slot n", never as an invented filter.

// Returns the display name of a 0-based slot: its number from 1 and its filter name, if any.
export function slotLabel(wheel: Pick<WheelState, 'names'>, slot: number) {
	const name = wheel.names[slot]?.trim()
	return name ? `${slot + 1} · ${name}` : `Slot ${slot + 1}`
}

// Controls of a filter wheel.
export function FilterWheelControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const wheel = deviceStateOf(control.states, 'wheel', device.id)!
	const [target, setTarget] = useState(String(wheel.position))
	const [names, setNames] = useState<string[]>()
	const busy = control.pending[device.id] !== undefined
	const slots = Array.from({ length: wheel.count }, (_, slot) => String(slot))
	const slot = Number(target)

	return (
		<PanelSection title="Filter Wheel">
			<Readout label="Filter">{wheel.count > 0 ? slotLabel(wheel, wheel.position) : 'Unknown'}</Readout>
			<Readout label="State">{wheel.moving ? 'Moving' : 'Idle'}</Readout>
			<Readout label="Slots">{wheel.count}</Readout>
			{wheel.count > 0 && (
				<div className="flex items-end gap-2">
					<Select className="min-w-0 flex-1" label="Target filter" options={slots} value={slots.includes(target) ? target : slots[0]} format={(value) => slotLabel(wheel, Number(value))} onChange={setTarget} />
					<Button disabled={busy || wheel.moving || slot === wheel.position} onClick={() => void startCommand(controlRuntime, { type: 'wheel', deviceId: device.id, action: 'move', label: 'Change Filter', body: { slot } })}>
						Change Filter
					</Button>
				</div>
			)}
			<Notice>A filter wheel cannot be stopped once moving; a change always completes.</Notice>
			{wheel.canSetNames &&
				(names ? (
					<>
						{names.map((name, index) => (
							<TextInput key={index} label={`Slot ${index + 1}`} value={name} onChange={(e) => setNames(names.map((n, i) => (i === index ? e.target.value : n)))} />
						))}
						<Actions>
							<Button variant="secondary" onClick={() => setNames(undefined)}>
								Cancel
							</Button>
							<Button
								disabled={busy || wheel.moving}
								onClick={async () => {
									if (await sendCommand(controlRuntime, { type: 'wheel', deviceId: device.id, action: 'names', label: 'Rename', body: { names: names.map((name) => name.trim()) } })) setNames(undefined)
								}}
							>
								Save Names
							</Button>
						</Actions>
					</>
				) : (
					<Actions>
						<Button variant="ghost" disabled={wheel.count === 0} onClick={() => setNames(Array.from({ length: wheel.count }, (_, slot) => wheel.names[slot] ?? ''))}>
							Edit Names
						</Button>
					</Actions>
				))}
		</PanelSection>
	)
}
