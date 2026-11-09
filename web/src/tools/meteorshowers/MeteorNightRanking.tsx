import type { MeteorNightRanking as Ranking } from 'api'
import { formatDegrees, formatPercent } from '../../format'
import { Cell, Row, Table } from '../../ui/Table'
import { REASON_LABELS } from './meteorshowers.format'

// Ranking of the evenings of a period for one shower: the nights with a window first, then by the modelled count (when
// a published profile and the observing assumptions apply) or by the geometric suitability (the integral of the sine of
// the radiant altitude over the windows, which ignores how active the shower is and the Moon), then by window length,
// then by date. Each factor is shown by name, so the order can be understood; none is a forecast of what will be seen.

// Columns of the ranking.
function columns(modelled: boolean) {
	return [
		'Evening',
		{ key: 'hours', label: 'Window', numeric: true },
		{ key: 'suitability', label: 'Suitability', numeric: true },
		{ key: 'altitude', label: 'Highest radiant', numeric: true },
		{ key: 'moon', label: 'Moon', numeric: true },
		...(modelled ? [{ key: 'count', label: 'Modelled count', numeric: true }] : []),
		'Note',
	] as const
}

// Ranking of nights.
export function MeteorNightRanking({ ranking, onSelect }: { readonly ranking: Ranking; readonly onSelect: (eveningDate: string) => void }) {
	const modelled = ranking.kind === 'modelled'

	return (
		<div className="flex flex-col gap-1">
			<div className="overflow-x-auto">
				<Table columns={columns(modelled)}>
					{ranking.nights.map((night) => (
						<Row key={night.eveningDate} onSelect={() => onSelect(night.eveningDate)} title="Show this night">
							<Cell>{night.eveningDate}</Cell>
							<Cell numeric>{night.eligible ? `${night.windowHours.toFixed(1)} h` : '—'}</Cell>
							<Cell numeric>{night.eligible ? night.radiantSineHours.toFixed(2) : '—'}</Cell>
							<Cell numeric>{night.maximumRadiantAltitude === undefined ? '—' : formatDegrees(night.maximumRadiantAltitude, 0)}</Cell>
							<Cell numeric>{`${formatPercent(night.moonIlluminationAtBest ?? night.moonIllumination)} lit`}</Cell>
							{modelled && <Cell numeric>{night.expectedCount === undefined ? '—' : night.expectedCount.toFixed(0)}</Cell>}
							<Cell>{night.reasons.map((reason) => REASON_LABELS[reason]).join(' ')}</Cell>
						</Row>
					))}
				</Table>
			</div>
			<p className="m-0 text-xs text-ink-300">
				{modelled
					? 'Ordered by the count modelled from the published activity profile under the assumptions in the panel; a model, never a forecast of what will be seen.'
					: 'Ordered by geometric suitability, the radiant height integrated over the windows in hours. It ignores how active the shower is each night and the Moon, shown apart.'}
			</p>
		</div>
	)
}
