import type * as React from 'react'
import { Children, Fragment, isValidElement, useEffect, useState } from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { stopPropagation, tw } from '@/shared/util'
import { Icons } from '../Icon'

const TAB_CHILD_TYPE = Symbol('Tab')
const TAB_PANEL_CHILD_TYPE = Symbol('TabPanel')

const tabsStyles = tv({
	slots: {
		base: 'flex min-w-0 gap-2 align-top',
		tabList: 'flex min-w-0 shrink-0 gap-1 overflow-auto rounded-lg bg-neutral-900/70 p-1',
		panelContainer: 'min-w-0 flex-1',
		panel: 'min-w-0 text-neutral-100',
	},
	variants: {
		placement: {
			top: {
				base: 'flex-col',
				tabList: 'flex-row',
				panelContainer: 'w-full',
			},
			bottom: {
				base: 'flex-col-reverse',
				tabList: 'flex-row',
				panelContainer: 'w-full',
			},
			start: {
				base: 'flex-row',
				tabList: 'max-w-full flex-col',
			},
			end: {
				base: 'flex-row-reverse',
				tabList: 'max-w-full flex-col',
			},
		},
		fullWidth: {
			true: {
				base: 'w-full',
			},
		},
	},
	defaultVariants: {
		placement: 'top',
	},
})

