import { cn } from 'cn'
import { createContext, type KeyboardEvent, type ReactNode, type RefObject, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { closeFrom, type MenuPath, moveIndex, openAt } from './navigation'

// Horizontal menu bar of dropdown menus with cascading submenus. NavigationMenu owns the single open path,
// so at most one root menu (and one submenu chain inside it) is open, and arrow keys move between menus.

// Item a menu focuses once it opens: the first or the last enabled item of its list.
type FocusTarget = 'first' | 'last'

// Focus requested for a root menu that is about to open from another menu's keyboard navigation.
interface PendingFocus {
	// Id of the root menu that should apply the focus once open.
	readonly id: string
	// Item of its list to focus.
	readonly focus: FocusTarget
}

// State and operations shared by every menu of one NavigationMenu.
interface NavigationMenuContextValue {
	// Open root menu and submenu chain.
	readonly path: MenuPath
	// Replaces the open path from the current one; returning an equal path keeps the state unchanged.
	readonly update: (next: (path: MenuPath) => MenuPath) => void
	// Id of the root trigger reachable with Tab (roving tabindex).
	readonly focused?: string
	// Makes the root trigger with this id the one reachable with Tab.
	readonly setFocused: (id: string) => void
	// Focus waiting for a root menu opened by keyboard navigation from another menu.
	readonly pending: RefObject<PendingFocus | undefined>
	// Moves focus from the root trigger `from` to its neighbor for an arrow, Home, or End key. When `open`
	// is set, the neighbor's menu opens too, focusing `focus` in its list or keeping focus on its trigger.
	readonly moveRoot: (from: string, key: string, open: boolean, focus?: FocusTarget) => void
}

// Position of a menu list inside the bar.
interface MenuLevelContextValue {
	// Nesting depth of the list: 1 for a root menu's list, 2 for its submenus, and so on.
	readonly depth: number
	// Id of the root menu the list belongs to.
	readonly rootId: string
	// Closes the menu owning the list (and its submenus) and focuses the trigger or item that opened it.
	readonly close: () => void
}

const NavigationMenuContext = createContext<NavigationMenuContextValue | undefined>(undefined)

const MenuLevelContext = createContext<MenuLevelContextValue | undefined>(undefined)

// Shared look of a dropdown list, matching the Select listbox.
const listClassName = 'absolute z-30 m-0 box-border min-w-48 list-none rounded-md border border-line-100 bg-base-200 p-1 text-sm leading-5 shadow-[0_12px_32px_rgb(0_0_0/0.45)]'

// Shared look of a list item button; keyboard and hover both move focus, so focus drives the highlight.
const itemClassName = 'flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent py-2 pr-3 pl-2 text-left text-ink-100 outline-none whitespace-nowrap focus:bg-base-300 disabled:cursor-not-allowed disabled:text-ink-300'

// Returns the NavigationMenu context, throwing when a menu is rendered outside of one.
function useNavigationMenu(): NavigationMenuContextValue {
	const context = useContext(NavigationMenuContext)
	if (!context) throw new Error('Menu must be rendered inside a NavigationMenu')
	return context
}

// Returns the list a menu item belongs to, throwing when an item is rendered outside a menu.
function useMenuLevel(): MenuLevelContextValue {
	const context = useContext(MenuLevelContext)
	if (!context) throw new Error('Menu items must be rendered inside a Menu')
	return context
}

// Returns whether two open paths name the same menus.
function samePath(a: MenuPath, b: MenuPath): boolean {
	return a.length === b.length && a.every((id, i) => id === b[i])
}

// Returns the enabled item buttons that belong directly to a list, in order, excluding nested submenu items.
function listItems(list: Element | null | undefined): HTMLButtonElement[] {
	return list ? Array.from(list.querySelectorAll<HTMLButtonElement>(':scope > li > [data-menu-item]:not(:disabled)')) : []
}

// Focuses the first or last enabled item of a list.
function focusItem(list: Element | null, focus: FocusTarget) {
	const items = listItems(list)
	;(focus === 'first' ? items[0] : items.at(-1))?.focus()
}

// Handles the keys shared by every item: Up, Down, Home, and End move within the list; Escape and Left
// close a submenu; Left and Right at the root level move to the neighboring root menu.
function handleItemKeyDown(e: KeyboardEvent<HTMLButtonElement>, nav: NavigationMenuContextValue, level: MenuLevelContextValue) {
	const { key } = e

	if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
		e.preventDefault()
		const items = listItems(e.currentTarget.closest('ul'))
		const index = moveIndex(items.indexOf(e.currentTarget), items.length, key)
		if (index !== undefined) items[index]?.focus()
	} else if (key === 'Escape') {
		e.preventDefault()
		level.close()
	} else if (key === 'ArrowLeft' && level.depth > 1) {
		e.preventDefault()
		level.close()
	} else if (key === 'ArrowLeft' || key === 'ArrowRight') {
		e.preventDefault()
		nav.moveRoot(level.rootId, key, true, 'first')
	}
}

