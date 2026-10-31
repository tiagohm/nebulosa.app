import { useSnapshot } from 'valtio'
import { activeProfile, astronomicalClockPreferences, profileState, setAstronomicalClockPreferences } from '../profile/profile'
import { ASTRONOMICAL_CLOCK_READINGS, type AstronomicalClockReading } from '../profile/schema'
import { navigate, routeState } from '../shell/route'
import { ASTRONOMICAL_CLOCK_READING_LABELS } from '../shell/statusbar/astronomicalclock'
import { skyState } from '../sky/sky'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Select } from '../ui/Select'

// Status Bar section of the Settings page: what the status bar of the active profile shows besides its equipment. A
// change applies at once and belongs to the profile, so the bar itself shows the result. The time zone of the clock is
// the Sky observer's, or the browser's; it has none of its own.

// Options of the secondary reading, in display order.
const SECONDARY_READINGS: readonly (AstronomicalClockReading | 'none')[] = ['none', ...ASTRONOMICAL_CLOCK_READINGS]

// Returns the name of an option of the secondary reading.
function secondaryLabel(reading: AstronomicalClockReading | 'none') {
	return reading === 'none' ? 'None' : ASTRONOMICAL_CLOCK_READING_LABELS[reading]
}

// Content of the Status Bar section.
export function StatusBarSettings() {
	const settings = activeProfile(useSnapshot(profileState)).settings
	const { enabled, primary, secondary, showSeconds } = astronomicalClockPreferences(settings)
	const located = settings.sky.observer !== undefined
	const sidereal = primary === 'last' || primary === 'lmst'

	return (
		<div className="min-h-0 flex-1 overflow-y-auto p-4">
			<section className="flex max-w-md flex-col gap-3">
				<h2 className="m-0 text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase">Astronomical Clock</h2>
				<Checkbox label="Show the clock in the status bar" checked={enabled} onChange={(value) => setAstronomicalClockPreferences(profileState, { enabled: value })} />
				<Select label="Primary Reading" disabled={!enabled} options={ASTRONOMICAL_CLOCK_READINGS} value={primary} format={(reading) => ASTRONOMICAL_CLOCK_READING_LABELS[reading]} onChange={(reading) => setAstronomicalClockPreferences(profileState, { primary: reading })} />
				<Select
					label="Secondary Reading"
					disabled={!enabled}
					options={SECONDARY_READINGS}
					value={secondary}
					format={secondaryLabel}
					disabledReason={(reading) => (reading === primary ? 'Already the primary reading' : undefined)}
					onChange={(reading) => setAstronomicalClockPreferences(profileState, { secondary: reading })}
				/>
				<Checkbox label="Show seconds in times of day" disabled={!enabled} checked={showSeconds} onChange={(value) => setAstronomicalClockPreferences(profileState, { showSeconds: value })} />
				{sidereal && !located && (
					<>
						<p className="m-0 text-xs leading-4 text-ink-300">This profile has no Sky observer, so the bar shows the Julian Date (UTC) until one is set.</p>
						<Button
							variant="secondary"
							className="self-start"
							onClick={() => {
								skyState.panel = 'observer'
								navigate(routeState, { workspace: 'sky' })
							}}
						>
							Set Sky Observer
						</Button>
					</>
				)}
				<p className="m-0 text-xs leading-4 text-ink-300">The clock is always the real current time, never the Sky simulation clock. It uses the room the equipment and the operations leave, and is always listed in the status details.</p>
			</section>
		</div>
	)
}