const tabStyles = tv({
	slots: {
		base: ['inline-flex min-w-0 items-center justify-center gap-2 rounded-lg font-normal select-none transition', 'focus-visible:outline-none focus-visible:ring-0'],
		startContent: 'flex shrink-0 items-center justify-center',
		label: 'min-w-0 flex-1 truncate text-center',
		endContent: 'flex shrink-0 items-center justify-center',
		closeButton: 'flex shrink-0 items-center justify-center rounded-full outline-none transition cursor-pointer text-(--color-variant)',
	},
	variants: {
		size: {
			sm: {
				base: 'h-8 min-w-8 px-2 text-sm',
				startContent: 'text-sm',
				label: 'text-sm',
				endContent: 'text-sm',
				closeButton: 'size-5 text-sm',
			},
			md: {
				base: 'h-10 min-w-10 px-2 text-sm',
				startContent: 'text-sm',
				label: 'text-sm',
				endContent: 'text-sm',
				closeButton: 'size-5 text-sm',
			},
			lg: {
				base: 'h-11 min-w-11 px-2 text-base',
				startContent: 'text-base',
				label: 'text-base',
				endContent: 'text-base',
				closeButton: 'size-6 text-base',
			},
		},
		color: {
			default: {
				base: '[--color-variant:var(--color-neutral-500)]',
			},
			primary: {
				base: '[--color-variant:var(--primary)]',
			},
			secondary: {
				base: '[--color-variant:var(--secondary)]',
			},
			success: {
				base: '[--color-variant:var(--success)]',
			},
			danger: {
				base: '[--color-variant:var(--danger)]',
			},
			warning: {
				base: '[--color-variant:var(--warning)]',
			},
		},
		selected: {
			true: {
				base: 'bg-(--color-variant)/20 text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
			false: {
				base: 'bg-transparent text-(--color-variant) hover:bg-(--color-variant)/20 active:bg-(--color-variant)/15',
			},
		},
		disabled: {
			true: {
				base: 'cursor-not-allowed opacity-40 pointer-events-none',
				closeButton: 'pointer-events-none',
			},
			false: {
				base: 'cursor-pointer',
				closeButton: 'hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
		},
	},
	defaultVariants: {
		size: 'md',
		color: 'default',
		selected: false,
		disabled: false,
	},
})

type TabsVariants = VariantProps<typeof tabsStyles>
type TabVariants = VariantProps<typeof tabStyles>

type TabsChildComponent = {
	tabsChildType?: symbol
}

export type TabId = string | number | symbol | bigint | boolean
export type TabPlacement = Exclude<TabsVariants['placement'], undefined>

export interface TabsClassNames {
	readonly base?: ClassValue
	readonly tabList?: ClassValue
	readonly panelContainer?: ClassValue
	readonly tab?: ClassValue
	readonly tabStartContent?: ClassValue
	readonly tabLabel?: ClassValue
	readonly tabEndContent?: ClassValue
	readonly closeButton?: ClassValue
	readonly panel?: ClassValue
}

export interface TabClassNames {
	readonly base?: ClassValue
	readonly startContent?: ClassValue
	readonly label?: ClassValue
	readonly endContent?: ClassValue
	readonly closeButton?: ClassValue
}

export interface TabsProps<T extends TabId = string> extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'color' | 'defaultValue' | 'onChange'>, TabsVariants, Pick<TabVariants, 'color' | 'size'> {
	readonly children?: React.ReactNode
	readonly classNames?: TabsClassNames
	readonly defaultValue?: T
	readonly disabled?: boolean
	readonly onValueChange?: (value: T) => void
	readonly value?: T
}

export interface TabProps<T extends TabId = string> extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'color' | 'id' | 'onClose'>, Omit<TabVariants, 'disabled' | 'selected'> {
	readonly children?: React.ReactNode
	readonly classNames?: TabClassNames
	readonly disabled?: boolean
	readonly endContent?: React.ReactNode
	readonly id: T
	readonly label?: React.ReactNode
	readonly onClose?: (event: React.MouseEvent<HTMLButtonElement>) => void
	readonly startContent?: React.ReactNode
}

export interface TabPanelProps<T extends TabId = string> extends Omit<React.ComponentPropsWithRef<'div'>, 'id'> {
	readonly id: T
}

// Marks tab declarations that are rendered by the owning Tabs component.
export function Tab<T extends TabId = string>(props: TabProps<T>) {
	return null
}

const TabMarker = Tab as typeof Tab & TabsChildComponent
TabMarker.tabsChildType = TAB_CHILD_TYPE

// Marks panel declarations that are rendered by the owning Tabs component.
export function TabPanel<T extends TabId = string>(props: TabPanelProps<T>) {
	return null
}

const TabPanelMarker = TabPanel as typeof TabPanel & TabsChildComponent
TabPanelMarker.tabsChildType = TAB_PANEL_CHILD_TYPE

// Reads the marker from a compound Tabs child component.
function tabsChildTypeOf(type: unknown) {
	return typeof type === 'function' || (typeof type === 'object' && type !== null) ? (type as TabsChildComponent).tabsChildType : undefined
}

// Checks whether a React child is a Tab declaration.
function isTabElement<T extends TabId>(child: React.ReactElement): child is React.ReactElement<TabProps<T>> {
	return tabsChildTypeOf(child.type) === TAB_CHILD_TYPE
}

// Checks whether a React child is a TabPanel declaration.
function isTabPanelElement<T extends TabId>(child: React.ReactElement): child is React.ReactElement<TabPanelProps<T>> {
	return tabsChildTypeOf(child.type) === TAB_PANEL_CHILD_TYPE
}

// Collects tab and panel declarations while allowing callers to group them in fragments.
function collectTabsChildren<T extends TabId>(children: React.ReactNode, tabs: React.ReactElement<TabProps<T>>[] = [], panels: React.ReactElement<TabPanelProps<T>>[] = []) {
	for (const child of Children.toArray(children)) {
		if (!isValidElement(child)) continue

		if (isTabElement<T>(child)) {
			tabs.push(child)
			continue
		}

		if (isTabPanelElement<T>(child)) {
			panels.push(child)
			continue
		}

		if (child.type === Fragment) {
			collectTabsChildren<T>((child.props as { children?: React.ReactNode }).children, tabs, panels)
		}
	}

	return { panels, tabs } as const
}

// Finds the first tab whose id matches the requested id.
function findTabIndex<T extends TabId>(tabs: readonly React.ReactElement<TabProps<T>>[], id: T | undefined) {
	if (id === undefined) return -1

	for (let i = 0; i < tabs.length; i++) {
		if (Object.is(tabs[i].props.id, id)) return i
	}

	return -1
}

function isTabEnabled(tab: React.ReactElement<TabProps<TabId>>) {
	return tab.props.disabled !== true
}

// Returns the default selectable tab id for uncontrolled mode.
function fallbackTabId<T extends TabId>(tabs: readonly React.ReactElement<TabProps<T>>[]) {
	return (tabs.find(isTabEnabled) ?? tabs[0])?.props.id
}

// Renders a controlled or uncontrolled tab set with linked tab panels.
export function Tabs<T extends TabId = string>({ children, className, classNames, color = 'default', defaultValue, disabled = false, fullWidth, onValueChange, placement = 'top', ref, size = 'md', value, ...props }: TabsProps<T>) {
	const { panels, tabs } = collectTabsChildren<T>(children)
	const [uncontrolledValue, setUncontrolledValue] = useState<T | undefined>(() => defaultValue ?? fallbackTabId(tabs))
	const isControlled = value !== undefined
	const fallbackValue = fallbackTabId(tabs)
	const selectedValue = isControlled ? value : (uncontrolledValue ?? fallbackValue)
	const selectedTabIndex = findTabIndex(tabs, selectedValue)
	const selectedPanel = selectedTabIndex >= 0 ? panels.find((panel) => Object.is(panel.props.id, selectedValue)) : undefined
	const styles = tabsStyles({ fullWidth, placement })

	// Keeps uncontrolled selection on an existing tab when tabs are added or removed.
	useEffect(() => {
		if (isControlled || fallbackValue === undefined) return
		if (findTabIndex(tabs, uncontrolledValue) >= 0) return
		setUncontrolledValue(fallbackValue)
	}, [fallbackValue, isControlled, tabs, uncontrolledValue])

	// Updates the selected tab id for controlled and uncontrolled callers.
	function selectTab(nextValue: T) {
		if (disabled || Object.is(selectedValue, nextValue)) return
		if (!isControlled) setUncontrolledValue(nextValue)
		onValueChange?.(nextValue)
	}

	// Renders a single clickable tab declaration.
	function renderTab(tab: React.ReactElement<TabProps<T>>, index: number) {
		const { children: tabChildren, className: tabClassName, classNames: tabClassNames, color: tabColor = color, disabled: tabDisabled = false, endContent, id, label, onClose, onKeyDown, onPointerDown, ref: tabRef, size: tabSize = size, startContent, tabIndex, ...tabProps } = tab.props
		const selected = index === selectedTabIndex
		const blocked = disabled || tabDisabled
		const tabVariantStyles = tabStyles({ color: tabColor, disabled: blocked, selected, size: tabSize })
		const content = label ?? tabChildren

		// Selects this tab from pointer interaction.
		function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
			onPointerDown?.(event)

			if (event.defaultPrevented || blocked) return
			if (event.pointerType === 'mouse' && event.button !== 0) return

			event.preventDefault()
			selectTab(id)
		}

		// Selects this tab from simple keyboard interaction.
		function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
			onKeyDown?.(event)

			if (event.defaultPrevented || blocked) return

			if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
				event.preventDefault()
				selectTab(id)
			}
		}

		// Reports close requests without selecting the tab.
		function handleClose(event: React.PointerEvent<HTMLButtonElement>) {
			event.stopPropagation()
			if (blocked || onClose === undefined) return
			onClose(event)
		}

		return (
			<div {...tabProps} className={tw(tabVariantStyles.base(), classNames?.tab, tabClassName, tabClassNames?.base)} key={tab.key ?? index} onKeyDown={handleKeyDown} onPointerDown={handlePointerDown} ref={tabRef} tabIndex={blocked ? undefined : (tabIndex ?? 0)}>
				{startContent !== undefined && startContent !== null && <span className={tw(tabVariantStyles.startContent(), classNames?.tabStartContent, tabClassNames?.startContent)}>{startContent}</span>}
				{content !== undefined && content !== null && <span className={tw(tabVariantStyles.label(), classNames?.tabLabel, tabClassNames?.label)}>{content}</span>}
				{endContent !== undefined && endContent !== null && <span className={tw(tabVariantStyles.endContent(), classNames?.tabEndContent, tabClassNames?.endContent)}>{endContent}</span>}
				{onClose !== undefined && (
					<button className={tw(tabVariantStyles.closeButton(), classNames?.closeButton, tabClassNames?.closeButton)} onClick={stopPropagation} onPointerDown={handleClose} onPointerUp={stopPropagation} type="button">
						<Icons.Close />
					</button>
				)}
			</div>
		)
	}

	// Renders the selected panel declaration when it exists.
	function renderSelectedPanel() {
		if (selectedPanel === undefined) return null

		const { children: panelChildren, className: panelClassName, id: panelId, ref: panelRef, ...panelProps } = selectedPanel.props

		return (
			<div {...panelProps} className={tw(styles.panel(), classNames?.panel, panelClassName)} key={selectedPanel.key} ref={panelRef}>
				{panelChildren}
			</div>
		)
	}

	return (
		<div {...props} className={tw(styles.base(), disabled && 'opacity-40 pointer-events-none', className, classNames?.base)} ref={ref}>
			<div className={tw(styles.tabList(), classNames?.tabList)}>{tabs.map(renderTab)}</div>
			<div className={tw(styles.panelContainer(), classNames?.panelContainer)}>{renderSelectedPanel()}</div>
		</div>
	)
}
