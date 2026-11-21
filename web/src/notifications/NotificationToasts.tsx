import type { NotificationLevel } from 'api'
import { cn } from 'cn'
import { type FocusEvent, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { deviceState } from '../equipment/equipment'
import { imagesState } from '../images/images'
import { routeState } from '../shell/route'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { LEVEL_ICON_CLASS, LEVEL_TEXT } from './NotificationItem'
import { dismissToast, inScope, markNotificationsRead, type NotificationToast, notificationsState, toastDuration } from './notifications'
import { openNotificationTarget, targetAvailable } from './target'
import { useNotificationScope } from './useNotificationScope'

// Toasts of the notifications that arrived live for the active profile's connection, stacked at the bottom right
// above the status bar, beside the contextual panel while it is docked, at most MAX_TOASTS. Each writes its severity
// as a word, and notifications that read the same share one toast with a count. A success hides itself after its
// reading time (toastDuration), which stops while the toast is hovered or focused; an error or a warning stays until
// hidden or viewed. Hiding never marks the notification read; when its context can be opened now, the whole toast is
// the View action, which opens it and marks every merged notification read. A toast never offers to confirm a device
// action. Toasts of other connections are dropped unseen; a notification dismissed in any tab leaves the toasts with
// the history.
//
// Above them, a toast of the tab itself reports a lost server: shown once the event socket stayed closed for
// LOST_GRACE, so a quick restart shows nothing, and replaced by a short reconnected toast when it opens again. It is
// never part of the server history, which cannot report the loss of its own server.

// Time the event socket stays closed before the lost server toast shows, in milliseconds; over the reconnect delay of
// the socket, so one failed reopen is tolerated.
const LOST_GRACE = 5000

// Time the reconnected toast stays, in milliseconds.
const RECONNECTED_DURATION = 3000

// Toast of the tab about its server: lost while the socket stays closed, reconnected once it opens again.
type ServerToast = 'lost' | 'reconnected'

// Border of a toast by severity: errors and warnings tinted at half strength, as the status badges are, and
// successes on the neutral line, so they stay quiet.
const LEVEL_BORDER_CLASS: Readonly<Record<NotificationLevel, string>> = {
	info: 'border-line-100',
	success: 'border-line-100',
	warning: 'border-warning/50',
	error: 'border-danger/50',
}

// Frame of every toast: a floating layer that fades in over 150 ms, or at once when motion is reduced.
const TOAST_CLASS = 'pointer-events-auto box-border flex items-start gap-1 rounded-md border bg-base-200 p-1 text-ink-100 shadow-[0_12px_32px_rgb(0_0_0/0.45)] transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none'

// Body of a toast: severity icon and text.
const BODY_CLASS = 'flex min-w-0 flex-1 gap-2.5 rounded-sm border-0 bg-transparent px-2 py-2 text-left text-ink-100'

// Body of a toast that opens its context: the hover fill and focus outline of the panel's rows.
const VIEW_CLASS = 'group cursor-pointer transition-colors duration-150 hover:bg-base-300 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none'

// Follows the event socket and returns the server toast to show, and a function that closes it.
function useServerToast(): readonly [ServerToast | undefined, () => void] {
	const { server } = useSnapshot(notificationsState)
	const [shown, setShown] = useState<ServerToast>()
	// Whether the lost toast showed since the socket last opened, closed or not.
	const lost = useRef(false)

	useEffect(() => {
		if (server === 'offline') {
			const timer = setTimeout(() => {
				lost.current = true
				setShown('lost')
			}, LOST_GRACE)
			return () => clearTimeout(timer)
		}

		if (server === 'online' && lost.current) {
			lost.current = false
			setShown('reconnected')
		}

		return undefined
	}, [server])

	useEffect(() => {
		if (shown !== 'reconnected') return undefined
		const timer = setTimeout(() => setShown(undefined), RECONNECTED_DURATION)
		return () => clearTimeout(timer)
	}, [shown])

	return [shown, () => setShown(undefined)]
}

// Host of the toasts, mounted once by the application shell. The stack moves left of the contextual panel while the
// panel is docked and open (data-docked-panel of ContextualPanel), so it never covers the panel's readouts.
export function NotificationToasts() {
	const [serverToast, closeServerToast] = useServerToast()
	const { toasts } = useSnapshot(notificationsState)
	const { connection } = useNotificationScope()
	const shown = toasts.filter((toast) => inScope(toast.record, connection))

	useEffect(() => {
		for (const toast of toasts) {
			if (!inScope(toast.record, connection)) dismissToast(notificationsState, toast.record.id)
		}
	}, [toasts, connection])

	if (shown.length === 0 && !serverToast) return null

	return (
		<div className="pointer-events-none fixed right-4 bottom-13 z-40 sm:bottom-10 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 lg:[body:has([data-docked-panel])_&]:right-84 xl:[body:has([data-docked-panel])_&]:right-92">
			{serverToast && (
				<div className={cn(TOAST_CLASS, LEVEL_BORDER_CLASS[serverToast === 'lost' ? 'warning' : 'success'])}>
					<div className={BODY_CLASS}>
						{serverToast === 'lost' ? <ToastContent level="warning" title="Server unreachable" message="Lost contact with the Nebulosa server; reconnecting…" /> : <ToastContent level="success" title="Server reconnected" message="Contact with the Nebulosa server was restored." />}
					</div>
					<IconButton icon="close" label="Hide" onClick={closeServerToast} />
				</div>
			)}
			{shown.map((toast) => (
				<Toast key={toast.record.id} toast={toast} />
			))}
		</div>
	)
}

interface ToastContentProps {
	readonly level: NotificationLevel
	readonly title: string
	readonly message: string
	// Notifications the toast stands for; a count shows beside the severity from 2.
	readonly count?: number
	// Whether the toast opens a context, said by a View cue at the end of the severity line.
	readonly viewable?: boolean
}

// Severity icon and word, title, and message of a toast; the title and the message wrap rather than being cut.
function ToastContent({ level, title, message, count = 1 }: ToastContentProps) {
	return (
		<>
			<Icon name={level} className={cn('mt-px size-5 flex-none', LEVEL_ICON_CLASS[level])} />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex items-baseline gap-2 text-xs leading-4">
					<span className={cn('font-medium tracking-[0.08em] uppercase', LEVEL_ICON_CLASS[level])}>{LEVEL_TEXT[level]}</span>
					{count > 1 && <span className="text-ink-300 tabular-nums">×{count}</span>}
				</span>
				<span className="text-sm leading-5 font-semibold wrap-break-word">{title}</span>
				<span className="text-xs leading-4 wrap-break-word text-ink-200">{message}</span>
			</span>
		</>
	)
}

interface ToastProps {
	readonly toast: NotificationToast
}

// One toast of notifications; a success hides itself when its reading time elapses while neither hovered nor focused.
function Toast({ toast: { record, ids } }: ToastProps) {
	const { documents } = useSnapshot(imagesState)
	const { devices } = useSnapshot(deviceState)
	const [hovered, setHovered] = useState(false)
	const [focused, setFocused] = useState(false)
	const duration = toastDuration(record)
	// Reading time left, in milliseconds; spent only while the toast is neither hovered nor focused.
	const remaining = useRef(duration ?? 0)
	const held = hovered || focused

	useEffect(() => {
		if (duration === undefined || held) return undefined
		const started = Date.now()
		const timer = setTimeout(() => dismissToast(notificationsState, record.id), remaining.current)

		return () => {
			clearTimeout(timer)
			remaining.current -= Date.now() - started
		}
	}, [record.id, duration, held])

	// Opens the context of the notification and marks every notification of the toast read.
	function view() {
		void markNotificationsRead(ids)
		openNotificationTarget(record.target, { images: imagesState, route: routeState, devices: deviceState.devices })
		dismissToast(notificationsState, record.id)
	}

	// Releases the hold of the focus once it leaves the toast, not when it moves within it.
	function handleBlur(e: FocusEvent<HTMLDivElement>) {
		if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
	}

	const viewable = targetAvailable(record.target, { documents, devices })
	const content = <ToastContent level={record.level} title={record.title} message={record.message} count={ids.length} viewable={viewable} />

	return (
		<div onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={handleBlur} className={cn(TOAST_CLASS, LEVEL_BORDER_CLASS[record.level])}>
			{viewable ? (
				<button type="button" title="View" onClick={view} className={cn(BODY_CLASS, VIEW_CLASS)}>
					{content}
				</button>
			) : (
				<div className={BODY_CLASS}>{content}</div>
			)}
			<IconButton icon="close" label="Hide" onClick={() => dismissToast(notificationsState, record.id)} />
		</div>
	)
}
