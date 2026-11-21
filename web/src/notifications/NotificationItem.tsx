import type { NotificationLevel } from 'api'
import { cn } from 'cn'
import type { KeyboardEvent, ReactNode } from 'react'
import { formatAge, formatLocalTime } from '../format'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import type { NotificationGroup } from './notifications'

// One row of the notification panel: notifications that read the same, under the severity word, their count, and New
// while any is unread, then the title, the explanation, and the time of day in the display zone with the age. When its
// context can be opened now the row is the View action, which marks it read and opens it; otherwise it is plain text
// that says why the context cannot open. Marking it read and dismissing it are its own buttons, and dismissing removes
// every notification of the row from the server history. Nothing here ever commands a device.

// Text color of the icon and the severity word of each severity.
export const LEVEL_ICON_CLASS: Readonly<Record<NotificationLevel, string>> = {
	info: 'text-info',
	success: 'text-success',
	warning: 'text-warning',
	error: 'text-danger',
}

// Name of each severity, shown beside the icon.
export const LEVEL_TEXT: Readonly<Record<NotificationLevel, string>> = {
	info: 'Info',
	success: 'Success',
	warning: 'Warning',
	error: 'Error',
}

// Body of a row: severity icon and text.
const BODY_CLASS = 'flex min-w-0 flex-1 gap-2.5 rounded-sm border-0 bg-transparent px-2 py-2.5 text-left text-ink-100'

// Body of a row that opens its context: a hover fill, a pointer, and the focus outline.
const VIEW_CLASS = 'group cursor-pointer transition-colors duration-150 hover:bg-base-300 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none'

// Uppercase tracked word of the first line, the Label style.
const LABEL_CLASS = 'font-medium tracking-[0.08em] uppercase'

export interface NotificationItemProps {
	// Notifications of the row.
	readonly group: NotificationGroup
	// Whether its context can be opened now.
	readonly available: boolean
	// Why its context cannot be opened now; absent when it can, or when it has none.
	readonly reason?: string
	// Name of the connection it concerns, shown while every connection is listed; absent otherwise.
	readonly connection?: string
	// IANA time zone its time of day is read in.
	readonly zone: string
	// Current instant the age is measured to, Unix milliseconds (UTC).
	readonly now: number
	// Called when the row is chosen to open its context.
	readonly onChoose: () => void
	// Called to mark the notifications of the row read.
	readonly onMarkRead: () => void
	// Called to remove the notifications of the row from the server history.
	readonly onDismiss: () => void
	// Handles the keys pressed on any control of the row, such as moving to another row.
	readonly onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => void
}

// Notification row with its read and dismiss buttons.
export function NotificationItem({ group: { record, ids, unreadIds }, available, reason, connection, zone, now, onChoose, onMarkRead, onDismiss, onKeyDown }: NotificationItemProps) {
	const unread = unreadIds.length > 0
	const details = [`${formatLocalTime(record.createdAt, zone, now)} · ${formatAge(record.createdAt, now)}`, connection, reason].filter(Boolean).join(' · ')

	const content: ReactNode = (
		<>
			<Icon name={record.level} className={cn('mt-px size-5 flex-none', LEVEL_ICON_CLASS[record.level])} />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex items-baseline gap-2 text-xs leading-4">
					<span className={cn(LABEL_CLASS, LEVEL_ICON_CLASS[record.level])}>{LEVEL_TEXT[record.level]}</span>
					{ids.length > 1 && <span className="text-ink-300 tabular-nums">×{ids.length}</span>}
					{unread && <span className={cn(LABEL_CLASS, 'text-ink-100')}>New</span>}
				</span>
				<span className={cn('text-sm leading-5 wrap-break-word', unread ? 'font-semibold text-ink-100' : 'font-medium text-ink-200')}>{record.title}</span>
				<span className="text-xs leading-4 wrap-break-word text-ink-200">{record.message}</span>
				<span className="text-xs leading-4 text-ink-300 tabular-nums">{details}</span>
			</span>
		</>
	)

	return (
		<li data-notification-row onKeyDown={onKeyDown} className="flex items-start gap-1 border-b border-line-100 py-1 last:border-b-0">
			{available ? (
				<button type="button" title="View" onClick={onChoose} className={cn(BODY_CLASS, VIEW_CLASS)}>
					{content}
				</button>
			) : (
				<div className={BODY_CLASS}>{content}</div>
			)}
			<div className="flex flex-none flex-col">
				<IconButton icon="close" label={`Dismiss ${record.title}`} onClick={onDismiss} />
				{unread && <IconButton icon="check" label={`Mark ${record.title} as read`} onClick={onMarkRead} />}
			</div>
		</li>
	)
}
