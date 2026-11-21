import type { AstronomicalTimeResult, TimeScaleName } from 'api'
import { cn } from 'cn'
import { formatHMS } from 'nebulosa/src/math/units/angle'
import { useEffect, useRef, useState } from 'react'
import { copyText } from '../../clipboard'
import { formatDegrees, formatHourAngle } from '../../format'
import { describeDisplayZone, type DisplayZone } from '../../location/zone'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { DataList, DataRow } from '../../ui/DataRow'
import { IconButton } from '../../ui/IconButton'
import { Notice } from '../../ui/Notice'
import { astronomicalTimeState, formatUnixSeconds, type InputFormat, qualityNotes, TIME_SCALE_NAMES, takeAsInput } from './astronomicaltime'

// Results of the Astronomical Time Converter, as the server answered them. The apparent sidereal time leads in large
// figures, the one reading of the tool, then civil time, the Julian dates of UTC and TT, and the sidereal times, with the
// calendar, Julian date, and Modified Julian Date of every timescale and the epochs collapsed. Each value names its
// timescale, and its copy does too, so a copied number can never be read in the wrong one. Copied text is fixed-format and
// independent of the locale. An answer kept from earlier inputs is dimmed, says so under the reading, and offers no
// action, so an out-of-date value is never copied or taken as the input.

// Timescales whose Julian dates are shown without opening the Time Scales section.
const SHOWN_JULIAN_SCALES: readonly TimeScaleName[] = ['UTC', 'TT']

// Decimals of the seconds of a sidereal time or an hour angle in a row (1 ms of time).
const SIDEREAL_DIGITS = 3

// Time an icon of a copy stays confirmed, in milliseconds.
const COPIED_MS = 1500

// Why the actions of a row are disabled while the values are of earlier inputs.
const OUT_OF_DATE = 'not available while the values are of earlier inputs'

// Formats an offset from UTC in seconds as +hh:mm, with the seconds of a local mean time when it has them.
function formatOffset(seconds: number) {
	const size = Math.abs(seconds)
	const fields = [Math.trunc(size / 3600), Math.trunc(size / 60) % 60].map((field) => String(field).padStart(2, '0'))
	const rest = size % 60 ? `:${String(size % 60).padStart(2, '0')}` : ''
	return `UTC${seconds < 0 ? '−' : '+'}${fields.join(':')}${rest}`
}

// Formats a sidereal time as time and as degrees.
function formatSidereal(angle: number) {
	return `${formatHMS(angle, SIDEREAL_DIGITS)} (${formatDegrees(angle, 5)})`
}

// Returns the side of the meridian of an hour angle: positive is west.
function meridianSide(angle: number) {
	return angle === 0 ? 'On the meridian' : angle > 0 ? 'West of the meridian' : 'East of the meridian'
}

interface ResultRowProps {
	// Name of the value, naming its timescale when it has one; it opens the copied text.
	readonly label: string
	// Value.
	readonly value: string
	// Form and scale that take this value as the custom instant; absent when it is not an input.
	readonly input?: { readonly format: InputFormat; readonly scale: TimeScaleName }
	// Whether the value answers the current inputs; only then can it be copied or taken as the input.
	readonly current: boolean
}

// Name, value, and actions of one result.
function ResultRow({ label, value, input, current }: ResultRowProps) {
	const [copied, setCopied] = useState(false)
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

	useEffect(() => () => clearTimeout(timer.current), [])

	async function copy() {
		if (!(await copyText(`${label} ${value}`))) return
		setCopied(true)
		clearTimeout(timer.current)
		timer.current = setTimeout(() => setCopied(false), COPIED_MS)
	}

	const actions = (
		<>
			{input && <IconButton icon="edit" label={current ? `Use ${label} as the input` : `Use ${label} as the input: ${OUT_OF_DATE}`} disabled={!current} onClick={() => takeAsInput(astronomicalTimeState, input.format, input.scale, value)} />}
			<IconButton icon={copied ? 'success' : 'duplicate'} label={current ? `Copy ${label}` : `Copy ${label}: ${OUT_OF_DATE}`} disabled={!current} onClick={() => void copy()} />
		</>
	)

	return (
		<DataRow label={label} actions={actions}>
			{value}
		</DataRow>
	)
}

// Apparent sidereal time of a result in large figures: local with a location, Greenwich without one, with the local civil
// time it is for, whether it is out of date, and a warning in words when UT1 is only approximate.
function SiderealReadout({ result, current }: { readonly result: AstronomicalTimeResult; readonly current: boolean }) {
	const { sidereal, civil, quality } = result

	return (
		<section className="flex flex-col gap-1 border-b border-line-100 px-4 pt-4 pb-3">
			<span className="text-xs leading-4 text-ink-300">{sidereal.last === undefined ? 'Greenwich apparent sidereal time' : 'Local apparent sidereal time'}</span>
			<output className="block text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-100 tabular-nums">{formatHMS(sidereal.last ?? sidereal.gast, false)}</output>
			<span className="text-sm leading-5 wrap-break-word text-ink-200 tabular-nums">
				{current ? 'At' : 'Out of date: at'} {civil.local} local time
			</span>
			{quality.eop.status !== 'covered' && <Notice warning>Approximate: UT1 is taken as UTC.</Notice>}
		</section>
	)
}

export interface TimeConversionResultsProps {
	// Answer of the server.
	readonly result: AstronomicalTimeResult
	// Zone of the local calendar, and why it was chosen.
	readonly zone: DisplayZone
	// Whether the conversion has a location; without one there are no local sidereal times.
	readonly located: boolean
	// Whether the answer is of the current inputs; one kept from earlier inputs is dimmed and offers no action.
	readonly current: boolean
	// Why the right ascension typed cannot be read; absent when it can, or when none was typed.
	readonly rightAscensionError?: string
}

