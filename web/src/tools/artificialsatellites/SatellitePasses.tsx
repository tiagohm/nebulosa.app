import type { SatellitePassPrediction } from 'api'
import { useSnapshot } from 'valtio'
import { formatDegrees, formatKilometers } from '../../format'
import { type GeographicLocation, openObservingSites } from '../../location/site'
import { type DisplayZone, describeDisplayZone } from '../../location/zone'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { Cell, Row, Table, type TableColumn } from '../../ui/Table'
import { artificialSatellitesState, formatSatelliteTime, loadSatellitePasses, MAX_PASS_DAYS, SHADOW_LABELS, showSatelliteInSky, TWILIGHT_LABELS, TWILIGHT_LIMITS, type TwilightLimit } from './artificialsatellites'
import { QualityRow } from './SatelliteDetailsPanel'

// Passes tab of Artificial Satellites: the passes of the satellite selected above a minimum altitude over the observing
// site of the active profile, in a window from now or from the Sky's time, each with the parts in which it can be seen
// (sunlit while the Sun is below the twilight limit), its times in the display zone. A pass cut by the window says so
// instead of showing a rise or a set, and the culmination is the highest point, not a meridian transit. The profile of
// the pass selected is drawn as altitude against time.

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
			<Select label="Twilight" className="w-52" options={TWILIGHTS} value={passDraft.twilight} format={(value) => TWILIGHT_LABELS[value]} onChange={(value) => (draft.twilight = value)} />
			<span className="flex h-9.5 items-center">
				<Checkbox label="Daylight passes too" checked={passDraft.showAll} onChange={(value) => (draft.showAll = value)} />
			</span>
			<Button type="submit" className="ml-auto" disabled={passesLoading || !selectedId || !observer} title={!selectedId ? 'Select a satellite in the catalog.' : !observer ? 'Set the observing site of the profile.' : undefined}>
				Find Passes
			</Button>
		</form>
	)
}

// Profile of a pass: altitude (degrees) against time, the visible parts shaded with a hatch and labeled.
function PassProfile({ pass }: { readonly pass: SatellitePassPrediction }) {
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
				{pass.startsBeforeWindow ? 'window start' : 'rise'}
			</text>
			<text x={WIDTH - MARGIN.right} y={HEIGHT - 8} textAnchor="end" className="fill-current text-[10px]">
				{pass.endsAfterWindow ? 'window end' : 'set'}
			</text>
			<path d={path} fill="none" className="stroke-accent" strokeWidth="2" />
			<circle cx={xc} cy={yc} r="4" className="fill-accent" />
			<text x={xc} y={yc - 8} textAnchor="middle" className="fill-ink-100 text-[10px]">
				highest {formatDegrees(pass.culmination.altitude, 1)}
			</text>
		</svg>
	)
}

// Columns of the table of passes.
const PASS_COLUMNS: readonly TableColumn[] = [
	'Start',
	{ key: 'startAzimuth', label: 'Az', numeric: true },
	'Highest',
	{ key: 'altitude', label: 'Alt', numeric: true },
	'End',
	{ key: 'endAzimuth', label: 'Az', numeric: true },
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
}

// Row of one pass.
function PassRow({ pass, index, timeZone }: PassRowProps) {
	const { selectedPass } = useSnapshot(artificialSatellitesState)
	const minutes = (pass.end.time - pass.start.time) / 60_000
	const select = () => (artificialSatellitesState.selectedPass = index)

	return (
		<Row selected={selectedPass === index} onSelect={select}>
			<Cell>
				{formatSatelliteTime(pass.start.time, timeZone)}
				{pass.startsBeforeWindow && <span className="ml-1 text-ink-300">(in progress)</span>}
			</Cell>
			<Cell numeric>{formatDegrees(pass.start.azimuth, 0)}</Cell>
			<Cell>{formatSatelliteTime(pass.culmination.time, timeZone).slice(11)}</Cell>
			<Cell numeric>{formatDegrees(pass.culmination.altitude, 1)}</Cell>
			<Cell>
				{formatSatelliteTime(pass.end.time, timeZone).slice(11)}
				{pass.endsAfterWindow && <span className="ml-1 text-ink-300">(continues)</span>}
			</Cell>
			<Cell numeric>{formatDegrees(pass.end.azimuth, 0)}</Cell>
			<Cell numeric>{minutes.toFixed(1)} min</Cell>
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
	const shown = selectedPass === undefined ? undefined : passes?.passes[selectedPass]
	const name = details?.object.name ?? selectedId ?? ''

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto">
			<PassForm observer={observer} />
			{!selectedId && <EmptyState title="No satellite selected" description="Select a satellite in the catalog." />}
			{selectedId && !observer && <EmptyState title="No observing site" description="Passes are predicted for the observing site of the profile." action={<Button onClick={() => openObservingSites()}>Set Location</Button>} />}
			{passesError && <EmptyState title="No passes could be predicted" description={passesError} />}
			{passesLoading && <EmptyState title="Predicting passes" />}
			{passes && !passesLoading && (
				<div className="flex flex-col gap-3 px-4 py-3">
					<div className="text-xs text-ink-300">
						{name} · times {describeDisplayZone(zone)} · {passes.passes.length} passes{passes.truncated ? ' (more were left out)' : ''}
					</div>
					<div className="max-w-md">
						<QualityRow quality={passes.quality} />
					</div>
					{list.length === 0 ? (
						<Notice>{passes.passes.length === 0 ? 'No pass above the minimum altitude in this window.' : 'No visible pass in this window: show the daylight passes too to list them.'}</Notice>
					) : (
						<Table columns={PASS_COLUMNS}>
							{list.map((pass) => (
								<PassRow key={pass.start.time} pass={pass} index={passes.passes.indexOf(pass)} timeZone={timeZone} />
							))}
						</Table>
					)}
					{shown && (
						<div className="flex flex-col gap-2">
							<PassProfile pass={shown} />
							<div className="flex flex-wrap gap-2">
								<Button variant="secondary" onClick={() => showSatelliteInSky(selectedId!, name, observer, shown.culmination.time)}>
									View in Sky at the Highest Point
								</Button>
							</div>
							<Notice>Altitudes are geometric, without refraction; the curve joins the rise, the highest point, and the set. Visible parts are sunlit while the Sun is below the twilight limit at the site; whether the satellite is bright enough is not known.</Notice>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
