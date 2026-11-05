import { useSnapshot } from 'valtio'
import { MISSING, formatDegrees } from '../../format'
import type { SkyObserverSettings } from '../../profile/schema'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { formatDeclination, formatRightAscension } from '../../sky/format'
import { Button } from '../../ui/Button'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Note } from '../eclipse/EclipsePanelParts'
import { artificialSatellitesState, downloadEphemerisCsv, ephemerisDraftError, ephemerisRowCount, formatSatelliteTime, loadSatelliteEphemeris, MAX_EPHEMERIS_HOURS, SHADOW_LABELS } from './artificialsatellites'
import { QualityRow } from './SatelliteDetailsPanel'

// Ephemeris tab of Artificial Satellites: positions of the satellite selected sampled from now or from the Sky's time,
// for the Sky observer or the Earth's center without one, with an export of the rows received as CSV. Positions are geometric:
// RA/Dec of date (the Sky's frame) and the altitude without refraction.

// Ephemeris tab.
export function SatelliteEphemeris({ observer }: { readonly observer?: SkyObserverSettings }) {
	const { ephemerisDraft, ephemeris, ephemerisLoading, ephemerisError, selectedId, details } = useSnapshot(artificialSatellitesState)
	const draft = artificialSatellitesState.ephemerisDraft
	const inputError = ephemerisDraftError(ephemerisDraft)
	const timeZone = observer?.timeZone ?? ''
	const name = details?.object.name ?? selectedId ?? 'satellite'
	const rows = ephemeris?.rows ?? []

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto">
			<form
				onSubmit={(event) => {
					event.preventDefault()
					void loadSatelliteEphemeris(artificialSatellitesState, observer)
				}}
				className="flex flex-none flex-wrap items-end gap-2 border-b border-line-100 bg-base-100 px-4 py-3"
			>
				<SegmentedControl label="From" options={['now', 'sky'] as const} value={ephemerisDraft.start} format={(value) => (value === 'now' ? 'Now' : 'Sky Time')} onChange={(value) => (draft.start = value)} />
				<NumberInput label="Length" suffix="h" className="w-28" min={0.5} max={MAX_EPHEMERIS_HOURS} step={0.5} value={ephemerisDraft.hours} onChange={(value) => (draft.hours = value)} />
				<NumberInput label="Step" suffix="s" className="w-28" min={1} step={1} value={ephemerisDraft.stepSeconds} onChange={(value) => (draft.stepSeconds = value)} />
				<span className="flex h-9.5 items-center text-xs text-ink-300">{ephemerisRowCount(ephemerisDraft)} rows</span>
				<div className="ml-auto flex gap-2">
					<Button variant="secondary" disabled={rows.length === 0} title={rows.length === 0 ? 'Compute an ephemeris first.' : 'Saves the rows shown as a CSV file.'} onClick={() => downloadEphemerisCsv(rows, timeZone, `${name} ephemeris`)}>
						Export CSV
					</Button>
					<Button type="submit" disabled={ephemerisLoading || !selectedId || !!inputError} title={!selectedId ? 'Select a satellite in the catalog.' : inputError}>
						Compute
					</Button>
				</div>
			</form>
			{inputError && (
				<div className="px-4 pt-3">
					<Note danger>{inputError}</Note>
				</div>
			)}
			{!selectedId && <EmptyState title="No satellite selected" description="Select a satellite in the catalog." />}
			{ephemerisError && <EmptyState title="No ephemeris could be computed" description={ephemerisError} />}
			{ephemerisLoading && <EmptyState title="Computing" />}
			{ephemeris && !ephemerisLoading && (
				<div className="flex flex-col gap-2 px-4 py-3">
					<div className="text-xs text-ink-300">
						{name} · {observer ? 'from the observer' : "from the Earth's center"} · times {timeZone || 'of this browser'} · RA/Dec of date, geometric{ephemeris.truncated ? ' · more rows were left out' : ''}
					</div>
					<div className="max-w-md">
						<QualityRow quality={ephemeris.quality} />
					</div>
					<div className="overflow-x-auto">
						<table className="w-full border-collapse font-mono text-xs text-ink-200 tabular-nums">
							<thead>
								<tr className="border-b border-line-100 text-left text-ink-300">
									<th className="px-2 py-2 font-normal">Time</th>
									<th className="px-2 py-2 font-normal">RA</th>
									<th className="px-2 py-2 font-normal">Dec</th>
									<th className="px-2 py-2 text-right font-normal">Az</th>
									<th className="px-2 py-2 text-right font-normal">Alt</th>
									<th className="px-2 py-2 text-right font-normal">Distance</th>
									<th className="px-2 py-2 text-right font-normal">Range rate</th>
									<th className="px-2 py-2 text-right font-normal">Height</th>
									<th className="px-2 py-2 font-normal">Illumination</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => (
									<tr key={row.time} className="border-b border-line-100">
										<td className="px-2 py-1 whitespace-nowrap">{formatSatelliteTime(row.time, timeZone)}</td>
										<td className="px-2 py-1 whitespace-nowrap">{formatRightAscension(row.rightAscension)}</td>
										<td className="px-2 py-1 whitespace-nowrap">{formatDeclination(row.declination)}</td>
										<td className="px-2 py-1 text-right">{row.azimuth === undefined ? MISSING : formatDegrees(row.azimuth, 1)}</td>
										<td className="px-2 py-1 text-right">{row.altitude === undefined ? MISSING : formatDegrees(row.altitude, 1)}</td>
										<td className="px-2 py-1 text-right">{row.distanceKm.toFixed(0)} km</td>
										<td className="px-2 py-1 text-right">{row.rangeRateKmPerSecond === undefined ? MISSING : `${row.rangeRateKmPerSecond.toFixed(2)} km/s`}</td>
										<td className="px-2 py-1 text-right">{row.heightKm.toFixed(0)} km</td>
										<td className="px-2 py-1">{SHADOW_LABELS[row.shadow]}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	)
}
