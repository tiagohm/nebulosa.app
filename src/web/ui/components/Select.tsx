import type * as React from 'react'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { assignRef, tw } from '@/shared/util'
import { Icons } from '../Icon'
import { DEFAULT_FLOATING_OFFSET, Floating, type FloatingPlacement } from './Floating'
import { List } from './List'

const SELECT_ITEM_HEIGHTS = {
	sm: 32,
	md: 40,
	lg: 44,
} as const

const selectStyles = tv({
	slots: {
		base: 'relative inline-flex min-w-0 align-top',
		trigger: 'flex w-full min-w-0 items-stretch overflow-hidden rounded-lg outline-none transition',
		startContent: 'flex shrink-0 items-center whitespace-nowrap',
		field: 'relative min-w-0 flex-1',
		value: 'flex h-full w-full min-w-0 items-center overflow-hidden',
		description: 'min-w-0 truncate text-neutral-500',
		label: 'pointer-events-none absolute origin-left truncate text-xs leading-none text-neutral-400',
		endContent: 'flex shrink-0 items-center whitespace-nowrap',
		chevron: 'flex shrink-0 items-center justify-center text-neutral-400 transition',
		panel: 'w-(--select-width) min-w-48 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg bg-neutral-950 p-0 text-neutral-100 shadow-lg shadow-black/40',
		panelContent: 'min-w-0',
		header: 'p-2',
		list: 'max-h-72 rounded-none bg-transparent text-neutral-100',
		listItem: 'hover:bg-transparent',
		option: 'flex h-full w-full min-w-0 items-center gap-2 text-left transition',
		optionContent: 'min-w-0 flex-1 overflow-hidden',
		selectedIcon: 'flex shrink-0 items-center justify-center text-(--color-variant)',
		footer: 'p-2',
	},
	variants: {
		size: {
			sm: {
				trigger: 'min-h-8 text-xs',
				startContent: 'px-2 text-xs',
				value: 'min-h-8 px-2 text-xs',
				label: 'left-2 right-2 top-1',
				endContent: 'px-2 text-xs',
				chevron: 'w-8 text-xs',
				option: 'px-2 text-xs',
				selectedIcon: 'size-4 text-xs',
			},
			md: {
				trigger: 'min-h-10 text-sm',
				startContent: 'px-4 text-sm',
				value: 'min-h-10 px-4 text-sm',
				label: 'left-4 right-4 top-1.5',
				endContent: 'px-4 text-sm',
				chevron: 'w-10 text-sm',
				option: 'px-3 text-sm',
				selectedIcon: 'size-5 text-sm',
			},
			lg: {
				trigger: 'min-h-11 text-base',
				startContent: 'px-5 text-base',
				value: 'min-h-11 px-5 text-base',
				label: 'left-5 right-5 top-1.5',
				endContent: 'px-4 text-base',
				chevron: 'w-11 text-base',
				option: 'px-4 text-base',
				selectedIcon: 'size-6 text-base',
			},
		},
		color: {
			primary: {
				panel: '[--color-variant:var(--primary)]',
			},
			secondary: {
				panel: '[--color-variant:var(--secondary)]',
			},
			success: {
				panel: '[--color-variant:var(--success)]',
			},
			danger: {
				panel: '[--color-variant:var(--danger)]',
			},
			warning: {
				panel: '[--color-variant:var(--warning)]',
			},
		},
		hasLabel: {
			true: {
				value: 'items-end pt-5 pb-1.5',
			},
			false: {
				label: 'hidden',
			},
		},
		open: {
			true: {
				chevron: 'rotate-180 text-neutral-200',
			},
		},
		fullWidth: {
			true: {
				base: 'w-full',
			},
		},
	},
	defaultVariants: {
		size: 'md',
		color: 'primary',
		hasLabel: false,
	},
})

type SelectVariants = VariantProps<typeof selectStyles>

export type SelectItemRenderer<T> = (item: T, index: number, selected: boolean, placement: 'trigger' | 'list') => React.ReactNode

export interface SelectClassNames {
	readonly base?: ClassValue
	readonly trigger?: ClassValue
	readonly startContent?: ClassValue
	readonly field?: ClassValue
	readonly value?: ClassValue
	readonly description?: ClassValue
	readonly label?: ClassValue
	readonly endContent?: ClassValue
	readonly chevron?: ClassValue
	readonly panel?: ClassValue
	readonly panelContent?: ClassValue
	readonly header?: ClassValue
	readonly list?: ClassValue
	readonly listItem?: ClassValue
	readonly option?: ClassValue
	readonly optionContent?: ClassValue
	readonly selectedIcon?: ClassValue
	readonly footer?: ClassValue
	readonly empty?: ClassValue
}

