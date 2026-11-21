import type { NotificationLevel } from 'api'
import { cn } from 'cn'
import { type FocusEvent, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Icon } from '../ui/Icon'
import { useLightDismiss } from '../ui/useLightDismiss'
import { type NotificationFilter, NotificationPanel } from './NotificationPanel'
import { notificationsState, unreadText, visibleNotifications, worstLevel } from './notifications'
import { useNotificationScope } from './useNotificationScope'

// Bell of the top bar: the number of unread notifications of the active profile's connection, tinted by the most
// pressing of them, and the notification panel it opens below itself, aligned with its right edge. The bell's name says
// the unread notifications in words; the badge sits outside the button, so its digits never join that name. The panel
// follows the bell when the window resizes, and closes when the bell is pressed again, on a press outside both, on
// Escape (returning the focus to the bell), when the focus leaves both, and after it opened the context of a
// notification. The filter and the connection scope of the panel are kept while the tab lives.

// Largest count the badge shows as a number; higher counts read as "9+".
const MAX_BADGE_COUNT = 9

// Width of the panel, in CSS pixels, when the viewport has room for it.
const PANEL_WIDTH = 380

// Smallest distance kept between the panel and the edges of the viewport, in CSS pixels.
const VIEWPORT_GUTTER = 16

// Distance between the bell and the panel, in CSS pixels.
const PANEL_GAP = 4

// Fill of the badge by the most pressing unread severity, the signal colours of the status words.
const BADGE_CLASS: Readonly<Record<NotificationLevel, string>> = {
	error: 'bg-danger',
	warning: 'bg-warning',
	info: 'bg-info',
	success: 'bg-success',
}

// Position and width of the panel in the viewport, in CSS pixels.
interface PanelPlacement {
	readonly top: number
	readonly right: number
	readonly width: number
}

// Places the panel under a bell, aligned with its right edge but kept inside the viewport.
function placementOf(button: HTMLElement): PanelPlacement {
	const rect = button.getBoundingClientRect()
	const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * VIEWPORT_GUTTER)
	const right = Math.max(VIEWPORT_GUTTER, Math.min(window.innerWidth - rect.right, window.innerWidth - width - VIEWPORT_GUTTER))
	return { top: rect.bottom + PANEL_GAP, right, width }
}

export interface NotificationButtonProps {
	// Classes of the bell button, shared with the other buttons of the bar.
	readonly className: string
}

// Bell button with an unread-count badge and the notification panel.
export function NotificationButton({ className }: NotificationButtonProps) {
	const { records } = useSnapshot(notificationsState)
	const { connection } = useNotificationScope()
	const [placement, setPlacement] = useState<PanelPlacement>()
	const [filter, setFilter] = useState<NotificationFilter>('all')
	const [allConnections, setAllConnections] = useState(false)
	const rootRef = useRef<HTMLSpanElement>(null)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const unread = visibleNotifications(records, connection).filter((record) => !record.read)
	const level = worstLevel(unread)
	const open = !!placement

	useLightDismiss(open, rootRef, (reason) => {
		setPlacement(undefined)
		if (reason === 'escape') buttonRef.current?.focus()
	})

	useEffect(() => {
		if (!open) return

		function handleResize() {
			if (buttonRef.current) setPlacement(placementOf(buttonRef.current))
		}

		window.addEventListener('resize', handleResize)
		return () => window.removeEventListener('resize', handleResize)
	}, [open])

	// Closes the panel once the focus moves to something outside the bell and the panel.
	function handleBlur(e: FocusEvent<HTMLSpanElement>) {
		if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setPlacement(undefined)
	}

	return (
		<span ref={rootRef} onBlur={handleBlur} className="relative flex flex-none">
			<button ref={buttonRef} type="button" title="Notifications" className={cn(className, open && 'bg-base-300 text-ink-100')} onClick={() => setPlacement(open || !buttonRef.current ? undefined : placementOf(buttonRef.current))}>
				<Icon name="bell" />
				<span className="sr-only">Notifications, {unreadText(unread)}</span>
			</button>
			{level && (
				<span className={cn('pointer-events-none absolute top-0.5 right-0.5 box-border flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs leading-none font-semibold text-on-accent tabular-nums', BADGE_CLASS[level])}>
					{unread.length > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : unread.length}
				</span>
			)}
			{placement && <NotificationPanel top={placement.top} right={placement.right} width={placement.width} filter={filter} onFilterChange={setFilter} allConnections={allConnections} onAllConnectionsChange={setAllConnections} onClose={() => setPlacement(undefined)} />}
		</span>
	)
}