// Focuses the list of a menu once it opens, if a keyboard action asked for it. `intent` holds the
// requested item and is cleared once applied.
function useFocusOnOpen(open: boolean, listRef: RefObject<HTMLUListElement | null>, intent: RefObject<FocusTarget | undefined>) {
	useEffect(() => {
		if (!open || !intent.current) return
		focusItem(listRef.current, intent.current)
		intent.current = undefined
	}, [open, listRef, intent])
}

export interface NavigationMenuProps {
	// Root menus, in display order.
	readonly children: ReactNode
	readonly className?: string
}

// Menu bar that lays out its root menus horizontally and coordinates them: one open path, Left and Right
// between root triggers, and closing on Tab or a press outside the bar.
export function NavigationMenu({ children, className }: NavigationMenuProps) {
	const [path, setPath] = useState<MenuPath>([])
	const [focused, setFocused] = useState<string>()
	const navRef = useRef<HTMLElement>(null)
	const pending = useRef<PendingFocus>(undefined)

	// Replaces the open path, keeping the current state when nothing changes.
	function update(next: (path: MenuPath) => MenuPath) {
		setPath((current) => {
			const value = next(current)
			return samePath(current, value) ? current : value
		})
	}

	// Returns the root triggers of this bar in document order.
	function triggers(): HTMLButtonElement[] {
		return navRef.current ? Array.from(navRef.current.querySelectorAll<HTMLButtonElement>('[data-menu-trigger]')) : []
	}

	function moveRoot(from: string, key: string, open: boolean, focus?: FocusTarget) {
		const all = triggers()
		const index = moveIndex(
			all.findIndex((trigger) => trigger.dataset.menuTrigger === from),
			all.length,
			key,
		)
		const target = index === undefined ? undefined : all[index]
		const id = target?.dataset.menuTrigger
		if (!target || id === undefined) return

		target.focus()

		if (open) {
			pending.current = focus ? { id, focus } : undefined
			update(() => [id])
		}
	}

	// The first trigger is reachable with Tab until another one takes focus.
	useLayoutEffect(() => {
		if (focused === undefined) setFocused(triggers()[0]?.dataset.menuTrigger)
	}, [focused])

	useEffect(() => {
		if (path.length === 0) return

		function handlePointerDown(e: MouseEvent) {
			if (e.target instanceof Node && !navRef.current?.contains(e.target)) setPath([])
		}

		document.addEventListener('mousedown', handlePointerDown)
		return () => document.removeEventListener('mousedown', handlePointerDown)
	}, [path.length])

	return (
		<NavigationMenuContext.Provider value={{ path, update, focused, setFocused, pending, moveRoot }}>
			<nav ref={navRef} onKeyDown={(e) => e.key === 'Tab' && update(() => [])} className={cn('flex items-center gap-1', className)}>
				{children}
			</nav>
		</NavigationMenuContext.Provider>
	)
}

export interface MenuProps {
	// Unique id of the menu within its NavigationMenu.
	readonly id: string
	// Content of the trigger button.
	readonly label: ReactNode
	// Edge of the trigger the list lines up with; use end for menus at the right of the screen.
	readonly align?: 'start' | 'end'
	// Extra classes of the trigger button.
	readonly triggerClassName?: string
	// Items, submenus, and separators of the list.
	readonly children: ReactNode
}

// Root menu: a trigger in the bar and the dropdown list it opens below itself.
export function Menu({ id, label, align = 'start', triggerClassName, children }: MenuProps) {
	const nav = useNavigationMenu()
	const open = nav.path[0] === id
	const triggerRef = useRef<HTMLButtonElement>(null)
	const listRef = useRef<HTMLUListElement>(null)
	const intent = useRef<FocusTarget>(undefined)

	// Opens this menu as the only open one, focusing an item of its list when given.
	function openMenu(focus?: FocusTarget) {
		if (open) {
			if (focus) focusItem(listRef.current, focus)
		} else {
			intent.current = focus
			nav.update(() => [id])
		}
	}

	// Applies focus requested by a neighboring menu's keyboard navigation.
	useEffect(() => {
		if (open && nav.pending.current?.id === id) {
			intent.current = nav.pending.current.focus
			nav.pending.current = undefined
		}
	}, [open, id, nav.pending])

	useFocusOnOpen(open, listRef, intent)

	function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
		const { key } = e

		if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End') {
			e.preventDefault()
			nav.moveRoot(id, key, nav.path.length > 0)
		} else if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
			e.preventDefault()
			openMenu('first')
		} else if (key === 'ArrowUp') {
			e.preventDefault()
			openMenu('last')
		} else if (key === 'Escape' && open) {
			e.preventDefault()
			nav.update(() => [])
		}
	}

	// Closes this menu and returns focus to its trigger.
	function close() {
		nav.update(() => [])
		triggerRef.current?.focus()
	}

	return (
		<div className="relative">
			<button
				ref={triggerRef}
				type="button"
				data-menu-trigger={id}
				tabIndex={nav.focused === id ? 0 : -1}
				onFocus={() => nav.setFocused(id)}
				onClick={() => nav.update(() => (open ? [] : [id]))}
				onMouseEnter={() => {
					if (nav.path.length > 0 && !open) {
						nav.update(() => [id])
						triggerRef.current?.focus()
					}
				}}
				onKeyDown={handleKeyDown}
				className={cn(
					'flex h-9 cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-3 text-sm leading-5 font-medium whitespace-nowrap transition-colors duration-150 hover:bg-base-300 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
					open ? 'bg-base-300 text-ink-100' : 'text-ink-200',
					triggerClassName,
				)}
			>
				{label}
			</button>
			<MenuLevelContext.Provider value={{ depth: 1, rootId: id, close }}>
				<ul ref={listRef} hidden={!open} className={cn(listClassName, 'top-[calc(100%+4px)]', align === 'end' ? 'right-0' : 'left-0')}>
					{children}
				</ul>
			</MenuLevelContext.Provider>
		</div>
	)
}

