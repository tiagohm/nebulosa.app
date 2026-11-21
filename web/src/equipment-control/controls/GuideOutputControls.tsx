import type { GuidePulseRequest } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatFixed } from '../../format'
import { activeProfile, activeSetup, profileState } from '../../profile/profile'
import { PanelSection } from '../../shell/ContextualPanel'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { controlRuntime, deviceStateOf, sendCommand, startCommand } from '../control'
import { guideOutputStateWord } from '../lexicon'
import { CollapsedSection, type InterfaceProps } from '../parts'
import { firstReason, useBusyReason } from '../useControl'

// Controls of a guide output: single timed pulses along the driver's motion vectors, then, collapsed, the guide rates.
// Its state and the stop of the pulses in progress are in the header of the device. A pulse holds the physical device behind the output and, for the GUIDE_OUTPUT of the
// active profile's Equipment Setup, the MOUNT it drives, so it is refused while a slew, a nudge, or a capture holds the
// same mount or camera.

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
	const busy = useBusyReason(device)
	const pulseReason = firstReason(busy, output.pulsing && 'Wait until the pulse ends', !(duration > 0) && 'Enter a duration above 0 ms')
	const ratesReason = firstReason(busy, !rates && 'Change a rate first')
	const shown = rates ?? output.guideRate
	const setup = activeSetup(activeProfile(useSnapshot(profileState)))
	// The setup says which mount its guide output drives; a guide output it does not assign drives none it knows of.
	const mount = setup.GUIDE_OUTPUT?.id === device.id && setup.MOUNT ? { connectionId: device.connectionId, deviceId: setup.MOUNT.id } : undefined

	return (
		<>
			<PanelSection title="Guide Output">
				<DataRow label="State">{guideOutputStateWord(output)}</DataRow>
				{output.canPulseGuide ? (
					<>
						<NumberInput label="Pulse duration" value={duration} min={1} max={MAX_DURATION} step={100} suffix="ms" onChange={setDuration} />
						<Actions>
							{DIRECTIONS.map(([direction, label]) => (
								<Button
									key={direction}
									variant="secondary"
									disabled={!!pulseReason}
									title={pulseReason ?? `Pulse ${label.toLowerCase()} for ${duration} ms`}
									onClick={() => void startCommand(controlRuntime, { type: 'guideOutput', deviceId: device.id, action: 'pulse', label: `Pulse ${label}`, body: { direction, duration, ...(mount && { mount }) } })}
								>
									{label}
								</Button>
							))}
						</Actions>
					</>
				) : (
					<Notice>This output does not accept guide pulses.</Notice>
				)}
			</PanelSection>
			{output.hasGuideRate && (
				<CollapsedSection title="Guide Rates" summary={`RA ${formatFixed(output.guideRate.rightAscension, 2)}× · Dec ${formatFixed(output.guideRate.declination, 2)}×`}>
					<DataRow label="Guide rate">{`RA ${formatFixed(output.guideRate.rightAscension, 2)}× · Dec ${formatFixed(output.guideRate.declination, 2)}×`}</DataRow>
					{output.canSetGuideRate && (
						<>
							<div className="grid grid-cols-2 gap-2">
								<NumberInput label="RA rate" value={shown.rightAscension} min={0} max={1} step={0.05} suffix="×" onChange={(rightAscension) => setRates({ ...shown, rightAscension })} />
								<NumberInput label="Dec rate" value={shown.declination} min={0} max={1} step={0.05} suffix="×" onChange={(declination) => setRates({ ...shown, declination })} />
							</div>
							<Actions>
								<Button
									variant="secondary"
									disabled={!!ratesReason}
									title={ratesReason}
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
				</CollapsedSection>
			)}
		</>
	)
}
