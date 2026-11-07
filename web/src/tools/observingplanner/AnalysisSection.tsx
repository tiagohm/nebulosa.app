import { parseAngle } from 'nebulosa/src/math/units/angle'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatClockTime, formatDegrees, formatHours, formatPercent, formatSpan } from '../../format'
import type { SiteLocation } from '../../location/site'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { StatusBadge } from '../../ui/StatusBadge'
import { TextInput } from '../../ui/TextInput'
import { formatScore, formatTargetKind } from './format'
import { NightChart } from './NightChart'
import { analyze, type NamedTarget, type ObservingPlannerState, observingPlannerState, REASON_LABELS, showTargetInSky, STATUS_LABELS } from './observingplanner'

// Analysis section of the Observing Planner: one target over the tool's night, with its status and reasons, its windows,
// the factors of its score, and the chart of its altitude. Fixed coordinates typed here are analyzed the same way. Show in
// Sky selects the object in the Sky at the Sky's own time; nothing moves the mount or the clock.

// Names of the score factors.
const FACTOR_LABELS = { altitude: 'Altitude', airmass: 'Airmass', twilight: 'Twilight', moon: 'Moon', duration: 'Duration' } as const

export interface AnalysisSectionProps {
	// Location of the tool; undefined without one.
	readonly location?: SiteLocation
	// Active observing site of the profile, from which the Sky selects.
	readonly activeSite?: SiteLocation
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Asks to add a target to a plan.
	readonly onAdd: (target: NamedTarget) => void
}

// Analysis section of the Observing Planner.
export function AnalysisSection({ location, activeSite, timeZone, onAdd }: AnalysisSectionProps) {
	const state = useSnapshot(observingPlannerState) as ObservingPlannerState
	const { analysis, selected } = state
	const [cursor, setCursor] = useState(0)

	return (
		<div className="flex flex-col gap-4">
			<CoordinatesForm disabled={!location} onAnalyze={(target) => location && void analyze(observingPlannerState, location, target)} />
			{state.analysisError && <Notice error>{state.analysisError}</Notice>}
			{!selected && !state.analysisLoading && <Notice>Choose a target in Discover, or type fixed coordinates above.</Notice>}
			{state.analysisLoading && <p className="m-0 text-sm text-ink-300">Analyzing {selected?.name}…</p>}
			{analysis && selected && (
				<>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="min-w-0">
							<h3 className="m-0 truncate text-base font-medium text-ink-100">{analysis.name}</h3>
							<p className="m-0 text-xs text-ink-300">
								{analysis.typeName ?? formatTargetKind(analysis.target)} · Night of {analysis.night.sun.localDate}
							</p>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<StatusBadge tone={STATUS_LABELS[analysis.status].tone} label={STATUS_LABELS[analysis.status].label} />
							<Button variant="secondary" disabled={analysis.status === 'unresolved'} onClick={() => showTargetInSky(selected, activeSite)}>
								Show in Sky
							</Button>
							<Button variant="secondary" onClick={() => onAdd(selected)}>
								Add
							</Button>
						</div>
					</div>
					{analysis.reasons.length > 0 && (
						<Notice>
							{analysis.reasons.map((reason) => (
								<span key={reason} className="block">
									{REASON_LABELS[reason]}
								</span>
							))}
						</Notice>
					)}
					{analysis.samples.length > 0 && <NightChart analysis={analysis} timeZone={timeZone} cursor={Math.min(cursor, analysis.samples.length - 1)} onCursor={setCursor} />}
					<div className="grid gap-4 md:grid-cols-2">
						<section className="flex flex-col gap-2 rounded-sm border border-line-100 bg-base-100 p-4">
							<h4 className="m-0 text-sm font-medium text-ink-100">Windows</h4>
							{analysis.windows.length === 0 ? (
								<p className="m-0 text-sm text-ink-300">None this night.</p>
							) : (
								<DataList>
									{analysis.windows.map((window) => (
										<DataRow key={window.start} label={formatSpan(window.start, window.end, timeZone)}>
											{formatHours(window.durationMs)} · best {formatScore(window.bestScore)} at {formatClockTime(window.bestAt, timeZone)}
										</DataRow>
									))}
								</DataList>
							)}
							<DataList>
								<DataRow label="Usable Time">{formatHours(analysis.summary.totalUsableMs)}</DataRow>
								<DataRow label="Longest Window">{formatHours(analysis.summary.longestWindowMs)}</DataRow>
								<DataRow label="Culmination">{analysis.summary.culminationAt === undefined ? 'Not during this night' : `${formatClockTime(analysis.summary.culminationAt, timeZone)} at ${formatDegrees(analysis.summary.culminationAltitude ?? 0, 1)}`}</DataRow>
							</DataList>
						</section>
						<section className="flex flex-col gap-2 rounded-sm border border-line-100 bg-base-100 p-4">
							<h4 className="m-0 text-sm font-medium text-ink-100">Score</h4>
							{analysis.score ? (
								<>
									<p className="m-0 text-2xl font-medium text-ink-100 tabular-nums">{formatScore(analysis.score.value)}</p>
									<DataList>
										{(Object.keys(FACTOR_LABELS) as (keyof typeof FACTOR_LABELS)[]).map((factor) => {
											const value = analysis.score!.factors[factor]
											return value === undefined ? null : (
												<DataRow key={factor} label={FACTOR_LABELS[factor]}>
													{formatPercent(value)}
												</DataRow>
											)
										})}
									</DataList>
									<p className="m-0 text-xs text-ink-300">A relative ranking of the hard-constraint windows (model {analysis.score.modelVersion}), not a predicted signal-to-noise ratio or sky brightness. Altitudes are geometric, without refraction or a local horizon.</p>
								</>
							) : (
								<p className="m-0 text-sm text-ink-300">Scored only inside a window.</p>
							)}
						</section>
					</div>
				</>
			)}
		</div>
	)
}