export interface MenuItemProps {
	// Runs when the item is chosen by click, Enter, or Space; every menu closes afterwards.
	readonly onSelect: () => void
	// Whether the item is shown but cannot be chosen or focused.
	readonly disabled?: boolean
	// When defined, reserves a check column and shows the check when true, for single-choice lists.
	readonly checked?: boolean
	readonly children: ReactNode
}

// Item of a menu list that runs an action.
export function MenuItem({ onSelect, disabled = false, checked, children }: MenuItemProps) {
	const nav = useNavigationMenu()
	const level = useMenuLevel()

	// Runs the action and closes every menu, returning focus to the root trigger.
	function choose(button: HTMLButtonElement) {
		button
			.closest('nav')
			?.querySelector<HTMLButtonElement>(`[data-menu-trigger="${CSS.escape(level.rootId)}"]`)
			?.focus()
		nav.update(() => [])
		onSelect()
	}

	return (
		<li>
			<button
				type="button"
				data-menu-item
				disabled={disabled}
				onClick={(e) => choose(e.currentTarget)}
				onMouseEnter={(e) => {
					nav.update((path) => closeFrom(path, level.depth))
					e.currentTarget.focus()
				}}
				onKeyDown={(e) => handleItemKeyDown(e, nav, level)}
				className={itemClassName}
			>
				{checked !== undefined && <span className={cn('relative h-5 flex-[0_0_16px]', checked && "after:absolute after:top-1 after:left-[5px] after:h-3 after:w-1 after:rotate-45 after:border-r-2 after:border-b-2 after:border-accent after:content-['']")} />}
				<span className={cn('min-w-0 flex-1', checked && 'text-accent')}>{children}</span>
			</button>
		</li>
	)
}

export interface SubMenuProps {
	// Unique id of the submenu among its sibling submenus.
	readonly id: string
	// Content of the item that opens the submenu.
	readonly label: ReactNode
	// Items, submenus, and separators of the cascading list.
	readonly children: ReactNode
}

// Item that opens a cascading list beside its own list. Submenus nest to any depth and share the bar's
// open path and keyboard navigation.
export function SubMenu({ id, label, children }: SubMenuProps) {
	const nav = useNavigationMenu()
	const level = useMenuLevel()
	const open = nav.path[level.depth] === id
	const itemRef = useRef<HTMLButtonElement>(null)
	const listRef = useRef<HTMLUListElement>(null)
	const intent = useRef<FocusTarget>(undefined)

	useFocusOnOpen(open, listRef, intent)

	// Opens the submenu, closing any sibling one, and focuses its first item when asked.
	function openSubMenu(focus?: FocusTarget) {
		if (open) {
			if (focus) focusItem(listRef.current, focus)
		} else {
			intent.current = focus
			nav.update((path) => openAt(path, level.depth, id))
		}
	}

	// Closes the submenu and its own submenus and returns focus to the item that opened it.
	function close() {
		nav.update((path) => closeFrom(path, level.depth))
		itemRef.current?.focus()
	}

	function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
		if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			openSubMenu('first')
		} else {
			handleItemKeyDown(e, nav, level)
		}
	}

	return (
		<li className="relative">
			<button
				ref={itemRef}
				type="button"
				data-menu-item
				onClick={() => openSubMenu()}
				onMouseEnter={(e) => {
					openSubMenu()
					e.currentTarget.focus()
				}}
				onKeyDown={handleKeyDown}
				className={cn(itemClassName, open && 'bg-base-300')}
			>
				<span className="min-w-0 flex-1">{label}</span>
				<span className="ml-4 size-[7px] rotate-45 border-t-[1.5px] border-r-[1.5px] border-ink-300" />
			</button>
			<MenuLevelContext.Provider value={{ depth: level.depth + 1, rootId: level.rootId, close }}>
				<ul ref={listRef} hidden={!open} className={cn(listClassName, '-top-1 left-[calc(100%+4px)]')}>
					{children}
				</ul>
			</MenuLevelContext.Provider>
		</li>
	)
}
