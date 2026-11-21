import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { Slider } from '../../ui/Slider'
import { controlRuntime, deviceStateOf, sendCommand } from '../control'
import type { InterfaceProps } from '../parts'
import { firstReason, useBusyReason } from '../useControl'

// Controls of a dew heater: a pending duty cycle sent only with Apply, so dragging the slider never sends a stream of
// commands; the duty cycle it reports is in the header of the device.

// Controls of a dew heater.
export function DewHeaterControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const heater = deviceStateOf(control.states, 'dewHeater', device.id)!
	const { dutyCycle } = heater
	const [pending, setPending] = useState<number>()
	const busy = useBusyReason(device)
	const applyReason = firstReason(busy, (pending === undefined || pending === dutyCycle.value) && 'Move the slider first')
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
			<Slider label="Duty cycle" value={value} min={dutyCycle.min} max={dutyCycle.max} step={step} onChange={setPending} />
			<Actions>
				{pending !== undefined && (
					<Button variant="secondary" onClick={() => setPending(undefined)}>
						Discard
					</Button>
				)}
				<Button disabled={!!applyReason} title={applyReason} onClick={() => void apply()}>
					Apply Duty Cycle
				</Button>
			</Actions>
		</PanelSection>
	)
}
