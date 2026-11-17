import type { MeteorNightRanking as Ranking } from 'api'
import { formatDegrees, formatFixed, formatPercent, MISSING } from '../../format'
import { Notice } from '../../ui/Notice'
import { Cell, Row, Table } from '../../ui/Table'
import { formatEvening, VERDICT_LABELS } from './meteorshowers.format'

// Ranking of the evenings of a period for one shower: the nights with a window first, then by the modelled count (when
// a published profile and the observing assumptions apply) or by the geometric opportunity (the radiant height integrated
// over the windows, which ignores how active the shower is and the Moon), then by window length, then by date. The rank
// says the order; the window, the highest radiant, the Moon, and the count are shown by name, so it can be understood, and
// none is a forecast of what will be seen. Choosing a night shows it.

// Columns of the ranking.
function columns(modelled: boolean) {
	return [{ key: 'rank', label: 'Rank', numeric: true }, 'Evening', { key: 'hours', label: 'Window', numeric: true }, { key: 'altitude', label: 'Radiant', numeric: true }, { key: 'moon', label: 'Moon', numeric: true }, ...(modelled ? [{ key: 'count', label: 'Modelled', numeric: true }] : [])] as const
}

// Ranking of nights.
export function MeteorNightRanking({ ranking, eveningDate, onSelect }: { readonly ranking: Ranking; readonly eveningDate?: string; readonly onSelect: (eveningDate: string) => void }) {
	const modelled = ranking.kind === 'modelled'
	const evenings = ranking.nights.map((night) => night.eveningDate).sort()

	return (
		<div className="flex flex-col gap-1">
			{evenings.length > 0 && <Notice>{`${evenings.length} evenings ranked, ${evenings[0]} to ${evenings.at(-1)}. Choose one to show it.`}</Notice>}
			<Table columns={columns(modelled)}>
				{ranking.nights.map((night, index) => (
					<Row key={night.eveningDate} selected={night.eveningDate === eveningDate} onSelect={() => onSelect(night.eveningDate)} title={night.eligible ? 'Show this night' : night.reasons.map((reason) => VERDICT_LABELS[reason]).join(', ')}>
						<Cell numeric>{night.eligible ? index + 1 : MISSING}</Cell>
						<Cell className={night.eligible ? 'text-ink-100' : 'text-ink-300'}>{formatEvening(night.eveningDate)}</Cell>
						<Cell numeric>{night.eligible ? `${formatFixed(night.windowHours, 1)} h` : (VERDICT_LABELS[night.reasons[0] ?? 'noWindow'] ?? MISSING)}</Cell>
						<Cell numeric>{night.maximumRadiantAltitude === undefined ? MISSING : formatDegrees(night.maximumRadiantAltitude, 0)}</Cell>
						<Cell numeric>{`${formatPercent(night.moonIlluminationAtBest ?? night.moonIllumination)} lit`}</Cell>
						{modelled && <Cell numeric>{night.expectedCount === undefined ? MISSING : `≈ ${formatFixed(night.expectedCount, 0)}`}</Cell>}
					</Row>
				))}
			</Table>
			<Notice>{modelled ? 'Ranked by the count modelled from the published activity profile under the assumptions in the panel: a model, never a forecast.' : 'Ranked by how high and how long the radiant stands in the windows; it ignores how active the shower is each night and the Moon, shown apart.'}</Notice>
		</div>
	)
}
