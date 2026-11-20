import type { SatellitePassPrediction } from 'api'
import { useSnapshot } from 'valtio'
import { formatClockTime, formatDateTime, formatDegrees, formatDuration, formatKilometers } from '../../format'
import { type GeographicLocation, openObservingSites } from '../../location/site'
import { type DisplayZone, describeDisplayZone } from '../../location/zone'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { DataList } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { Cell, Row, Table, type TableColumn } from '../../ui/Table'
import { artificialSatellitesState, loadSatellitePasses, MAX_PASS_DAYS, SHADOW_LABELS, showSatelliteInSky, TWILIGHT_LABELS, TWILIGHT_LIMITS, type TwilightLimit } from './artificialsatellites'
import { QualityRow } from './SatelliteDetailsPanel'

// Passes tab of Artificial Satellites: the passes of the satellite selected above a minimum altitude over the observing
// site of the active profile, in a window from now or from the Sky's time, each with the parts in which it can be seen
// (sunlit while the Sun is below the twilight limit), its times in the display zone. They are searched when the view
// shows a satellite without them; the form refines the search. Only visible passes are listed unless the daylight ones
// are asked for, and a window without a visible pass says so with the ways to widen it. A pass cut by the window says so
// instead of showing a start or an end, and the culmination is the highest point, not a meridian transit. The profile of
// the pass selected is drawn above the table as altitude against time.

// Width and height of the profile in its own units, and its margins.
const WIDTH = 640
const HEIGHT = 200
const MARGIN = { left: 40, right: 12, top: 24, bottom: 28 }

// Points of the drawn profile of a pass.
const PROFILE_POINTS = 64

// Twilight limits offered.
const TWILIGHTS = Object.keys(TWILIGHT_LIMITS) as TwilightLimit[]

// Search form of the passes, for observer, the active profile's site (absent without one).
function PassForm({ observer }: { readonly observer?: GeographicLocation }) {
	const { passDraft, passesLoading, selectedId } = useSnapshot(artificialSatellitesState)
	const draft = artificialSatellitesState.passDraft

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault()
				void loadSatellitePasses(artificialSatellitesState, observer)
			}}
			className="flex flex-none flex-wrap items-end gap-2 border-b border-line-100 bg-base-100 px-4 py-3"
		>
			<SegmentedControl label="From" options={['now', 'sky'] as const} value={passDraft.start} format={(value) => (value === 'now' ? 'Now' : 'Sky Time')} onChange={(value) => (draft.start = value)} />
			<NumberInput label="Days" className="w-24" min={1} max={MAX_PASS_DAYS} value={passDraft.days} onChange={(value) => (draft.days = value)} />
			<NumberInput label="Minimum altitude" suffix="°" className="w-36" min={0} max={89} value={passDraft.minAltitude} onChange={(value) => (draft.minAltitude = value)} />
			<Select label="Twilight" className="w-52 max-w-full flex-none" options={TWILIGHTS} value={passDraft.twilight} format={(value) => TWILIGHT_LABELS[value]} onChange={(value) => (draft.twilight = value)} />
			<span className="flex h-9.5 items-center">
				<Checkbox label="Daylight passes too" checked={passDraft.showAll} onChange={(value) => (draft.showAll = value)} />
			</span>
			<Button type="submit" className="ml-auto" disabled={passesLoading || !selectedId || !observer} title={!selectedId ? 'Search for a satellite first.' : !observer ? 'Set the observing site of the profile.' : undefined}>
				Find Passes
			</Button>
		</form>
	)
}

// Properties of the profile of a pass.
interface PassProfileProps {
	// Pass drawn.
	readonly pass: SatellitePassPrediction
	// IANA zone its times are written in.
	readonly timeZone: string
}

