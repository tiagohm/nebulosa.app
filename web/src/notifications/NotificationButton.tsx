import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Icon } from '../ui/Icon'
import { NotificationPanel } from './NotificationPanel'
import { notificationsState, unreadCount } from './notifications'
import { useNotificationScope } from './useNotificationScope'

// Bell of the top bar: the number of notifications of the active profile's connection the profile has not read, and
// the notification panel it opens below itself, aligned with its right edge. The panel closes when the bell is pressed
// again, on a press outside both, on Escape (returning the focus to the bell), when the window resizes, and after it
// opened the context of a notification.

// Largest count the badge shows as a number; higher counts read as "9+".
const MAX_BADGE_COUNT = 9

// Width of the panel, in CSS pixels, when the viewport has room for it.
const PANEL_WIDTH = 380

// Smallest distance kept between the panel and the edges of the viewport, in CSS pixels.
const VIEWPORT_GUTTER = 16

// Distance between the bell and the panel, in CSS pixels.
const PANEL_GAP = 4

// Position and width of the panel in the viewport, in CSS pixels.
interface PanelPlacement {
	readonly top: number
	readonly right: number
	readonly width: number
}

export interface NotificationButtonProps {
	// Classes of the bell button, shared with the other buttons of the bar.
	readonly className: string
}

// Bell button with an unread-count badge and the notification panel.
export function NotificationButton({ className }: NotificationButtonProps) {
	const { records } = useSnapshot(notificationsState)
	const { connection, preferences } = useNotificationScope()
	const [placement, setPlacement] = useState<PanelPlacement>()
	const rootRef = useRef<HTMLSpanElement>(null)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const count = unreadCount(records, preferences, connection)
	const open = !!placement

	// Places the panel under the bell, aligned with its right edge but kept inside the viewport.
	function show() {
		const rect = buttonRef.current?.getBoundingClientRect()
		if (!rect) return
		const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * VIEWPORT_GUTTER)
		const right = Math.max(VIEWPORT_GUTTER, Math.min(window.innerWidth - rect.right, window.innerWidth - width - VIEWPORT_GUTTER))
		setPlacement({ top: rect.bottom + PANEL_GAP, right, width })
	}

	useEffect(() => {
		if (!open) return

		function handlePointerDown(e: MouseEvent) {
			if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setPlacement(undefined)
		}

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key !== 'Escape' || e.defaultPrevented) return
			setPlacement(undefined)
			buttonRef.current?.focus()
		}

		function handleResize() {
			setPlacement(undefined)
		}

		document.addEventListener('mousedown', handlePointerDown)
		document.addEventListener('keydown', handleKeyDown)
		window.addEventListener('resize', handleResize)

		return () => {
			document.removeEventListener('mousedown', handlePointerDown)
			document.removeEventListener('keydown', handleKeyDown)
			window.removeEventListener('resize', handleResize)
		}
	}, [open])

	return (
		<span ref={rootRef} className="flex flex-none">
			<button ref={buttonRef} type="button" title="Notifications" className={cn(className, open && 'bg-base-300 text-ink-100')} onClick={() => (open ? setPlacement(undefined) : show())}>
				<Icon name="bell" />
				{count > 0 && <span className="absolute top-0.5 right-0.5 box-border flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-on-accent tabular-nums">{count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : count}</span>}
				<span className="sr-only">{count > 0 ? `${count} unread` : 'No unread notifications'}</span>
			</button>
			{placement && <NotificationPanel top={placement.top} right={placement.right} width={placement.width} onClose={() => setPlacement(undefined)} />}
		</span>
	)
}
