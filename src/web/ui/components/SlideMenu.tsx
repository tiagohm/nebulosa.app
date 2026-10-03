import { stopPropagation } from '@shared/util'
import { IconButton } from '@ui/components/IconButton'
import { Icons } from '@ui/Icon'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { tv } from 'tailwind-variants'
import type { ClassValue } from 'tailwind-variants'

// Renders a hierarchical menu one level at a time while keeping navigation local to the component.

// Identifies an actionable menu item and remains stable while the menu tree is reordered.
export type SlideMenuId = React.Key

// Customizes the classes of each structural and content slot rendered by the menu.
export interface SlideMenuClassNames {
	// Styles the outer menu surface.
	readonly base?: ClassValue
	// Styles the navigation header shown below the root level.
	readonly header?: ClassValue
	// Styles the icon button that returns to the previous level.
	readonly backButton?: ClassValue
	// Styles the container for entries in the current level.
	readonly list?: ClassValue
	// Styles every actionable item wrapper.
	readonly item?: ClassValue
	// Styles the leading-content wrapper.
	readonly startContent?: ClassValue
	// Styles the central item content.
	readonly content?: ClassValue
	// Styles the trailing-content wrapper.
	readonly endContent?: ClassValue
	// Styles the icon that indicates a nested level.
	readonly submenuIcon?: ClassValue
	// Styles separator entries.
	readonly separator?: ClassValue
}

// Describes an actionable entry and its optional nested menu level.
export interface SlideMenuItem extends Omit<React.ComponentProps<'div'>, 'children' | 'id'> {
	// Distinguishes an item when entries are handled as a discriminated union.
	readonly type?: 'item'
	// Uniquely identifies this item among its siblings and is reported to onAction.
	readonly id: SlideMenuId
	// Provides the default central content when no render prop is supplied.
	readonly label: React.ReactNode
	// Prevents interaction while retaining the normal visual emphasis.
	readonly readOnly?: boolean
	// Prevents interaction and renders the entry with disabled emphasis.
	readonly disabled?: boolean
	// Renders content before the label or custom central content.
	readonly startContent?: React.ReactNode
	// Renders content after the label or custom central content and before the submenu icon.
	readonly endContent?: React.ReactNode
	// Defines the next level; an empty array behaves like a leaf item.
	readonly items?: readonly SlideMenuEntry[]
}

// Describes a non-interactive divider between menu items.
export interface SlideMenuSeparator extends Omit<React.ComponentProps<'div'>, 'children' | 'id'> {
	// Selects separator rendering and excludes the entry from actions.
	readonly type: 'separator'
	// Optionally provides a stable React key when separators may be reordered.
	readonly id?: SlideMenuId
}

// Represents either an actionable item or a non-interactive separator.
export type SlideMenuEntry = SlideMenuItem | SlideMenuSeparator

// Supplies state and controlled activation to a custom item-content renderer.
export interface SlideMenuRenderContext {
	// Reports the zero-based depth of the displayed menu level.
	readonly depth: number
	// Indicates whether activating the item can enter a non-empty nested level.
	readonly hasChildren: boolean
	// Mirrors the item's disabled state.
	readonly disabled: boolean
	// Mirrors the item's read-only state.
	readonly readOnly: boolean
	// Provides the label that the default renderer would display.
	readonly defaultContent: React.ReactNode
	// Activates the item from a nested custom control while consuming its event.
	readonly activate: (event: React.SyntheticEvent) => void
}

// Configures the hierarchical menu surface and its item renderer.
export interface SlideMenuProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children'> {
	// Defines the root entries and every nested menu level.
	readonly items: readonly SlideMenuEntry[]
	// Customizes structural classes without replacing menu behavior.
	readonly classNames?: SlideMenuClassNames
	// Runs before submenu navigation; returning false cancels that navigation.
	readonly onAction?: (id: SlideMenuId, item: SlideMenuItem) => false | void
	// Replaces only an item's central content while the menu retains its wrapper and indicators.
	readonly children?: (item: SlideMenuItem, context: SlideMenuRenderContext) => React.ReactNode
}

// Holds the entries reached by the valid prefix of the requested navigation path.
interface ResolvedSlideMenuLevel {
	// Contains entries for the deepest valid level.
	readonly entries: readonly SlideMenuEntry[]
	// Counts the path segments that still resolve to nested items.
	readonly depth: number
}

// Defines the neutral dark menu geometry and interaction states.
const slideMenuStyles = tv({
	slots: {
		base: 'flex min-w-0 flex-col overflow-hidden rounded-lg bg-neutral-900/70 text-neutral-100',
		header: 'flex min-h-10 items-center border-neutral-800 border-b px-1',
		backButton: 'shrink-0',
		list: 'flex min-w-0 flex-col py-1',
		item: 'flex min-h-10 w-full min-w-0 items-center gap-2 p-3 text-sm transition',
		startContent: 'flex shrink-0 items-center justify-center text-neutral-400',
		content: 'min-w-0 flex-1 truncate text-neutral-100',
		endContent: 'flex shrink-0 items-center justify-center text-neutral-400',
		submenuIcon: 'shrink-0 text-neutral-400',
		separator: 'mx-3 my-1 h-px shrink-0 bg-neutral-800',
	},
	variants: {
		disabled: {
			true: {
				item: 'cursor-not-allowed opacity-40 pointer-events-none',
			},
			false: {
				item: 'cursor-pointer hover:bg-neutral-800 active:bg-neutral-700',
			},
		},
		readOnly: {
			true: {
				item: 'cursor-default opacity-90 pointer-events-none',
			},
		},
	},
	defaultVariants: {
		disabled: false,
		readOnly: false,
	},
})

