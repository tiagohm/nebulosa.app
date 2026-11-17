import type { MeteorShowerSummary } from 'api'
import { MISSING } from '../../format'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table, type TableColumn } from '../../ui/Table'
import { ACTIVITY_LABELS, formatOccurrencePeak, formatOccurrencePeriod, STATUS_LABELS } from './meteorshowers.format'

// List of a page of showers: each with its activity now (and which source decided it), the maximum and period of the
// occurrence the page is about, and the typical visual ZHR when the curated data gives one. A shower without curated data
// shows its IAU dates, its mean reference named as such, and no ZHR, never a zero; a maximum already passed in an
// occurrence still active says so. The list fits the width of its container (`@container/list`): the status shows from
// 42 rem and the period from 48 rem.

// Classes of the status column, shown only from 42 rem of the list.
const STATUS = 'hidden @2xl/list:table-cell'

// Classes of the period column, shown only from 48 rem of the list.
const PERIOD = 'hidden @3xl/list:table-cell'

// Columns of the list.
const COLUMNS: readonly TableColumn[] = ['Shower', 'Now', 'Maximum', { key: 'zhr', label: 'ZHR', numeric: true }, { key: 'period', label: 'Period', className: PERIOD }, { key: 'status', label: 'Status', className: STATUS }]

// List of showers.
export function MeteorShowerList({ showers, selected, timeZone, now, className, onSelect }: { readonly showers: readonly MeteorShowerSummary[]; readonly selected?: string; readonly timeZone: string; readonly now: number; readonly className?: string; readonly onSelect: (id: string) => void }) {
	return (
		<Table columns={COLUMNS} className={className}>
			{showers.map((shower) => {
				const activity = ACTIVITY_LABELS[shower.activityNow.state]
				const peak = shower.occurrence?.visual?.peak
				return (
					<Row key={shower.id} selected={shower.id === selected} onSelect={() => onSelect(shower.id)} title={shower.iauName}>
						<Cell className="min-w-32 whitespace-normal">
							<span className="font-medium text-ink-100">{shower.name}</span>
							<span className="ml-2 text-ink-300">{[shower.code, shower.number === undefined ? undefined : `IAU ${shower.number}`].filter(Boolean).join(' · ')}</span>
						</Cell>
						<Cell>
							<StatusBadge tone={activity.tone} label={activity.label} />
						</Cell>
						<Cell>
							{formatOccurrencePeak(shower.occurrence, timeZone)}
							{peak !== undefined && peak < now && <span className="text-ink-300"> (passed)</span>}
						</Cell>
						<Cell numeric>{shower.visual?.typicalZhr ?? MISSING}</Cell>
						<Cell className={PERIOD}>{formatOccurrencePeriod(shower.occurrence, timeZone)}</Cell>
						<Cell className={STATUS}>{STATUS_LABELS[shower.status]}</Cell>
					</Row>
				)
			})}
		</Table>
	)
}
