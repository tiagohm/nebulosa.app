import { useSnapshot } from 'valtio'
import { formatDegrees, formatKilometers, MISSING } from '../../format'
import type { GeographicLocation } from '../../location/site'
import { type DisplayZone, describeDisplayZone } from '../../location/zone'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { formatDeclination, formatRightAscension } from '../../sky/format'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Cell, Row, Table, type TableColumn } from '../../ui/Table'
import { artificialSatellitesState, downloadEphemerisCsv, ephemerisDraftError, ephemerisRowCount, formatSatelliteTime, loadSatelliteEphemeris, MAX_EPHEMERIS_HOURS, SHADOW_LABELS } from './artificialsatellites'
import { QualityRow } from './SatelliteDetailsPanel'

// Ephemeris tab of Artificial Satellites: positions of the satellite selected sampled from now or from the Sky's time,
// for the observing site of the active profile or the Earth's center without one, with an export of the rows received
// as CSV. Times are shown, and exported, in the display zone. Positions are geometric: RA/Dec of date (the Sky's frame)
// and the altitude without refraction.

// Columns of the table of positions.
const EPHEMERIS_COLUMNS: readonly TableColumn[] = [
	'Time',
	'RA',
	'Dec',
	{ key: 'azimuth', label: 'Az', numeric: true },
	{ key: 'altitude', label: 'Alt', numeric: true },
	{ key: 'distance', label: 'Distance', numeric: true },
	{ key: 'rangeRate', label: 'Range rate', numeric: true },
	{ key: 'height', label: 'Height', numeric: true },
	'Illumination',
]

// Properties of the Ephemeris tab.
interface SatelliteEphemerisProps {
	// Observing site of the active profile, which the positions are for; absent for the Earth's center.
	readonly observer?: GeographicLocation
	// Zone the times are shown and exported in.
	readonly zone: DisplayZone
}

// Ephemeris tab.
export function SatelliteEphemeris({ observer, zone }: SatelliteEphemerisProps) {
	const { ephemerisDraft, ephemeris, ephemerisLoading, ephemerisError, selectedId, details } = useSnapshot(artificialSatellitesState)
	const draft = artificialSatellitesState.ephemerisDraft
	const inputError = ephemerisDraftError(ephemerisDraft)
	const timeZone = zone.zone
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
					<Notice error>{inputError}</Notice>
				</div>
			)}
			{!selectedId && <EmptyState title="No satellite selected" description="Select a satellite in the catalog." />}
			{ephemerisError && <EmptyState title="No ephemeris could be computed" description={ephemerisError} />}
			{ephemerisLoading && <EmptyState title="Computing" />}
			{ephemeris && !ephemerisLoading && (
				<div className="flex flex-col gap-2 px-4 py-3">
					<div className="text-xs text-ink-300">
						{name} · {observer ? 'from the observing site' : "from the Earth's center"} · times {describeDisplayZone(zone)} · RA/Dec of date, geometric{ephemeris.truncated ? ' · more rows were left out' : ''}
					</div>
					<div className="max-w-md">
						<QualityRow quality={ephemeris.quality} />
					</div>
					<Table columns={EPHEMERIS_COLUMNS}>
						{rows.map((row) => (
							<Row key={row.time}>
								<Cell>{formatSatelliteTime(row.time, timeZone)}</Cell>
								<Cell>{formatRightAscension(row.rightAscension)}</Cell>
								<Cell>{formatDeclination(row.declination)}</Cell>
								<Cell numeric>{row.azimuth === undefined ? MISSING : formatDegrees(row.azimuth, 1)}</Cell>
								<Cell numeric>{row.altitude === undefined ? MISSING : formatDegrees(row.altitude, 1)}</Cell>
								<Cell numeric>{formatKilometers(row.distanceKm)}</Cell>
								<Cell numeric>{row.rangeRateKmPerSecond === undefined ? MISSING : `${row.rangeRateKmPerSecond.toFixed(2)} km/s`}</Cell>
								<Cell numeric>{formatKilometers(row.heightKm)}</Cell>
								<Cell>{SHADOW_LABELS[row.shadow]}</Cell>
							</Row>
						))}
					</Table>
				</div>
			)}
		</div>
	)
}