// Narrows a menu entry to a separator declaration.
function isSlideMenuSeparator(entry: SlideMenuEntry): entry is SlideMenuSeparator {
	return entry.type === 'separator'
}

// Reports whether an item owns a navigable, non-empty submenu.
function hasSlideMenuChildren(item: SlideMenuItem): item is SlideMenuItem & { readonly items: readonly SlideMenuEntry[] } {
	return item.items !== undefined && item.items.length > 0
}

// Resolves the deepest valid level so stale item updates cannot retain detached entry arrays.
function resolveSlideMenuLevel(entries: readonly SlideMenuEntry[], path: readonly SlideMenuId[]): ResolvedSlideMenuLevel {
	let currentEntries = entries
	let depth = 0

	for (const id of path) {
		const parent = currentEntries.find((entry): entry is SlideMenuItem => !isSlideMenuSeparator(entry) && entry.id === id)

		if (parent === undefined || !hasSlideMenuChildren(parent)) break

		currentEntries = parent.items
		depth += 1
	}

	return { depth, entries: currentEntries }
}

// Renders one menu level and replaces it with nested entries as parent items are activated.
export function SlideMenu({ children, className, classNames, items, onAction, ...props }: SlideMenuProps) {
	const [path, setPath] = useState<SlideMenuId[]>([])
	const level = resolveSlideMenuLevel(items, path)
	const rootStyles = slideMenuStyles()

	// Removes path segments whose parent items disappeared or stopped owning a submenu.
	useEffect(() => {
		if (level.depth === path.length) return

		setPath((currentPath) => currentPath.slice(0, level.depth))
	}, [level.depth, path.length])

	// Returns to the immediately preceding menu level without dispatching an item action.
	function goBack() {
		setPath((currentPath) => currentPath.slice(0, -1))
	}

	// Dispatches an item action and enters its submenu unless the callback cancels navigation.
	function activateItem(item: SlideMenuItem) {
		if (item.disabled || item.readOnly) return

		const result = onAction?.(item.id, item)

		if (result !== false && hasSlideMenuChildren(item)) {
			setPath((currentPath) => [...currentPath, item.id])
		}
	}

	// Renders an actionable row while composing caller-provided pointer and keyboard handlers.
	function renderItem(item: SlideMenuItem) {
		const { className: itemClassName, disabled = false, endContent, id, items: childItems, label, onClick, onKeyDown, readOnly = false, startContent, tabIndex, type, ...itemProps } = item
		const hasChildren = childItems !== undefined && childItems.length > 0
		const styles = slideMenuStyles({ disabled, readOnly })

		// Handles activation originating from custom content and prevents the wrapper from repeating it.
		function activateFromContent(event: React.SyntheticEvent) {
			event.preventDefault()
			stopPropagation(event)
			activateItem(item)
		}

		// Invokes the caller handler before applying the menu's click behavior.
		function handleClick(event: React.MouseEvent<HTMLDivElement>) {
			onClick?.(event)

			if (event.defaultPrevented || disabled || readOnly) return

			stopPropagation(event)
			activateItem(item)
		}

		// Invokes the caller handler before activating the item with Enter or Space.
		function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
			onKeyDown?.(event)

			if (event.defaultPrevented || disabled || readOnly) return

			if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
				event.preventDefault()
				stopPropagation(event)
				activateItem(item)
			}
		}

		const defaultContent = label
		const content = children === undefined ? defaultContent : children(item, { activate: activateFromContent, defaultContent, depth: level.depth, disabled, hasChildren, readOnly })

		return (
			<div {...itemProps} className={cn(styles.item(), itemClassName, classNames?.item)} key={id} onClick={handleClick} onKeyDown={handleKeyDown} role="button" tabIndex={disabled || readOnly ? undefined : (tabIndex ?? 0)}>
				{startContent !== undefined && startContent !== null && <span className={cn(styles.startContent(), classNames?.startContent)}>{startContent}</span>}
				{content !== undefined && content !== null && <div className={cn(styles.content(), classNames?.content)}>{content}</div>}
				{endContent !== undefined && endContent !== null && <span className={cn(styles.endContent(), classNames?.endContent)}>{endContent}</span>}
				{hasChildren && <Icons.MenuRight className={cn(styles.submenuIcon(), classNames?.submenuIcon)} />}
			</div>
		)
	}

	// Renders a divider while preserving caller-provided div styling and attributes.
	function renderSeparator(separator: SlideMenuSeparator, index: number) {
		const { className: separatorClassName, id, type, ...separatorProps } = separator

		return <div {...separatorProps} className={cn(rootStyles.separator(), separatorClassName, classNames?.separator)} key={id ?? `separator-${level.depth}-${index}`} />
	}

	return (
		<div {...props} className={cn(rootStyles.base(), className, classNames?.base)}>
			{level.depth > 0 && (
				<div className={cn(rootStyles.header(), classNames?.header)}>
					<IconButton aria-label="Back" className={cn(rootStyles.backButton(), classNames?.backButton)} icon={Icons.MenuLeft} onClick={goBack} size="sm" />
				</div>
			)}
			<div className={cn(rootStyles.list(), classNames?.list)}>{level.entries.map((entry, index) => (isSlideMenuSeparator(entry) ? renderSeparator(entry, index) : renderItem(entry)))}</div>
		</div>
	)
}
