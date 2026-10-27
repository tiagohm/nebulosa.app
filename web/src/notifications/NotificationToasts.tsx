import type { NotificationLevel, NotificationRecord } from 'api'
import { cn } from 'cn'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { deviceState } from '../equipment/equipment'
import { imagesState } from '../images/images'
import { markNotificationsRead, profileState } from '../profile/profile'
import { routeState } from '../shell/route'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { LEVEL_ICON_CLASS } from './NotificationItem'
import { dismissToast, inScope, notificationsState } from './notifications'
import { openNotificationTarget, targetAvailable } from './target'
import { useNotificationScope } from './useNotificationScope'

// Toasts of the notifications that arrived live for the active profile's connection, stacked at the bottom right
// above the status bar, at most MAX_TOASTS. Each disappears after its duration or when closed, without marking its
// notification read; View opens its context and marks it read. A toast never offers to confirm a device action.
// Toasts of other connections, or of notifications the profile dismissed, are dropped unseen.

// Time a toast stays, in milliseconds, by severity; info notifications never become toasts.
const TOAST_DURATION: Readonly<Record<NotificationLevel, number>> = { info: 2000, success: 2000, warning: 4000, error: 5000 }

// Host of the toasts, mounted once by the application shell.
export function NotificationToasts() {
	const { toasts } = useSnapshot(notificationsState)
	const { connection, preferences } = useNotificationScope()
	const shown = toasts.filter((toast) => inScope(toast, connection) && !preferences?.dismissedIds.includes(toast.id))

	useEffect(() => {
		for (const toast of toasts) {
			if (!inScope(toast, connection) || preferences?.dismissedIds.includes(toast.id)) dismissToast(notificationsState, toast.id)
		}
	}, [toasts, connection, preferences])

	if (shown.length === 0) return null

	return (
		<div className="pointer-events-none fixed right-4 bottom-10 z-40 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2">
			{shown.map((toast) => (
				<Toast key={toast.id} record={toast} />
			))}
		</div>
	)
}

interface ToastProps {
	readonly record: NotificationRecord
}

// One toast, removed when its duration elapses.
function Toast({ record }: ToastProps) {
	const { documents } = useSnapshot(imagesState)
	const { devices } = useSnapshot(deviceState)
	useEffect(() => {
		const timer = setTimeout(() => dismissToast(notificationsState, record.id), TOAST_DURATION[record.level])
		return () => clearTimeout(timer)
	}, [record.id, record.level])

	// Opens the context of the notification and marks it read.
	function view() {
		markNotificationsRead(profileState, [record.id])
		openNotificationTarget(record.target, { images: imagesState, route: routeState, devices: deviceState.devices })
		dismissToast(notificationsState, record.id)
	}

	return (
		<div
			className={cn(
				'pointer-events-auto box-border flex items-start gap-2.5 rounded-md border border-line-100 border-l-4 bg-base-200 py-2.5 pr-1.5 pl-3 text-ink-100 shadow-[0_12px_32px_rgb(0_0_0/0.45)]',
				record.level === 'error' ? 'border-l-danger' : record.level === 'warning' ? 'border-l-accent' : 'border-l-success',
			)}
		>
			<Icon name={record.level} className={cn('mt-px size-[18px]', LEVEL_ICON_CLASS[record.level])} />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-[13px] leading-5 font-semibold">{record.title}</span>
				<span className="text-xs leading-4 wrap-break-word text-ink-200">{record.message}</span>
				{targetAvailable(record.target, { documents, devices }) && (
					<button type="button" onClick={view} className="mt-1 cursor-pointer self-start rounded-sm border-0 bg-transparent p-0 text-xs font-medium text-accent hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-accent">
						View
					</button>
				)}
			</div>
			<IconButton icon="close" label="Close" onClick={() => dismissToast(notificationsState, record.id)} />
		</div>
	)
}
