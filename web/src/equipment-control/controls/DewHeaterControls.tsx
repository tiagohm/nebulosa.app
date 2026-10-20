import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { Slider } from '../../ui/Slider'
import { controlRuntime, deviceStateOf, sendCommand } from '../control'
import { Actions, type InterfaceProps, Notice, Readout } from '../parts'

// Controls of a dew heater: its duty cycle as reported, and a pending duty cycle sent only with Apply, so
// dragging the slider never sends a stream of commands.

// Controls of a dew heater.
export function DewHeaterControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const heater = deviceStateOf(control.states, 'dewHeater', device.id)!
	const { dutyCycle } = heater
	const [pending, setPending] = useState<number>()
	const busy = control.pending[device.id] !== undefined
	const value = pending ?? dutyCycle.value
	const step = dutyCycle.step > 0 ? dutyCycle.step : 1

	if (!heater.hasDewHeater) {
		return (
			<PanelSection title="Dew Heater">
				<Notice>The device no longer reports a heater channel.</Notice>
			</PanelSection>
		)
	}

	async function apply() {
		if (pending !== undefined && (await sendCommand(controlRuntime, { type: 'dewHeater', deviceId: device.id, action: 'duty-cycle', label: 'Duty cycle', body: { value: pending } }))) setPending(undefined)
	}

	return (
		<PanelSection title="Dew Heater">
			<Readout label="Duty cycle">{`${dutyCycle.value} of ${dutyCycle.min}–${dutyCycle.max}`}</Readout>
			<Slider label="Duty cycle" value={value} min={dutyCycle.min} max={dutyCycle.max} step={step} onChange={setPending} />
			<Actions>
				{pending !== undefined && (
					<Button variant="secondary" onClick={() => setPending(undefined)}>
						Discard
					</Button>
				)}
				<Button disabled={busy || pending === undefined || pending === dutyCycle.value} onClick={() => void apply()}>
					Apply Duty Cycle
				</Button>
			</Actions>
		</PanelSection>
	)
}
