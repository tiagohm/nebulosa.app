import type { GuidePulseRequest } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { NumberInput } from '../../ui/NumberInput'
import { controlRuntime, deviceStateOf, sendCommand, startCommand, stopCommand } from '../control'
import { Actions, type InterfaceProps, Notice, Readout } from '../parts'

// Controls of a guide output: single timed pulses along the driver's motion vectors, the guide rates, and
// a stop of the pulses in progress. A pulse holds the physical device behind the output, so it is refused
// while a slew, a nudge, or a capture holds the same mount or camera.

// Directions in display order, with their labels.
const DIRECTIONS: readonly (readonly [GuidePulseRequest['direction'], string])[] = [
	['NORTH', 'North'],
	['SOUTH', 'South'],
	['WEST', 'West'],
	['EAST', 'East'],
]

// Duration of a pulse when the panel opens, in milliseconds.
const DEFAULT_DURATION = 1000

// Longest pulse the panel sends, in milliseconds.
const MAX_DURATION = 60000

// Controls of a guide output.
export function GuideOutputControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const output = deviceStateOf(control.states, 'guideOutput', device.id)!
	const [duration, setDuration] = useState(DEFAULT_DURATION)
	const [rates, setRates] = useState<{ readonly rightAscension: number; readonly declination: number }>()
	const busy = control.pending[device.id] !== undefined
	const shown = rates ?? output.guideRate

	return (
		<PanelSection title="Guide Output">
			<Readout label="State">{output.pulsing ? `Pulsing${output.pulsingNS ? ' N/S' : ''}${output.pulsingWE ? ' W/E' : ''}` : 'Idle'}</Readout>
			{output.canPulseGuide ? (
				<>
					<NumberInput label="Pulse duration" value={duration} min={1} max={MAX_DURATION} step={100} suffix="ms" onChange={setDuration} />
					<Actions>
						{DIRECTIONS.map(([direction, label]) => (
							<Button key={direction} size="sm" variant="secondary" disabled={busy || output.pulsing} onClick={() => void startCommand(controlRuntime, { type: 'guideOutput', deviceId: device.id, action: 'pulse', label: `Pulse ${label}`, body: { direction, duration } })}>
								{label}
							</Button>
						))}
						{output.pulsing && (
							<Button size="sm" onClick={() => void stopCommand(controlRuntime, { type: 'guideOutput', deviceId: device.id, action: 'stop' })}>
								Stop Pulses
							</Button>
						)}
					</Actions>
				</>
			) : (
				<Notice>This output does not accept guide pulses.</Notice>
			)}
			{output.hasGuideRate && (
				<>
					<Readout label="Guide rate">{`RA ${output.guideRate.rightAscension.toFixed(2)}× · Dec ${output.guideRate.declination.toFixed(2)}×`}</Readout>
					{output.canSetGuideRate && (
						<>
							<div className="grid grid-cols-2 gap-2">
								<NumberInput label="RA rate" value={shown.rightAscension} min={0} max={1} step={0.05} suffix="×" onChange={(rightAscension) => setRates({ ...shown, rightAscension })} />
								<NumberInput label="Dec rate" value={shown.declination} min={0} max={1} step={0.05} suffix="×" onChange={(declination) => setRates({ ...shown, declination })} />
							</div>
							<Actions>
								<Button
									size="sm"
									variant="secondary"
									disabled={busy || !rates}
									onClick={async () => {
										if (rates && (await sendCommand(controlRuntime, { type: 'guideOutput', deviceId: device.id, action: 'guide-rate', label: 'Guide rate', body: rates }))) setRates(undefined)
									}}
								>
									Apply Rates
								</Button>
							</Actions>
						</>
					)}
					<Notice>Guide rates are fractions of the sidereal rate.</Notice>
				</>
			)}
		</PanelSection>
	)
}