// Profile of a pass: altitude (degrees) against time, its start, highest point, and end written with their times of day,
// the visible parts shaded with a hatch and labeled.
function PassProfile({ pass, timeZone }: PassProfileProps) {
	const start = pass.start.time
	const span = Math.max(1, pass.end.time - start)
	const peak = Math.max(10, (pass.culmination.altitude * 180) / Math.PI)
	const x = (time: number) => MARGIN.left + ((time - start) / span) * (WIDTH - MARGIN.left - MARGIN.right)
	const y = (altitude: number) => HEIGHT - MARGIN.bottom - (Math.max(0, altitude) / peak) * (HEIGHT - MARGIN.top - MARGIN.bottom)
	// The pass is drawn through its three known points, rise, highest point, and set, by a quarter sine on each side:
	// steep at the ends and level at the top. The points between are not computed, so the curve only shows its shape.
	const [x0, y0, xc, yc, x2, y2] = [x(start), y((pass.start.altitude * 180) / Math.PI), x(pass.culmination.time), y((pass.culmination.altitude * 180) / Math.PI), x(pass.end.time), y((pass.end.altitude * 180) / Math.PI)]
	const points = Array.from({ length: PROFILE_POINTS + 1 }, (_, i) => {
		const px = x0 + ((x2 - x0) * i) / PROFILE_POINTS
		const py = px <= xc ? y0 + (yc - y0) * Math.sin((Math.PI / 2) * ((px - x0) / Math.max(1e-9, xc - x0))) : y2 + (yc - y2) * Math.sin((Math.PI / 2) * ((x2 - px) / Math.max(1e-9, x2 - xc)))
		return `${px.toFixed(1)},${py.toFixed(1)}`
	})
	const path = `M ${points.join(' L ')}`

	return (
		<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full max-w-3xl text-ink-300">
			<title>Altitude of the pass against time; hatched parts are visible.</title>
			<defs>
				<pattern id="visible-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
					<line x1="0" y1="0" x2="0" y2="6" className="stroke-success" strokeWidth="2" />
				</pattern>
			</defs>
			{pass.visible.map((part) => (
				<g key={part.start}>
					<rect x={x(part.start)} y={MARGIN.top} width={Math.max(1, x(part.end) - x(part.start))} height={HEIGHT - MARGIN.top - MARGIN.bottom} fill="url(#visible-hatch)" opacity={0.35} />
					<text x={(x(part.start) + x(part.end)) / 2} y={MARGIN.top + 10} textAnchor="middle" className="fill-success text-[10px]">
						visible
					</text>
				</g>
			))}
			<line x1={MARGIN.left} y1={HEIGHT - MARGIN.bottom} x2={WIDTH - MARGIN.right} y2={HEIGHT - MARGIN.bottom} stroke="currentColor" />
			<line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={HEIGHT - MARGIN.bottom} stroke="currentColor" />
			<text x={MARGIN.left - 4} y={y(peak) + 4} textAnchor="end" className="fill-current text-[10px]">
				{peak.toFixed(0)}°
			</text>
			<text x={MARGIN.left - 4} y={HEIGHT - MARGIN.bottom + 4} textAnchor="end" className="fill-current text-[10px]">
				0°
			</text>
			<text x={MARGIN.left} y={HEIGHT - 8} className="fill-current text-[10px]">
				{`${pass.startsBeforeWindow ? 'window start' : 'start'} ${formatClockTime(start, timeZone)}`}
			</text>
			<text x={WIDTH - MARGIN.right} y={HEIGHT - 8} textAnchor="end" className="fill-current text-[10px]">
				{`${pass.endsAfterWindow ? 'window end' : 'end'} ${formatClockTime(pass.end.time, timeZone)}`}
			</text>
			<path d={path} fill="none" className="stroke-accent" strokeWidth="2" />
			<circle cx={xc} cy={yc} r="4" className="fill-accent" />
			<text x={xc} y={yc - 8} textAnchor="middle" className="fill-ink-100 text-[10px]">
				{`highest ${formatDegrees(pass.culmination.altitude, 1)} at ${formatClockTime(pass.culmination.time, timeZone)}`}
			</text>
		</svg>
	)
}

// Columns of the table of passes.
const PASS_COLUMNS: readonly TableColumn[] = [
	'Start',
	{ key: 'startAzimuth', label: 'Start Az', numeric: true },
	'Highest',
	{ key: 'altitude', label: 'Alt', numeric: true },
	'End',
	{ key: 'endAzimuth', label: 'End Az', numeric: true },
	{ key: 'duration', label: 'Duration', numeric: true },
	{ key: 'range', label: 'Range', numeric: true },
	'Conditions',
]

// Properties of the row of one pass.
interface PassRowProps {
	// Pass shown.
	readonly pass: SatellitePassPrediction
	// Index of the pass in the answer, which selects it.
	readonly index: number
	// IANA zone its times are shown in.
	readonly timeZone: string
	// Whether it is the pass whose profile is drawn.
	readonly selected: boolean
}

// Row of one pass.
function PassRow({ pass, index, timeZone, selected }: PassRowProps) {
	const select = () => (artificialSatellitesState.selectedPass = index)

	return (
		<Row selected={selected} onSelect={select}>
			<Cell>
				{formatDateTime(pass.start.time, timeZone)}
				{pass.startsBeforeWindow && <span className="ml-1 text-ink-300">(in progress)</span>}
			</Cell>
			<Cell numeric>{formatDegrees(pass.start.azimuth, 0)}</Cell>
			<Cell>{formatClockTime(pass.culmination.time, timeZone, { seconds: true })}</Cell>
			<Cell numeric>{formatDegrees(pass.culmination.altitude, 1)}</Cell>
			<Cell>
				{formatClockTime(pass.end.time, timeZone, { seconds: true })}
				{pass.endsAfterWindow && <span className="ml-1 text-ink-300">(continues)</span>}
			</Cell>
			<Cell numeric>{formatDegrees(pass.end.azimuth, 0)}</Cell>
			<Cell numeric>{formatDuration((pass.end.time - pass.start.time) / 1000)}</Cell>
			<Cell numeric>{formatKilometers(pass.culmination.rangeKm)}</Cell>
			<Cell>{pass.visible.length > 0 ? 'Visible' : pass.culminationSunAltitude > 0 ? 'Daylight' : SHADOW_LABELS[pass.culminationShadow]}</Cell>
		</Row>
	)
}

