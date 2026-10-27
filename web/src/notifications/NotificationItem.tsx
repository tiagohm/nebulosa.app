import type { NotificationLevel, NotificationRecord } from 'api'
import { cn } from 'cn'
import type { KeyboardEvent } from 'react'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { notificationAge } from './notifications'

// One notification of the notification panel: severity, title, explanation, age, and whether the profile read it.
// Choosing it is reported to the panel, which marks it read and opens its context; dismissing it hides it from the
// lists of the profile. Neither ever commands a device.

// Text color of the icon of each severity.
export const LEVEL_ICON_CLASS: Readonly<Record<NotificationLevel, string>> = {
	info: 'text-ink-200',
	success: 'text-success',
	warning: 'text-accent',
	error: 'text-danger',
}

// Name of each severity, shown beside the icon.
export const LEVEL_TEXT: Readonly<Record<NotificationLevel, string>> = {
	info: 'Info',
	success: 'Success',
	warning: 'Warning',
	error: 'Error',
}

export interface NotificationItemProps {
	readonly record: NotificationRecord
	// Whether the profile has not read it.
	readonly unread: boolean
	// Whether it has a context that can be opened now.
	readonly available: boolean
	// Current instant the age is measured to, Unix milliseconds (UTC).
	readonly now: number
	// Called when the notification is chosen.
	readonly onChoose: () => void
	// Called to hide the notification from the lists of the profile.
	readonly onDismiss: () => void
	// Handles the keys of the item, such as moving within the list.
	readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

// Notification row with its dismiss button.
export function NotificationItem({ record, unread, available, now, onChoose, onDismiss, onKeyDown }: NotificationItemProps) {
	return (
		<li className="flex items-start gap-1 border-b border-line-100 last:border-b-0">
			<button
				type="button"
				data-notification-item
				onClick={onChoose}
				onKeyDown={onKeyDown}
				className="flex min-w-0 flex-1 cursor-pointer gap-2.5 rounded-sm border-0 bg-transparent px-2 py-2.5 text-left text-ink-100 transition-colors duration-150 hover:bg-base-300 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
			>
				<Icon name={record.level} className={cn('mt-px size-[18px]', LEVEL_ICON_CLASS[record.level])} />
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex items-center gap-2">
						<span className={cn('min-w-0 flex-1 truncate text-[13px] leading-5', unread ? 'font-semibold' : 'font-medium text-ink-200')}>{record.title}</span>
						{unread && <span title="Unread" className="size-2 flex-none rounded-full bg-accent" />}
					</span>
					<span className="text-xs leading-4 wrap-break-word text-ink-200">{record.message}</span>
					<span className="text-[11px] leading-4 text-ink-300">
						{LEVEL_TEXT[record.level]} · {notificationAge(record.createdAt, now)}
						{record.target && !available && ' · Context unavailable'}
					</span>
				</span>
			</button>
			<IconButton icon="close" label="Dismiss" className="mt-1.5" onClick={onDismiss} />
		</li>
	)
}