export interface SelectProps<T> extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'defaultValue' | 'onChange' | 'color'>, Omit<SelectVariants, 'hasLabel'> {
	readonly autoFlip?: boolean
	readonly items: readonly T[]
	readonly value?: T | null
	readonly children: SelectItemRenderer<T>
	readonly onValueChange?: (value: T, index: number) => void
	readonly isItemEqual?: (item: T, value: T) => boolean
	readonly classNames?: SelectClassNames
	readonly description?: React.ReactNode
	readonly disabled?: boolean
	readonly readOnly?: boolean
	readonly emptyContent?: React.ReactNode
	readonly endContent?: React.ReactNode
	readonly headerContent?: React.ReactNode
	readonly footerContent?: React.ReactNode
	readonly itemHeight?: number
	readonly label?: React.ReactNode
	readonly onOpenChange?: (open: boolean) => void
	readonly overscan?: number
	readonly placement?: FloatingPlacement
	readonly portalContainer?: Element
	readonly startContent?: React.ReactNode
}

// Finds the selected item in the current option list.
function selectedIndexOf<T>(items: readonly T[], value: T | null | undefined, isItemEqual: (item: T, value: T) => boolean) {
	if (value === undefined || value === null) return -1

	for (let i = 0; i < items.length; i++) {
		if (isItemEqual(items[i], value)) return i
	}

	return -1
}

// Normalizes panel item height to match the Select size by default.
function selectItemHeight(size: Exclude<SelectVariants['size'], undefined>, itemHeight: number | undefined) {
	return itemHeight !== undefined && Number.isFinite(itemHeight) && itemHeight > 0 ? itemHeight : SELECT_ITEM_HEIGHTS[size]
}