// Properties of the Passes tab.
interface SatellitePassesProps {
	// Observing site of the active profile, which every pass is for; absent without one.
	readonly observer?: GeographicLocation
	// Zone the times are shown in.
	readonly zone: DisplayZone
}

// Passes tab.
export function SatellitePasses({ observer, zone }: SatellitePassesProps) {
	const { passes, passesLoading, passesError, selectedPass, selectedId, details, passDraft } = useSnapshot(artificialSatellitesState)
	const timeZone = zone.zone
	const list = (passes?.passes ?? []).filter((pass) => passDraft.showAll || pass.visible.length > 0)
	// The pass drawn is the one chosen while it is listed, else the first listed.
	const chosen = selectedPass === undefined ? undefined : passes?.passes[selectedPass]
	const shown = chosen && list.includes(chosen) ? chosen : list[0]
	const name = details?.object.name ?? selectedId ?? ''
	const visible = (passes?.passes ?? []).filter((pass) => pass.visible.length > 0).length
	const retry = () => void loadSatellitePasses(artificialSatellitesState, observer)
	const widen = () => {
		artificialSatellitesState.passDraft.days = MAX_PASS_DAYS
		retry()
	}

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto">
			<PassForm observer={observer} />
			{!selectedId && <EmptyState title="No satellite selected" description="Search for a satellite in the toolbar, or choose a pass tonight." />}
			{selectedId && !observer && <EmptyState title="No observing site" description="Passes are predicted for the observing site of the profile." action={<Button onClick={() => openObservingSites()}>Set Location</Button>} />}
			{passesError && <EmptyState title="No passes could be predicted" description={passesError} action={<Button onClick={retry}>Retry</Button>} />}
			{passesLoading && <EmptyState title="Predicting passes" />}
			{passes && !passesLoading && (
				<div className="flex flex-col gap-3 px-4 py-3">
					<div className="text-xs text-ink-300">
						{name} · times {describeDisplayZone(zone)} · {visible} visible of {passes.passes.length} {passes.passes.length === 1 ? 'pass' : 'passes'}
						{passes.truncated ? ' (more were left out)' : ''}
					</div>
					<div className="max-w-2xl">
						<DataList>
							<QualityRow quality={passes.quality} scope="window" />
						</DataList>
					</div>
					{list.length === 0 ? (
						<div className="flex flex-col items-start gap-2">
							<Notice>{passes.passes.length === 0 ? `No pass above ${passDraft.minAltitude}° in this window.` : `None of the ${passes.passes.length} passes in this window is visible: each is in daylight or in the Earth's shadow.`}</Notice>
							<div className="flex flex-wrap gap-2">
								{passes.passes.length > 0 && (
									<Button variant="secondary" onClick={() => (artificialSatellitesState.passDraft.showAll = true)}>
										List Daylight Passes
									</Button>
								)}
								{passDraft.days < MAX_PASS_DAYS && (
									<Button variant="secondary" onClick={widen}>
										{`Search ${MAX_PASS_DAYS} Days`}
									</Button>
								)}
							</div>
						</div>
					) : (
						<>
							{shown && (
								<div className="flex flex-col gap-2">
									<PassProfile pass={shown} timeZone={timeZone} />
									<div className="flex flex-wrap gap-2">
										<Button variant="secondary" title="Sets the Sky time to the highest point and shows the satellite there." onClick={() => showSatelliteInSky(selectedId!, name, observer, shown.culmination.time)}>
											View in Sky at the Highest Point
										</Button>
									</div>
								</div>
							)}
							<Table columns={PASS_COLUMNS} className="whitespace-nowrap">
								{list.map((pass) => (
									<PassRow key={pass.start.time} pass={pass} index={passes.passes.indexOf(pass)} timeZone={timeZone} selected={pass === shown} />
								))}
							</Table>
						</>
					)}
					<p className="m-0 max-w-3xl text-xs leading-4 text-pretty text-ink-300">
						Altitudes are geometric, without refraction; the curve joins the start, the highest point, and the end. Visible parts are sunlit while the Sun is below the twilight limit; whether the satellite is bright enough to see is not known.
					</p>
				</div>
			)}
		</div>
	)
}