// Results of a conversion.
export function TimeConversionResults({ result, zone, located, current, rightAscensionError }: TimeConversionResultsProps) {
	const { civil, scales, sidereal, offsets, epochs, hourAngle, quality } = result

	return (
		<div className={cn('mx-auto flex max-w-2xl flex-col transition-opacity duration-150 motion-reduce:transition-none', !current && 'opacity-50')}>
			<SiderealReadout result={result} current={current} />
			<CollapsibleSection id="tools.astronomicalTime.civil" title="Civil Time">
				<DataList>
					<ResultRow label="UTC" value={scales.UTC.calendar} current={current} />
					<ResultRow label="Local" value={civil.local} current={current} />
					{civil.unixMillis !== undefined && <ResultRow label="Unix" value={formatUnixSeconds(civil.unixMillis)} input={{ format: 'unix', scale: 'UTC' }} current={current} />}
				</DataList>
				{civil.unixMillis === undefined && <Notice>This is an inserted leap second, which Unix time cannot represent.</Notice>}
				<Notice>
					{describeDisplayZone(zone)}, {formatOffset(civil.offsetSeconds)}. Calendars are proleptic Gregorian, with astronomical year numbering.
				</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="tools.astronomicalTime.julian" title="Julian Dates">
				<DataList>
					{SHOWN_JULIAN_SCALES.map((scale) => (
						<ResultRow key={scale} label={`JD(${scale})`} value={scales[scale].jd} input={{ format: 'jd', scale }} current={current} />
					))}
				</DataList>
				{civil.leapSecondDay && <Notice>This UTC day has a leap second, so JD(UTC) is the ERFA quasi-Julian date of a stretched day.</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="tools.astronomicalTime.sidereal" title="Sidereal Time">
				<DataList>
					<ResultRow label="GMST" value={formatSidereal(sidereal.gmst)} current={current} />
					<ResultRow label="GAST" value={formatSidereal(sidereal.gast)} current={current} />
					{sidereal.lmst !== undefined && <ResultRow label="LMST" value={formatSidereal(sidereal.lmst)} current={current} />}
					{sidereal.last !== undefined && <ResultRow label="LAST" value={formatSidereal(sidereal.last)} current={current} />}
				</DataList>
				{!located && <Notice>Local sidereal times need a location.</Notice>}
				<Notice>Mean times use the mean equinox of date (IAU 2006), apparent times the true equinox (IAU 2006/2000A).</Notice>
			</CollapsibleSection>
			{(hourAngle !== undefined || rightAscensionError) && (
				<CollapsibleSection id="tools.astronomicalTime.hourAngleResult" title="Hour Angle">
					{rightAscensionError ? (
						<Notice error>{rightAscensionError}</Notice>
					) : (
						hourAngle !== undefined && (
							<>
								<DataList>
									<ResultRow label="HA" value={formatHourAngle(hourAngle, SIDEREAL_DIGITS)} current={current} />
								</DataList>
								<Notice>HA = LAST − RA, wrapped to ±12 h. {meridianSide(hourAngle)}.</Notice>
							</>
						)
					)}
				</CollapsibleSection>
			)}
			<CollapsibleSection id="tools.astronomicalTime.scales" title="Time Scales" summary={`${TIME_SCALE_NAMES.length} scales, JD and MJD`} defaultOpen={false}>
				{TIME_SCALE_NAMES.map((scale) => (
					<DataList key={scale}>
						<ResultRow label={scale} value={scales[scale].calendar} current={current} />
						<ResultRow label="JD" value={scales[scale].jd} input={{ format: 'jd', scale }} current={current} />
						<ResultRow label="MJD" value={scales[scale].mjd} input={{ format: 'mjd', scale }} current={current} />
						<hr className="text-neutral-700 border-dashed" />
					</DataList>
				))}
				<DataList>
					{offsets.dut1 !== undefined && <ResultRow label="UT1−UTC" value={`${offsets.dut1.toFixed(6)} s`} current={current} />}
					{offsets.taiMinusUtc !== undefined && <ResultRow label="TAI−UTC" value={`${offsets.taiMinusUtc.toFixed(3)} s`} current={current} />}
					{offsets.ttMinusUt1 !== undefined && <ResultRow label="TT−UT1" value={`${offsets.ttMinusUt1.toFixed(6)} s`} current={current} />}
					<ResultRow label="TDB−TT" value={`${offsets.tdbMinusTt.toFixed(6)} s`} current={current} />
				</DataList>
				<Notice>TDB is a model {located ? 'at the location' : 'at the center of the Earth'}.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="tools.astronomicalTime.epochs" title="Epochs and Calendar" summary={`J${epochs.julian.toFixed(3)}`} defaultOpen={false}>
				<DataList>
					<ResultRow label="Julian(TT)" value={`J${epochs.julian.toFixed(6)}`} current={current} />
					<ResultRow label="Besselian(TT)" value={`B${epochs.besselian.toFixed(6)}`} current={current} />
					<ResultRow label="Day of Year" value={`${epochs.dayOfYear}`} current={current} />
				</DataList>
			</CollapsibleSection>
			<CollapsibleSection id="tools.astronomicalTime.quality" title="Accuracy">
				{qualityNotes(quality).map((note) => (
					<Notice key={note}>{note}</Notice>
				))}
				<Notice>Calendars show milliseconds and Julian dates nine decimals, about 86 µs: not a claim of that accuracy.</Notice>
			</CollapsibleSection>
		</div>
	)
}
