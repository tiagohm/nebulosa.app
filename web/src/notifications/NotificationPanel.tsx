import type { NotificationRecord } from 'api'
import { type KeyboardEvent, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { deviceState } from '../equipment/equipment'
import { imagesState } from '../images/images'
import { dismissNotifications, markNotificationsRead, profileState } from '../profile/profile'
import { routeState } from '../shell/route'
import { Checkbox } from '../ui/Checkbox'
import { SegmentedControl } from '../ui/SegmentedControl'
import { NotificationItem } from './NotificationItem'
import { isUnread, notificationsState, visibleNotifications } from './notifications'
import { openNotificationTarget, targetAvailable } from './target'
import { useNotificationScope } from './useNotificationScope'

// Floating panel of the bell: the notifications of the active profile's connection (or of every connection), newest
// first, filtered to the unread ones on demand. Dismiss all hides what the list shows, so the filter and the scope
// choose what it reaches. Reading, dismissing, and opening a context change only the profile's preferences and what
// the tab shows; the server history and every device are left as they are.

// Filter of the list.
type NotificationFilter = 'all' | 'unread'

// Filters in display order.
const FILTERS: readonly NotificationFilter[] = ['all', 'unread']

// Display text of each filter.
const FILTER_TEXT: Readonly<Record<NotificationFilter, string>> = { all: 'All', unread: 'Unread' }

// Classes of the text buttons of the header.
const HEADER_ACTION_CLASS = 'cursor-pointer rounded-sm border-0 bg-transparent px-1 py-0.5 text-xs font-medium whitespace-nowrap text-accent hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-ink-300'

export interface NotificationPanelProps {
	// Distance from the top of the viewport, in CSS pixels.
	readonly top: number
	// Distance from the right of the viewport, in CSS pixels.
	readonly right: number
	// Width, in CSS pixels.
	readonly width: number
	// Called to close the panel after a context opened.
	readonly onClose: () => void
}

// Notification panel.
export function NotificationPanel({ top, right, width, onClose }: NotificationPanelProps) {
	const { records } = useSnapshot(notificationsState)
	const { documents } = useSnapshot(imagesState)
	const { devices } = useSnapshot(deviceState)
	const { connection, preferences } = useNotificationScope()
	const [filter, setFilter] = useState<NotificationFilter>('all')
	const [allConnections, setAllConnections] = useState(false)
	// Instant the ages are measured to; the panel is short-lived, so it is taken when it opens.
	const [now] = useState(() => Date.now())
	const listRef = useRef<HTMLUListElement>(null)

	const listed = visibleNotifications(records, preferences, connection, allConnections)
	const unread = listed.filter((record) => isUnread(record, preferences))
	const shown = filter === 'unread' ? unread : listed

	// Marks a notification read and opens its context, closing the panel when it opened.
	function choose(record: NotificationRecord) {
		markNotificationsRead(profileState, [record.id])
		if (openNotificationTarget(record.target, { images: imagesState, route: routeState, devices: deviceState.devices })) onClose()
	}

	// Moves the focus within the list with Up, Down, Home, and End.
	function handleItemKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
		const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-notification-item]') ?? [])
		const index = items.indexOf(e.currentTarget)
		const next = e.key === 'ArrowDown' ? index + 1 : e.key === 'ArrowUp' ? index - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : undefined
		if (next === undefined) return
		e.preventDefault()
		items[Math.max(0, Math.min(items.length - 1, next))]?.focus()
	}

	return (
		<div style={{ top, right, width, maxHeight: `calc(100dvh - ${top + 16}px)` }} className="fixed z-30 box-border flex flex-col gap-3 rounded-md border border-line-100 bg-base-200 p-3 text-sm shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
			<div className="flex flex-wrap items-center gap-2">
				<h4 className="m-0 text-sm font-semibold text-ink-100">Notifications</h4>
				<span className="text-xs text-ink-300 tabular-nums">{unread.length} unread</span>
				<div className="ml-auto flex items-center gap-1">
					<button
						type="button"
						disabled={unread.length === 0}
						onClick={() =>
							markNotificationsRead(
								profileState,
								unread.map((record) => record.id),
							)
						}
						className={HEADER_ACTION_CLASS}
					>
						Mark all as read
					</button>
					<button
						type="button"
						disabled={shown.length === 0}
						onClick={() =>
							dismissNotifications(
								profileState,
								shown.map((record) => record.id),
							)
						}
						className={HEADER_ACTION_CLASS}
					>
						Dismiss all
					</button>
				</div>
			</div>
			<div className="flex items-center gap-3">
				<SegmentedControl options={FILTERS} value={filter} onChange={setFilter} format={(value) => FILTER_TEXT[value]} className="w-40 flex-none" />
				<Checkbox label="All connections" checked={allConnections} onChange={setAllConnections} />
			</div>
			{shown.length > 0 ? (
				<ul ref={listRef} className="m-0 -mx-1 flex min-h-0 list-none flex-col overflow-y-auto p-0">
					{shown.map((record) => (
						<NotificationItem key={record.id} record={record} unread={isUnread(record, preferences)} available={targetAvailable(record.target, { documents, devices })} now={now} onChoose={() => choose(record)} onDismiss={() => dismissNotifications(profileState, [record.id])} onKeyDown={handleItemKeyDown} />
					))}
				</ul>
			) : (
				<p className="m-0 py-6 text-center text-xs text-ink-300">{filter === 'unread' ? 'No unread notifications.' : connection || allConnections ? 'No notifications.' : 'No notifications. Select a connection or show all connections.'}</p>
			)}
		</div>
	)
}