// Form of fixed ICRS/J2000 coordinates to analyze.
function CoordinatesForm({ disabled, onAnalyze }: { readonly disabled: boolean; readonly onAnalyze: (target: NamedTarget) => void }) {
	const [name, setName] = useState('')
	const [rightAscension, setRightAscension] = useState('')
	const [declination, setDeclination] = useState('')
	const [error, setError] = useState<string>()

	// Reads the coordinates and analyzes them.
	function submit() {
		const ra = parseAngle(rightAscension.trim(), { isHour: true })
		const dec = parseAngle(declination.trim())
		if (ra === undefined || !(ra >= 0 && ra < 2 * Math.PI)) return setError('Enter the right ascension in hours, such as 5.5 or 05 35 17.')
		if (dec === undefined || !(Math.abs(dec) <= Math.PI / 2)) return setError('Enter the declination in degrees, such as -5.4 or -05 23 28.')
		setError(undefined)
		onAnalyze({ target: { kind: 'coordinates', name: name.trim() || 'Coordinates', rightAscension: ra, declination: dec }, name: name.trim() || 'Coordinates' })
	}

	return (
		<form
			className="flex flex-col gap-2 rounded-sm border border-line-100 bg-base-100 p-4"
			onSubmit={(event) => {
				event.preventDefault()
				submit()
			}}
		>
			<div className="flex flex-wrap items-end gap-3">
				<TextInput label="Name" className="min-w-36 flex-1" value={name} placeholder="Field" onChange={(event) => setName(event.target.value)} />
				<TextInput label="RA (J2000)" className="w-36" value={rightAscension} placeholder="05 35 17" onChange={(event) => setRightAscension(event.target.value)} />
				<TextInput label="Dec (J2000)" className="w-36" value={declination} placeholder="-05 23 28" onChange={(event) => setDeclination(event.target.value)} />
				<Button type="submit" variant="secondary" disabled={disabled || !rightAscension.trim() || !declination.trim()}>
					Analyze Coordinates
				</Button>
			</div>
			{error && <Notice error>{error}</Notice>}
		</form>
	)
}