// Renders a controlled single-select trigger with a floating virtualized option list.
export function Select<T>({
	autoFlip = true,
	className,
	classNames,
	description = 'Select an item',
	disabled = false,
	emptyContent = 'No items',
	endContent,
	footerContent,
	fullWidth,
	headerContent,
	id,
	isItemEqual = Object.is,
	itemHeight,
	items,
	label,
	onKeyDown,
	onOpenChange,
	onPointerDown,
	onValueChange,
	open,
	overscan,
	placement = 'bottom',
	portalContainer,
	readOnly = false,
	ref,
	children,
	size = 'md',
	color,
	startContent,
	tabIndex,
	value,
	...props
}: SelectProps<T>) {
	const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false)
	const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null)
	const [triggerWidth, setTriggerWidth] = useState(0)
	const selectedIndex = useMemo(() => selectedIndexOf(items, value, isItemEqual), [items, value, isItemEqual])
	const selectedItem = value === undefined || value === null ? undefined : selectedIndex >= 0 ? items[selectedIndex] : value
	const isControlledOpen = open !== undefined
	const isOpen = isControlledOpen ? open : uncontrolledIsOpen
	const visible = isOpen && !disabled && !readOnly
	const hasLabel = label !== undefined && label !== null
	const optionHeight = selectItemHeight(size, itemHeight)
	const styles = selectStyles({ fullWidth, hasLabel, open: visible, size, color })
	const selectedContent = selectedItem !== undefined && selectedItem !== null ? children(selectedItem, selectedIndex, true, 'trigger') : description
	const panelStyle = useMemo(() => ({ '--select-width': `${Math.max(triggerWidth, 0)}px` }) as React.CSSProperties, [triggerWidth])

	// Updates open state in controlled and uncontrolled modes.
	const setOpen = useEffectEvent((nextOpen: boolean) => {
		if (!isControlledOpen) setUncontrolledIsOpen(nextOpen)
		if (nextOpen === isOpen) return
		onOpenChange?.(nextOpen)
	})

	// Keeps the floating panel width aligned to the trigger width.
	useEffect(() => {
		if (triggerElement === null) return
		const observedTrigger = triggerElement

		function updateTriggerWidth() {
			setTriggerWidth(observedTrigger.getBoundingClientRect().width)
		}

		updateTriggerWidth()

		const observer = new ResizeObserver(updateTriggerWidth)
		observer.observe(observedTrigger)

		return () => {
			observer.disconnect()
		}
	}, [triggerElement])

	// Closes the floating panel when disabled or read-only state becomes active.
	useEffect(() => {
		if ((disabled || readOnly) && isOpen) {
			setOpen(false)
		}
	}, [disabled, isOpen, readOnly, setOpen])

	// Stores the trigger element while preserving the caller ref.
	function handleTriggerRef(element: HTMLDivElement | null) {
		if (element !== null) setTriggerElement(element)
		assignRef(ref, element)
	}

	// Toggles the panel from pointer interaction on the trigger.
	function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
		onPointerDown?.(event)

		if (event.defaultPrevented || disabled || readOnly) return
		if (event.pointerType === 'mouse' && event.button !== 0) return

		setTriggerElement(event.currentTarget)
		setTriggerWidth(event.currentTarget.getBoundingClientRect().width)
		setOpen(!isOpen)
	}

	// Toggles or closes the panel from simple keyboard interaction.
	function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
		onKeyDown?.(event)

		if (event.defaultPrevented || disabled || readOnly) return

		if (event.key === 'Escape') {
			setOpen(false)
			return
		}

		if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
			event.preventDefault()
			setOpen(!isOpen)
		}
	}

	// Selects a visible option and closes the floating panel.
	function selectItem(event: React.PointerEvent<HTMLButtonElement>, item: T, index: number, selected: boolean) {
		if (event.pointerType === 'mouse' && event.button !== 0) return
		event.preventDefault()
		if (disabled || readOnly) return

		if (!selected) {
			onValueChange?.(item, index)
		}

		setOpen(false)
	}

	// Renders one virtualized option row through the caller-provided renderer.
	function renderOption(index: number) {
		const item = items[index]
		const selected = value !== undefined && value !== null && isItemEqual(item, value)

		return (
			<button className={tw(styles.option(), selected ? 'bg-(--color-variant)/15 text-(--color-variant)' : 'text-neutral-200 hover:bg-neutral-800 hover:text-neutral-100 active:bg-neutral-700', classNames?.option)} onPointerDown={(event) => selectItem(event, item, index, selected)} type="button">
				<span className={tw(styles.optionContent(), classNames?.optionContent)}>{children(item, index, selected, 'list')}</span>
				<span className={tw(styles.selectedIcon(), selected ? 'opacity-100' : 'opacity-0', classNames?.selectedIcon)}>
					<Icons.Check />
				</span>
			</button>
		)
	}

	const panelContent = (
		<div className={tw(styles.panelContent(), classNames?.panelContent)}>
			{headerContent !== undefined && headerContent !== null && <div className={tw(styles.header(), classNames?.header)}>{headerContent}</div>}
			<List className={tw(styles.list(), classNames?.list)} classNames={{ empty: classNames?.empty, item: tw(styles.listItem(), classNames?.listItem) }} emptyContent={emptyContent} itemCount={items.length} itemHeight={optionHeight} overscan={overscan}>
				{renderOption}
			</List>
			{footerContent !== undefined && footerContent !== null && <div className={tw(styles.footer(), classNames?.footer)}>{footerContent}</div>}
		</div>
	)

	return (
		<>
			<div
				{...props}
				className={tw(styles.base(), disabled && 'cursor-not-allowed opacity-40', readOnly && !disabled && 'cursor-default opacity-90 pointer-events-none', className, classNames?.base)}
				id={id}
				onKeyDown={handleKeyDown}
				onPointerDown={handlePointerDown}
				ref={handleTriggerRef}
				tabIndex={disabled ? undefined : (tabIndex ?? 0)}>
				<div className={tw(styles.trigger(), disabled ? 'bg-neutral-900/35 text-neutral-500' : readOnly ? 'bg-neutral-900/55 text-neutral-300' : 'bg-neutral-900/70 text-neutral-100 hover:bg-neutral-800', classNames?.trigger)}>
					{startContent !== undefined && startContent !== null && <div className={tw(styles.startContent(), disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-400', classNames?.startContent)}>{startContent}</div>}
					<div className={tw(styles.field(), classNames?.field)}>
						<div className={tw(styles.value(), startContent !== undefined && startContent !== null && 'pl-0', classNames?.value)}>{selectedItem !== undefined && selectedItem !== null ? selectedContent : <span className={tw(styles.description(), classNames?.description)}>{selectedContent}</span>}</div>
						{hasLabel && <span className={tw(styles.label(), startContent !== undefined && startContent !== null && 'left-0', disabled ? 'text-neutral-600' : readOnly ? 'text-neutral-400' : undefined, classNames?.label)}>{label}</span>}
					</div>
					{endContent !== undefined && endContent !== null && <div className={tw(styles.endContent(), disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-400', classNames?.endContent)}>{endContent}</div>}
					<div className={tw(styles.chevron(), disabled ? 'text-neutral-500' : undefined, classNames?.chevron)}>
						<Icons.ChevronDown />
					</div>
				</div>
			</div>
			<Floating
				autoFlip={autoFlip}
				classNames={{ content: tw(styles.panel(), classNames?.panel) }}
				closeOnEscape
				closeOnPointerDownOutside
				content={panelContent}
				hideArrow
				interactive
				offset={DEFAULT_FLOATING_OFFSET / 2}
				onOpenChange={setOpen}
				open={visible}
				placement={placement}
				portalContainer={portalContainer}
				style={panelStyle}
				triggerElement={triggerElement}
			/>
		</>
	)
}
