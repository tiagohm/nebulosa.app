import type { SatellitePassPrediction } from 'api'
import { cn } from 'cn'
import type { KeyboardEvent } from 'react'
import { useSnapshot } from 'valtio'
import type { SkyObserverSettings } from '../../profile/schema'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { moveIndex } from '../../ui/navigation'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { Note } from '../eclipse/EclipsePanelParts'
import { artificialSatellitesState, degrees, formatSatelliteTime, loadSatellitePasses, MAX_PASS_DAYS, SHADOW_LABELS, showSatelliteInSky, TWILIGHT_LABELS, TWILIGHT_LIMITS, type TwilightLimit } from './artificialsatellites'
import { QualityRow } from './SatelliteDetailsPanel'

// Passes tab of Artificial Satellites: the passes of the satellite selected above a minimum altitude over the place, in
// a window from now or from the Sky's time, each with the parts in which it can be seen (sunlit while the Sun is below
// the twilight limit). A pass cut by the window says so instead of showing a rise or a set, and the culmination is the
// highest point, not a meridian transit. The profile of the pass selected is drawn as altitude against time.

// Width and height of the profile in its own units, and its margins.
const WIDTH = 640
const HEIGHT = 200
const MARGIN = { left: 40, right: 12, top: 24, bottom: 28 }

// Points of the drawn profile of a pass.
const PROFILE_POINTS = 64

// Twilight limits offered.
const TWILIGHTS = Object.keys(TWILIGHT_LIMITS) as TwilightLimit[]

// Search form of the passes.
function PassForm({ observer }: { readonly observer?: SkyObserverSettings }) {
	const { passDraft, passesLoading, place, selectedId } = useSnapshot(artificialSatellitesState)
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
			<Button type="submit" className="ml-auto" disabled={passesLoading || !selectedId || !place} title={!selectedId ? 'Select a satellite in the catalog.' : !place ? 'Choose a place in the panel.' : undefined}>
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
				highest {degrees(pass.culmination.altitude, 1)}
			</text>
		</svg>
	)
}

interface PassRowProps {
	readonly pass: SatellitePassPrediction
	// Index of the pass in the answer, which selects it.
	readonly index: number
	// Position of the row in the table and the rows of the table, for the keyboard.
	readonly position: number
	readonly count: number
	readonly timeZone: string
}

// Row of one pass.
function PassRow({ pass, index, position, count, timeZone }: PassRowProps) {
	const { selectedPass } = useSnapshot(artificialSatellitesState)
	const minutes = (pass.end.time - pass.start.time) / 60_000
	const select = () => (artificialSatellitesState.selectedPass = index)

	function press(event: KeyboardEvent<HTMLTableRowElement>) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault()
			select()
			return
		}

		const next = moveIndex(position, count, event.key)
		if (next === undefined) return
		event.preventDefault()
		;(event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus()
	}

	return (
		<tr tabIndex={0} onClick={select} onKeyDown={press} className={cn('cursor-pointer border-b border-line-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent', selectedPass === index ? 'bg-accent-subtle' : 'hover:bg-base-200')}>
			<td className="px-2 py-1.5 whitespace-nowrap">
				{formatSatelliteTime(pass.start.time, timeZone)}
				{pass.startsBeforeWindow && <span className="ml-1 text-ink-300">(in progress)</span>}
			</td>
			<td className="px-2 py-1.5 text-right">{degrees(pass.start.azimuth, 0)}</td>
			<td className="px-2 py-1.5 whitespace-nowrap">{formatSatelliteTime(pass.culmination.time, timeZone).slice(11)}</td>
			<td className="px-2 py-1.5 text-right">{degrees(pass.culmination.altitude, 1)}</td>
			<td className="px-2 py-1.5 whitespace-nowrap">
				{formatSatelliteTime(pass.end.time, timeZone).slice(11)}
				{pass.endsAfterWindow && <span className="ml-1 text-ink-300">(continues)</span>}
			</td>
			<td className="px-2 py-1.5 text-right">{degrees(pass.end.azimuth, 0)}</td>
			<td className="px-2 py-1.5 text-right">{minutes.toFixed(1)} min</td>
			<td className="px-2 py-1.5 text-right">{pass.culmination.rangeKm.toFixed(0)} km</td>
			<td className="px-2 py-1.5 whitespace-nowrap">{pass.visible.length > 0 ? 'Visible' : pass.culminationSunAltitude > 0 ? 'Daylight' : SHADOW_LABELS[pass.culminationShadow]}</td>
		</tr>
	)
}

// Passes tab.
export function SatellitePasses({ observer }: { readonly observer?: SkyObserverSettings }) {
	const { passes, passesLoading, passesError, selectedPass, selectedId, details, place, passDraft } = useSnapshot(artificialSatellitesState)
	const timeZone = place?.source === 'observer' ? (place.timeZone ?? '') : 'UTC'
	const list = (passes?.passes ?? []).filter((pass) => passDraft.showAll || pass.visible.length > 0)
	const shown = selectedPass === undefined ? undefined : passes?.passes[selectedPass]
	const name = details?.object.name ?? selectedId ?? ''

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto">
			<PassForm observer={observer} />
			{!selectedId && <EmptyState title="No satellite selected" description="Select a satellite in the catalog." />}
			{selectedId && !place && <EmptyState title="No place" description="Choose a place in the panel, or set the Sky observer." />}
			{passesError && <EmptyState title="No passes could be predicted" description={passesError} />}
			{passesLoading && <EmptyState title="Predicting passes" />}
			{passes && !passesLoading && (
				<div className="flex flex-col gap-3 px-4 py-3">
					<div className="text-xs text-ink-300">
						{name} · times {timeZone || 'of this browser'} · {passes.passes.length} passes{passes.truncated ? ' (more were left out)' : ''}
					</div>
					<div className="max-w-md">
						<QualityRow quality={passes.quality} />
					</div>
					{list.length === 0 ? (
						<Note>{passes.passes.length === 0 ? 'No pass above the minimum altitude in this window.' : 'No visible pass in this window: show the daylight passes too to list them.'}</Note>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full border-collapse font-mono text-xs text-ink-200 tabular-nums">
								<thead>
									<tr className="border-b border-line-100 text-left text-ink-300">
										<th className="px-2 py-2 font-normal">Start</th>
										<th className="px-2 py-2 text-right font-normal">Az</th>
										<th className="px-2 py-2 font-normal">Highest</th>
										<th className="px-2 py-2 text-right font-normal">Alt</th>
										<th className="px-2 py-2 font-normal">End</th>
										<th className="px-2 py-2 text-right font-normal">Az</th>
										<th className="px-2 py-2 text-right font-normal">Duration</th>
										<th className="px-2 py-2 text-right font-normal">Range</th>
										<th className="px-2 py-2 font-normal">Conditions</th>
									</tr>
								</thead>
								<tbody>
									{list.map((pass, position) => (
										<PassRow key={pass.start.time} pass={pass} index={passes.passes.indexOf(pass)} position={position} count={list.length} timeZone={timeZone} />
									))}
								</tbody>
							</table>
						</div>
					)}
					{shown && (
						<div className="flex flex-col gap-2">
							<PassProfile pass={shown} />
							<div className="flex flex-wrap gap-2">
								<Button variant="secondary" onClick={() => showSatelliteInSky(selectedId!, name, observer, shown.culmination.time)}>
									View in Sky at the Highest Point
								</Button>
							</div>
							<Note>Altitudes are geometric, without refraction; the curve joins the rise, the highest point, and the set. Visible parts are sunlit while the Sun is below the twilight limit at the place; whether the satellite is bright enough is not known.</Note>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
