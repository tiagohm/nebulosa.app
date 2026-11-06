import type { SunPhysicalData } from 'api'
import { formatLocalTime } from '../../format'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'

// Solar Physical Data section of the Sun Inspector: the equation of time and the Carrington rotation in progress at
// the instant the almanac was computed for.

// Formats the equation of time in seconds as signed minutes and seconds: "+16m 26s".
export function formatEquationOfTime(seconds: number) {
	const total = Math.round(Math.abs(seconds))
	return `${seconds < 0 ? '−' : '+'}${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}

// Solar Physical Data section of the Sun Inspector; `time` is the instant of the data, Unix milliseconds.
export function SolarPhysicalSection({ physical, time, timeZone }: { readonly physical?: SunPhysicalData; readonly time?: number; readonly timeZone: string }) {
	return (
		<CollapsibleSection id="sky.physical" title="Solar Physical Data" summary={physical && `EoT ${formatEquationOfTime(physical.equationOfTimeSeconds)} · CR ${physical.carringtonRotation}`} defaultOpen={false}>
			{physical && time !== undefined ? (
				<>
					<DataRow label="Equation of time">{formatEquationOfTime(physical.equationOfTimeSeconds)}</DataRow>
					<DataRow label="Carrington rotation">{physical.carringtonRotation}</DataRow>
					<Notice>At {formatLocalTime(time, timeZone, Date.now())}, from the local model. The equation of time is apparent minus mean solar time: positive when a sundial is ahead of the clock.</Notice>
				</>
			) : (
				<p className="m-0 text-ink-300">Computing…</p>
			)}
		</CollapsibleSection>
	)
}
