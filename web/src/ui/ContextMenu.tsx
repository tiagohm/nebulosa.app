import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { moveIndex } from './navigation'

// Menu opened at a point of the page, such as a right click or a long press on an image: a list of actions in a
// floating panel kept inside the viewport. The first enabled action takes the focus; the arrow keys, Home, and End move
// between actions and Enter or Space runs one. A press outside, Escape, a resize, or a scroll closes it. An action may
// leave it open with a status line, to say why it could not be done.

// Distance kept between the menu and the edges of the viewport, in CSS pixels.
const VIEWPORT_GUTTER = 8

// Action of a context menu.
export interface ContextMenuItem {
	// Name of the action.
	readonly label: string
	// Runs the action; the menu closes unless it resolves to false.
	readonly onSelect: () => void | boolean | Promise<boolean | void>
	// Why the action is unavailable; absent when it is available.
	readonly disabledReason?: string
}

export interface ContextMenuProps {
	// Point the menu opens at, in client CSS pixels; absent while it is closed.
	readonly at?: { readonly x: number; readonly y: number }
	// Heading of the menu, such as the coordinates it acts on.
	readonly title?: string
	// Actions, in order.
	readonly items: readonly ContextMenuItem[]
	// Line shown under the actions, such as why the latest one failed.
	readonly status?: string
	// Closes the menu.
	readonly onClose: () => void
}

// Context menu.
export function ContextMenu({ at, title, items, status, onClose }: ContextMenuProps) {
	const panelRef = useRef<HTMLDivElement>(null)
	const [position, setPosition] = useState<{ readonly left: number; readonly top: number }>()

	// Keeps the panel inside the viewport once its size is known.
	useLayoutEffect(() => {
		const panel = panelRef.current
		if (!at || !panel) {
			setPosition(undefined)
			return
		}

		const { width, height } = panel.getBoundingClientRect()
		setPosition({ left: Math.max(VIEWPORT_GUTTER, Math.min(at.x, window.innerWidth - width - VIEWPORT_GUTTER)), top: Math.max(VIEWPORT_GUTTER, Math.min(at.y, window.innerHeight - height - VIEWPORT_GUTTER)) })
	}, [at])

	// Focuses the first enabled action once the panel is placed, which makes it visible and so focusable.
	useEffect(() => {
		if (position) panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
	}, [position])

	useEffect(() => {
		if (!at) return

		function handlePointerDown(e: PointerEvent) {
			if (e.target instanceof Node && !panelRef.current?.contains(e.target)) onClose()
		}

		function handleKeyDown(e: globalThis.KeyboardEvent) {
			if (e.key === 'Escape') onClose()
		}

		document.addEventListener('pointerdown', handlePointerDown, true)
		document.addEventListener('keydown', handleKeyDown)
		window.addEventListener('resize', onClose)
		window.addEventListener('scroll', onClose, true)

		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true)
			document.removeEventListener('keydown', handleKeyDown)
			window.removeEventListener('resize', onClose)
			window.removeEventListener('scroll', onClose, true)
		}
	}, [at, onClose])

	if (!at) return null

	// Moves the focus between the enabled actions with the navigation keys.
	function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		const buttons = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
		const next = moveIndex(buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length, e.key)
		if (next === undefined) return
		e.preventDefault()
		buttons[next]?.focus()
	}

	async function run(item: ContextMenuItem) {
		if ((await item.onSelect()) !== false) onClose()
	}

	return (
		<div
			ref={panelRef}
			onKeyDown={handleKeyDown}
			onContextMenu={(e) => e.preventDefault()}
			style={{ left: position?.left ?? at.x, top: position?.top ?? at.y, visibility: position ? 'visible' : 'hidden' }}
			className="fixed z-40 box-border flex max-w-[calc(100vw-16px)] min-w-56 flex-col rounded-md border border-line-100 bg-base-200 py-1 text-sm shadow-[0_12px_32px_rgb(0_0_0/0.45)]"
		>
			{title && <div className="truncate border-b border-line-100 px-3 pt-1 pb-1.5 font-mono text-[11px] text-ink-300 tabular-nums">{title}</div>}
			{items.map((item) => (
				<button
					key={item.label}
					type="button"
					disabled={item.disabledReason !== undefined}
					title={item.disabledReason}
					onClick={() => void run(item)}
					className="cursor-pointer border-0 bg-transparent px-3 py-1.5 text-left text-ink-100 hover:bg-base-300 focus-visible:bg-base-300 focus-visible:outline-none disabled:cursor-default disabled:text-ink-300 disabled:hover:bg-transparent"
				>
					{item.label}
				</button>
			))}
			{status && <div className="border-t border-line-100 px-3 pt-1.5 pb-1 text-xs text-danger">{status}</div>}
		</div>
	)
}
