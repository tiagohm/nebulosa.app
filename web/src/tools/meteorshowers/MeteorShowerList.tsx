import type { MeteorShowerSummary } from 'api'
import { MISSING } from '../../format'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { ACTIVITY_LABELS, formatOccurrencePeak, formatOccurrencePeriod, STATUS_LABELS } from './meteorshowers.format'

// List of a page of showers: each with its activity now (and which source decided it), the period and maximum of the
// occurrence the page is about, and the typical visual ZHR when the curated data gives one. A shower without curated data
// shows its IAU dates, its mean reference named as such, and no ZHR, never a zero.

// Columns of the list.
const COLUMNS = ['Shower', 'Status', 'Now', 'Period', 'Maximum', { key: 'zhr', label: 'ZHR', numeric: true }] as const

// List of showers.
export function MeteorShowerList({ showers, selected, timeZone, onSelect }: { readonly showers: readonly MeteorShowerSummary[]; readonly selected?: string; readonly timeZone: string; readonly onSelect: (id: string) => void }) {
	return (
		<Table columns={COLUMNS}>
			{showers.map((shower) => {
				const activity = ACTIVITY_LABELS[shower.activityNow.state]
				return (
					<Row key={shower.id} selected={shower.id === selected} onSelect={() => onSelect(shower.id)} title={shower.iauName}>
						<Cell>
							<span className="font-medium text-ink-100">{shower.name}</span>
							<span className="ml-2 text-ink-300">{[shower.code, shower.number === undefined ? undefined : `IAU ${shower.number}`].filter(Boolean).join(' · ')}</span>
						</Cell>
						<Cell>{STATUS_LABELS[shower.status]}</Cell>
						<Cell>
							<StatusBadge tone={activity.tone} label={activity.label} />
						</Cell>
						<Cell>{formatOccurrencePeriod(shower.occurrence, timeZone)}</Cell>
						<Cell>{formatOccurrencePeak(shower.occurrence, timeZone)}</Cell>
						<Cell numeric>{shower.visual?.typicalZhr ?? MISSING}</Cell>
					</Row>
				)
			})}
		</Table>
	)
}
