import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Slider } from '../../ui/Slider'
import { controlRuntime, deviceStateOf, sendCommand } from '../control'
import { Actions, type InterfaceProps, Notice, Readout } from '../parts'

// Controls of a flat panel: its light switch and brightness as the panel reports them. The slider and its
// number field only change a pending brightness, sent once with Apply Brightness, so dragging never sends a
// stream of commands; the light state is the reported one, never inferred from the brightness.

// Controls of a flat panel.
export function FlatPanelControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const panel = deviceStateOf(control.states, 'flatPanel', device.id)!
	const { intensity } = panel
	const [pending, setPending] = useState<number>()
	const busy = control.pending[device.id] !== undefined
	const value = pending ?? intensity.value
	const step = intensity.step > 0 ? intensity.step : 1

	async function apply() {
		if (pending !== undefined && (await sendCommand(controlRuntime, { type: 'flatPanel', deviceId: device.id, action: 'intensity', label: 'Brightness', body: { value: pending } }))) setPending(undefined)
	}

	return (
		<PanelSection title="Flat Panel">
			<Readout label="Light">{panel.enabled ? 'On' : 'Off'}</Readout>
			<Readout label="Brightness">{`${intensity.value} of ${intensity.min}–${intensity.max}`}</Readout>
			<Checkbox label="Light on" checked={panel.enabled} disabled={busy} onChange={(enabled) => void sendCommand(controlRuntime, { type: 'flatPanel', deviceId: device.id, action: 'light', label: enabled ? 'Light on' : 'Light off', body: { enabled } })} />
			{intensity.max > intensity.min && (
				<>
					<Slider disabled={!panel.enabled} label="Brightness" value={value} min={intensity.min} max={intensity.max} step={step} onChange={setPending} />
					<Actions>
						{pending !== undefined && (
							<Button variant="secondary" onClick={() => setPending(undefined)}>
								Discard
							</Button>
						)}
						<Button disabled={!panel.enabled || busy || pending === undefined || pending === intensity.value} onClick={() => void apply()}>
							Apply Brightness
						</Button>
					</Actions>
				</>
			)}
			{pending !== undefined && <Notice>Not applied yet: the panel still reports {intensity.value}.</Notice>}
		</PanelSection>
	)
}
