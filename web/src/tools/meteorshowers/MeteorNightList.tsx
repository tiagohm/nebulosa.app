import type { MeteorNightShower } from 'api'
import { cn } from 'cn'
import { formatClockTime, formatDegrees, formatFixed, formatPercent, formatSpan, MISSING } from '../../format'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table, type TableColumn } from '../../ui/Table'
import { daysBetween, eveningOf } from './meteorshowers'
import { bestWindow, formatNightsAway, REASON_LABELS, VERDICT_LABELS } from './meteorshowers.format'

// The curated showers of one night at the tool's location, in the server's order (those with a window first, then by
// modelled count or typical ZHR): each with its verdict in words, its best window, the highest radiant and the Moon then,
// its typical ZHR or modelled count, and how far its maximum is from the night. The list fits the width of its container
// (`@container/list`): below 32 rem the verdict sits under the name, and the Moon and the maximum show from 48 rem.

// Classes of the columns shown only from 32 rem of the list.
const WIDE = 'hidden @lg/list:table-cell'

// Classes of the columns shown only from 48 rem of the list.
const WIDER = 'hidden @3xl/list:table-cell'

// Columns of the list, with the modelled count in place of the typical ZHR when the night is modelled.
function columns(modelled: boolean): TableColumn[] {
	return [
		'Shower',
		{ key: 'verdict', label: 'Verdict', className: WIDE },
		'Best window',
		{ key: 'radiant', label: 'Radiant', numeric: true, className: WIDE },
		{ key: 'moon', label: 'Moon', numeric: true, className: WIDER },
		modelled ? { key: 'count', label: 'Modelled', numeric: true } : { key: 'zhr', label: 'ZHR', numeric: true },
		{ key: 'maximum', label: 'Maximum', className: WIDER },
	]
}

// Verdict of a shower's night: Watchable with a window, else the first reason there is none.
export function NightVerdict({ entry }: { readonly entry: Pick<MeteorNightShower, 'windows' | 'reasons'> }) {
	if (entry.windows.length > 0) return <StatusBadge tone="success" label="Watchable" />
	const reason = entry.reasons[0] ?? 'noWindow'
	return <StatusBadge tone="muted" label={VERDICT_LABELS[reason]} title={entry.reasons.map((e) => REASON_LABELS[e]).join(' ')} />
}

// How far a shower's maximum is from the night: "This night, 20:43", "In 3 nights", "2 nights ago"; the IAU mean reference
// is never a maximum, so a shower without a published one says so.
function maximumText(entry: MeteorNightShower, eveningDate: string, timeZone: string, eveningZone: string) {
	const visual = entry.shower.occurrence?.visual
	if (!visual) return 'Not published'
	const days = daysBetween(eveningDate, eveningOf(visual.peak, eveningZone))
	const relation = formatNightsAway(days)
	const text = `${relation[0].toUpperCase()}${relation.slice(1)}`
	return days === 0 && visual.peakSolarLongitudeDecimals > 0 ? `${text}, ${formatClockTime(visual.peak, timeZone)}` : text
}

// List of the showers of a night.
export function MeteorNightList({
	showers,
	eveningDate,
	selected,
	timeZone,
	eveningZone,
	className,
	onSelect,
}: {
	readonly showers: readonly MeteorNightShower[]
	readonly eveningDate: string
	readonly selected?: string
	// Zone the times are read in.
	readonly timeZone: string
	// Zone of the site, which names the evenings.
	readonly eveningZone: string
	readonly className?: string
	readonly onSelect: (id: string) => void
}) {
	const modelled = showers.some((entry) => entry.kind === 'modelled')

	return (
		<Table columns={columns(modelled)} className={className}>
			{showers.map((entry) => {
				const { shower } = entry
				const best = bestWindow(entry.windows)
				const watchable = best !== undefined
				return (
					<Row key={shower.id} selected={shower.id === selected} onSelect={() => onSelect(shower.id)} title={shower.iauName}>
						<Cell className="min-w-32 whitespace-normal">
							<span className={cn('font-medium', watchable ? 'text-ink-100' : 'text-ink-200')}>{shower.name}</span>
							{shower.code && <span className="ml-2 text-ink-300">{shower.code}</span>}
							<span className="mt-1 flex @lg/list:hidden">
								<NightVerdict entry={entry} />
							</span>
						</Cell>
						<Cell className={WIDE}>
							<NightVerdict entry={entry} />
						</Cell>
						<Cell className={watchable ? 'text-ink-100' : 'text-ink-300'}>{best ? formatSpan(best.start, best.end, timeZone) : MISSING}</Cell>
						<Cell numeric className={WIDE}>
							{best ? formatDegrees(best.maximumRadiantAltitude, 0) : MISSING}
						</Cell>
						<Cell numeric className={WIDER}>
							{best ? `${formatPercent(best.moonIlluminationAtBest)} lit, ${best.moonAltitudeAtBest > 0 ? 'up' : 'down'}` : MISSING}
						</Cell>
						<Cell numeric>{modelled ? (entry.expectedCount === undefined ? MISSING : `≈ ${formatFixed(entry.expectedCount, 0)}`) : (shower.visual?.typicalZhr ?? 'Variable')}</Cell>
						<Cell className={WIDER}>{maximumText(entry, eveningDate, timeZone, eveningZone)}</Cell>
					</Row>
				)
			})}
		</Table>
	)
}
