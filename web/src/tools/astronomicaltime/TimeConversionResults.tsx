import type { AstronomicalTimeResult, TimeScaleName } from 'api'
import { formatAngle, formatHMS, toDeg } from 'nebulosa/src/math/units/angle'
import { useEffect, useRef, useState } from 'react'
import { copyText } from '../../clipboard'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { IconButton } from '../../ui/IconButton'
import { Note } from '../eclipse/EclipsePanelParts'
import { astronomicalTimeState, type InputFormat, qualityNotes, TIME_SCALE_NAMES, takeAsInput } from './astronomicaltime'

// Results of the Astronomical Time Converter, as the server answered them, grouped so the common readings show first:
// civil time, Julian dates, and sidereal time, with every timescale and the epochs collapsed. Each value names its
// timescale, and its copy does too, so a copied number can never be read in the wrong one. Copied text is fixed-format and
// independent of the locale.

// Timescales whose Julian dates are shown without opening the Time Scales section.
const COMMON_SCALES: readonly TimeScaleName[] = ['UTC', 'UT1', 'TT', 'TDB']

// Decimals of the seconds of a sidereal time or an hour angle (1 ms of time).
const SIDEREAL_DIGITS = 3

// Time an icon of a copy stays confirmed, in milliseconds.
const COPIED_MS = 1500

// Formats an offset from UTC in seconds as +hh:mm, with the seconds of a local mean time when it has them.
function formatOffset(seconds: number) {
	const size = Math.abs(seconds)
	const fields = [Math.trunc(size / 3600), Math.trunc(size / 60) % 60].map((field) => String(field).padStart(2, '0'))
	const rest = size % 60 ? `:${String(size % 60).padStart(2, '0')}` : ''
	return `UTC${seconds < 0 ? '−' : '+'}${fields.join(':')}${rest}`
}

// Formats a sidereal time as time and as degrees.
function formatSidereal(angle: number) {
	return `${formatHMS(angle, SIDEREAL_DIGITS)} (${toDeg(angle).toFixed(5)}°)`
}

// Formats a signed hour angle in hours, minutes, and seconds.
function formatHourAngle(angle: number) {
	return formatAngle(angle, { isHour: true, separators: ':', noSign: false, fractionDigits: SIDEREAL_DIGITS })
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
}

// Name, value, and actions of one result.
function ResultRow({ label, value, input }: ResultRowProps) {
	const [copied, setCopied] = useState(false)
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

	useEffect(() => () => clearTimeout(timer.current), [])

	async function copy() {
		if (!(await copyText(`${label} ${value}`))) return
		setCopied(true)
		clearTimeout(timer.current)
		timer.current = setTimeout(() => setCopied(false), COPIED_MS)
	}

	return (
		<div className="flex min-h-8 items-center gap-2">
			<span className="w-28 flex-none text-ink-300 max-sm:w-20">{label}</span>
			<span className="min-w-0 flex-1 font-mono text-[13px] wrap-anywhere text-ink-100 tabular-nums">{value}</span>
			{input && <IconButton icon="stepBack" label={`Use ${label} as the input`} onClick={() => takeAsInput(astronomicalTimeState, input.format, input.scale, value)} />}
			<IconButton icon={copied ? 'success' : 'duplicate'} label={`Copy ${label}`} onClick={() => void copy()} />
		</div>
	)
}

export interface TimeConversionResultsProps {
	// Answer of the server.
	readonly result: AstronomicalTimeResult
	// Time zone of the local calendar, an IANA name.
	readonly timeZone: string
	// Whether the conversion has a location; without one there are no local sidereal times.
	readonly located: boolean
}

