import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { connectionState } from '../connection/connection'
import { deviceState } from '../equipment/equipment'
import { imagesState } from '../images/images'
import { useActiveSite, useDisplayZone } from '../location/useLocation'
import { routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { ConfirmButton } from '../ui/ConfirmButton'
import { SegmentedControl } from '../ui/SegmentedControl'
import { NotificationItem } from './NotificationItem'
import { connectionName, dismissNotifications, groupNotifications, markNotificationsRead, type NotificationGroup, needsOperator, notificationsState, visibleNotifications } from './notifications'
import { openNotificationTarget, targetAvailable, unavailableReason } from './target'
import { useNotificationScope } from './useNotificationScope'

// Floating panel of the bell: the notifications of the active profile's connection (or of every connection), newest
// first, filtered to the unread ones on demand. Notifications that read the same share one row with a count, and the
// unread warnings and errors lead under Needs you, so what asks for the operator never sinks below later successes. The
// header says in words what needs the operator and how much is unread. Dismissing what the list shows asks first, since
// it removes the notifications from the history of every tab and profile; the filter and the scope choose what it
// reaches. Reading and dismissing change the server history, so they reach every tab; opening a context changes only what
// the tab shows. Every device is left as it is.

// Filter of the list.
export type NotificationFilter = 'all' | 'unread'

// Filters in display order.
const FILTERS: readonly NotificationFilter[] = ['all', 'unread']

// Display text of each filter.
const FILTER_TEXT: Readonly<Record<NotificationFilter, string>> = { all: 'All', unread: 'Unread' }

// Time between two updates of the ages of the rows while the panel stays open, in milliseconds.
const AGE_REFRESH = 30000

export interface NotificationPanelProps {
	// Distance from the top of the viewport, in CSS pixels.
	readonly top: number
	// Distance from the right of the viewport, in CSS pixels.
	readonly right: number
	// Width, in CSS pixels.
	readonly width: number
	// Filter of the list.
	readonly filter: NotificationFilter
	// Called with the filter chosen.
	readonly onFilterChange: (filter: NotificationFilter) => void
	// Whether the notifications of every connection are listed, not only those of the active profile's connection.
	readonly allConnections: boolean
	// Called with the connection scope chosen.
	readonly onAllConnectionsChange: (allConnections: boolean) => void
	// Called to close the panel after a context opened.
	readonly onClose: () => void
}

// Notification panel.
export function NotificationPanel({ top, right, width, filter, onFilterChange, allConnections, onAllConnectionsChange, onClose }: NotificationPanelProps) {
	const { records } = useSnapshot(notificationsState)
	const { documents } = useSnapshot(imagesState)
	const { devices } = useSnapshot(deviceState)
	const { connections } = useSnapshot(connectionState)
	const { connection } = useNotificationScope()
	const { zone } = useDisplayZone(useActiveSite())
	const [now, setNow] = useState(() => Date.now())
	const listRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), AGE_REFRESH)
		return () => clearInterval(timer)
	}, [])

	const listed = visibleNotifications(records, connection, allConnections)
	const unread = listed.filter((record) => !record.read)
	const shown = filter === 'unread' ? unread : listed
	const groups = groupNotifications(shown)
	const attention = groups.filter(needsOperator)
	const others = groups.filter((group) => !needsOperator(group))
	const needed = groupNotifications(unread).filter(needsOperator).length

	// Marks a group read and opens its context, closing the panel when it opened.
	function choose(group: NotificationGroup) {
		void markNotificationsRead(group.unreadIds)
		if (openNotificationTarget(group.record.target, { images: imagesState, route: routeState, devices: deviceState.devices })) onClose()
	}

	// Moves the focus to the first control of another row with Up, Down, Home, and End, from any control of a row.
	function handleRowKeyDown(e: KeyboardEvent<HTMLLIElement>) {
		const rows = Array.from(listRef.current?.querySelectorAll<HTMLLIElement>('[data-notification-row]') ?? [])
		const index = rows.indexOf(e.currentTarget)
		const next = e.key === 'ArrowDown' ? index + 1 : e.key === 'ArrowUp' ? index - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : undefined
		if (next === undefined) return
		e.preventDefault()
		rows[Math.max(0, Math.min(rows.length - 1, next))]?.querySelector('button')?.focus()
	}

	// Renders the rows of groups.
	function rows(list: readonly NotificationGroup[]) {
		return list.map((group) => {
			const { record } = group
			const available = targetAvailable(record.target, { documents, devices })
			return (
				<NotificationItem
					key={record.id}
					group={group}
					available={available}
					reason={record.target && !available ? unavailableReason(record.target) : undefined}
					connection={allConnections ? connectionName(record, connections) : undefined}
					zone={zone}
					now={now}
					onChoose={() => choose(group)}
					onMarkRead={() => void markNotificationsRead(group.unreadIds)}
					onDismiss={() => void dismissNotifications(group.ids)}
					onKeyDown={handleRowKeyDown}
				/>
			)
		})
	}

	const dismissLabel = filter === 'unread' ? 'Dismiss unread' : 'Dismiss all'
	const dismissCount = `${shown.length} ${filter === 'unread' ? 'unread ' : ''}${shown.length === 1 ? 'notification' : 'notifications'}`

	return (
		<div style={{ top, right, width, maxHeight: `calc(100dvh - ${top + 16}px)` }} className="fixed z-30 box-border flex flex-col rounded-md border border-line-100 bg-base-200 text-sm shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
			<div className="flex flex-col gap-2 p-3">
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 flex-col gap-0.5">
						<h2 className="m-0 text-sm font-semibold text-ink-100">Notifications</h2>
						<p className="m-0 text-xs text-ink-300 tabular-nums">
							<span className={needed > 0 ? 'font-medium text-ink-100' : undefined}>{needed === 0 ? 'Nothing needs you' : `${needed} ${needed === 1 ? 'needs' : 'need'} you`}</span> · {unread.length} unread
						</p>
					</div>
					<SegmentedControl options={FILTERS} value={filter} onChange={onFilterChange} format={(value) => FILTER_TEXT[value]} className="w-36 flex-none" />
				</div>
				<Checkbox label="All connections" title="List the notifications of every connection, each naming its connection" checked={allConnections} onChange={onAllConnectionsChange} className="my-0 min-h-6 self-start" />
			</div>
			{groups.length > 0 ? (
				<div ref={listRef} className="flex min-h-0 flex-col overflow-y-auto border-t border-line-100 px-2 pb-1">
					{attention.length > 0 && <NotificationSection title="Needs you">{rows(attention)}</NotificationSection>}
					{others.length > 0 && <NotificationSection title={attention.length > 0 ? 'Others' : undefined}>{rows(others)}</NotificationSection>}
				</div>
			) : (
				<p className="m-0 border-t border-line-100 px-3 py-6 text-center text-xs text-ink-300">{filter === 'unread' ? 'No unread notifications.' : connection || allConnections ? 'No notifications.' : 'No notifications. Select a connection or show all connections.'}</p>
			)}
			<div className="flex flex-wrap justify-end gap-2 border-t border-line-100 p-3">
				<Button variant="secondary" disabled={unread.length === 0} onClick={() => void markNotificationsRead(unread.map((record) => record.id))}>
					Mark all as read
				</Button>
				<ConfirmButton destructive disabled={shown.length === 0} title={`Dismiss ${dismissCount}?`} message={`They leave the history of every tab and profile, and cannot be brought back.`} confirmLabel="Dismiss" onConfirm={() => void dismissNotifications(shown.map((record) => record.id))}>
					{dismissLabel}
				</ConfirmButton>
			</div>
		</div>
	)
}

interface NotificationSectionProps {
	// Uppercase heading of the section; absent when the list has one section, which needs none.
	readonly title?: string
	// Rows of the section.
	readonly children: ReactNode
}

// Section of the list, under its heading when there is more than one.
function NotificationSection({ title, children }: NotificationSectionProps) {
	return (
		<section className="flex flex-col">
			{title && <h3 className="m-0 px-1 pt-3 pb-1 text-xs font-medium tracking-[0.08em] text-ink-300 uppercase">{title}</h3>}
			<ul className="m-0 flex list-none flex-col p-0">{children}</ul>
		</section>
	)
}