// Results of a conversion.
export function TimeConversionResults({ result, timeZone, located }: TimeConversionResultsProps) {
	const { civil, scales, sidereal, offsets, epochs, hourAngle, quality } = result

	return (
		<>
			<CollapsibleSection id="tools.astronomicalTime.civil" title="Civil Time">
				<ResultRow label="UTC" value={scales.UTC.calendar} />
				<ResultRow label="Local" value={civil.local} />
				<Note>
					{timeZone}, {formatOffset(civil.offsetSeconds)}. Calendars are proleptic Gregorian, with astronomical year numbering.
				</Note>
				{civil.unixMillis === undefined ? <Note>This is an inserted leap second, which Unix time cannot represent.</Note> : <ResultRow label="Unix" value={`${civil.unixMillis / 1000}`} input={{ format: 'unix', scale: 'UTC' }} />}
			</CollapsibleSection>
			<CollapsibleSection id="tools.astronomicalTime.julian" title="Julian Dates">
				{COMMON_SCALES.map((scale) => (
					<ResultRow key={`jd-${scale}`} label={`JD(${scale})`} value={scales[scale].jd} input={{ format: 'jd', scale }} />
				))}
				{COMMON_SCALES.map((scale) => (
					<ResultRow key={`mjd-${scale}`} label={`MJD(${scale})`} value={scales[scale].mjd} input={{ format: 'mjd', scale }} />
				))}
				{civil.leapSecondDay && <Note>This UTC day has a leap second, so JD(UTC) is the ERFA quasi-Julian date of a stretched day.</Note>}
			</CollapsibleSection>
			<CollapsibleSection id="tools.astronomicalTime.sidereal" title="Sidereal Time">
				<ResultRow label="GMST" value={formatSidereal(sidereal.gmst)} />
				<ResultRow label="GAST" value={formatSidereal(sidereal.gast)} />
				{sidereal.lmst !== undefined && <ResultRow label="LMST" value={formatSidereal(sidereal.lmst)} />}
				{sidereal.last !== undefined && <ResultRow label="LAST" value={formatSidereal(sidereal.last)} />}
				{!located && <Note>Local sidereal times need a location.</Note>}
				<Note>Mean times use the mean equinox of date (IAU 2006), apparent times the true equinox (IAU 2006/2000A).</Note>
			</CollapsibleSection>
			{hourAngle !== undefined && (
				<CollapsibleSection id="tools.astronomicalTime.hourAngleResult" title="Hour Angle">
					<ResultRow label="HA" value={formatHourAngle(hourAngle)} />
					<Note>HA = LAST − RA, wrapped to ±12 h. {meridianSide(hourAngle)}.</Note>
				</CollapsibleSection>
			)}
			<CollapsibleSection id="tools.astronomicalTime.scales" title="Time Scales" summary={`${TIME_SCALE_NAMES.length} scales`} defaultOpen={false}>
				{TIME_SCALE_NAMES.map((scale) => (
					<ResultRow key={scale} label={scale} value={scales[scale].calendar} />
				))}
				{offsets.dut1 !== undefined && <ResultRow label="UT1−UTC" value={`${offsets.dut1.toFixed(6)} s`} />}
				{offsets.taiMinusUtc !== undefined && <ResultRow label="TAI−UTC" value={`${offsets.taiMinusUtc.toFixed(3)} s`} />}
				{offsets.ttMinusUt1 !== undefined && <ResultRow label="TT−UT1" value={`${offsets.ttMinusUt1.toFixed(6)} s`} />}
				<ResultRow label="TDB−TT" value={`${offsets.tdbMinusTt.toFixed(6)} s`} />
				<Note>TDB is a model {located ? 'at the location' : 'at the center of the Earth'}.</Note>
			</CollapsibleSection>
			<CollapsibleSection id="tools.astronomicalTime.epochs" title="Epochs and Calendar" summary={`J${epochs.julian.toFixed(3)}`} defaultOpen={false}>
				<ResultRow label="Julian(TT)" value={`J${epochs.julian.toFixed(6)}`} />
				<ResultRow label="Besselian(TT)" value={`B${epochs.besselian.toFixed(6)}`} />
				<ResultRow label="Day of Year" value={`${epochs.dayOfYear}`} />
			</CollapsibleSection>
			<CollapsibleSection id="tools.astronomicalTime.quality" title="Accuracy">
				{qualityNotes(quality).map((note) => (
					<Note key={note}>{note}</Note>
				))}
				<Note>Calendars show milliseconds and Julian dates nine decimals, about 86 µs: not a claim of that accuracy.</Note>
			</CollapsibleSection>
		</>
	)
}
