import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { assignRef, tw } from '@/shared/util'
import { Icons } from '../Icon'
import { Chip, type ChipClassNames, type ChipProps } from './Chip'
import { DEFAULT_FLOATING_OFFSET, Floating, type FloatingPlacement } from './Floating'
import { List } from './List'

const MULTI_SELECT_ITEM_HEIGHTS = {
	sm: 32,
	md: 40,
	lg: 44,
} as const

const EMPTY_SELECTED_ITEMS: readonly never[] = []

const multiSelectStyles = tv({
	slots: {
		base: 'relative inline-flex min-w-0 align-top',
		trigger: 'flex w-full min-w-0 items-stretch overflow-hidden rounded-lg outline-none transition',
		startContent: 'flex shrink-0 items-center whitespace-nowrap',
		field: 'relative min-w-0 flex-1',
		value: 'flex h-full w-full min-w-0 items-center overflow-hidden',
		chips: 'no-scrollbar flex w-full min-w-0 flex-nowrap items-center gap-1 overflow-x-auto overflow-y-hidden py-0.5',
		chip: 'shrink-0',
		description: 'min-w-0 truncate',
		label: 'pointer-events-none absolute origin-left truncate text-xs leading-none',
		endContent: 'flex shrink-0 items-center gap-1 whitespace-nowrap',
		clearButton: 'flex shrink-0 items-center justify-center rounded-full outline-none transition cursor-pointer',
		chevron: 'flex shrink-0 items-center justify-center transition',
		panel: 'min-w-(--multi-select-width) max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg bg-neutral-950 p-0 text-neutral-100 shadow-lg shadow-black/40',
		panelContent: 'min-w-0',
		header: 'p-2',
		list: 'max-h-72 rounded-none bg-transparent text-neutral-100',
		listItem: 'hover:bg-transparent',
		option: 'flex h-full w-full min-w-max items-center gap-2 text-left transition',
		optionContent: 'min-w-max flex-1 overflow-visible',
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
				clearButton: 'size-4 text-xs',
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
				clearButton: 'size-5 text-sm',
				chevron: 'w-10 text-sm',
				option: 'px-3 text-sm',
				selectedIcon: 'size-5 text-sm',
			},
			lg: {
				trigger: 'min-h-11 text-base',
				startContent: 'px-4 text-base',
				value: 'min-h-11 px-4 text-base',
				label: 'left-5 right-5 top-1.5',
				endContent: 'px-4 text-base',
				clearButton: 'size-6 text-base',
				chevron: 'w-11 text-base',
				option: 'px-4 text-base',
				selectedIcon: 'size-6 text-base',
			},
		},
		color: {
			default: {
				base: '[--color-variant:var(--color-neutral-500)]',
				panel: '[--color-variant:var(--color-neutral-500)]',
			},
			primary: {
				base: '[--color-variant:var(--primary)]',
				panel: '[--color-variant:var(--primary)]',
			},
			secondary: {
				base: '[--color-variant:var(--secondary)]',
				panel: '[--color-variant:var(--secondary)]',
			},
			success: {
				base: '[--color-variant:var(--success)]',
				panel: '[--color-variant:var(--success)]',
			},
			danger: {
				base: '[--color-variant:var(--danger)]',
				panel: '[--color-variant:var(--danger)]',
			},
			warning: {
				base: '[--color-variant:var(--warning)]',
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
				chevron: 'rotate-180',
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
		color: 'default',
		hasLabel: false,
	},
})

type MultiSelectVariants = VariantProps<typeof multiSelectStyles>

export type MultiSelectItemRenderer<T> = (item: T, index: number, selected: boolean, placement: 'chip' | 'list') => React.ReactNode

export interface MultiSelectClassNames {
	readonly base?: ClassValue
	readonly trigger?: ClassValue
	readonly startContent?: ClassValue
	readonly field?: ClassValue
	readonly value?: ClassValue
	readonly chips?: ClassValue
	readonly chip?: ClassValue
	readonly chipLabel?: ClassValue
	readonly chipCloseButton?: ClassValue
	readonly description?: ClassValue
	readonly label?: ClassValue
	readonly endContent?: ClassValue
	readonly clearButton?: ClassValue
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

export interface MultiSelectProps<T> extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'defaultValue' | 'onChange' | 'color'>, Omit<MultiSelectVariants, 'hasLabel'> {
	readonly autoFlip?: boolean
	readonly items: readonly T[]
	readonly value?: readonly T[] | null
	readonly children: MultiSelectItemRenderer<T>
	readonly onValueChange?: (value: T[]) => void
	readonly isItemEqual?: (item: T, value: T) => boolean
	readonly chipClassNames?: ChipClassNames
	readonly chipColor?: ChipProps['color']
	readonly chipSize?: ChipProps['size']
	readonly classNames?: MultiSelectClassNames
	readonly clearable?: boolean
	readonly cleareable?: boolean
	readonly description?: React.ReactNode
	readonly disallowEmptySelection?: boolean
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
	readonly onAction?: (item: T, index: number) => void
}

// Finds a selected value in the current option list.
function itemIndexOf<T>(items: readonly T[], value: T, isItemEqual: (item: T, value: T) => boolean) {
	for (let i = 0; i < items.length; i++) {
		if (isItemEqual(items[i], value)) return i
	}

	return -1
}

// Finds an option item inside the selected value list.
function selectedValueIndexOf<T>(selectedItems: readonly T[], item: T, isItemEqual: (item: T, value: T) => boolean) {
	for (let i = 0; i < selectedItems.length; i++) {
		if (isItemEqual(item, selectedItems[i])) return i
	}

	return -1
}

// Normalizes panel item height to match the MultiSelect size by default.
function multiSelectItemHeight(size: NonNullable<MultiSelectVariants['size']>, itemHeight: number | undefined) {
	return itemHeight !== undefined && Number.isFinite(itemHeight) && itemHeight > 0 ? itemHeight : MULTI_SELECT_ITEM_HEIGHTS[size]
}

// Renders a controlled multi-select trigger with selected chips and a floating virtualized option list.
export function MultiSelect<T>({
	autoFlip = true,
	chipClassNames,
	chipColor,
	chipSize,
	className,
	classNames,
	clearable = false,
	cleareable,
	description = 'Select items',
	disallowEmptySelection = false,
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
	onClick,
	onValueChange,
	onAction,
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
}: MultiSelectProps<T>) {
	const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false)
	const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null)
	const [triggerWidth, setTriggerWidth] = useState(0)
	const [optionContentWidth, setOptionContentWidth] = useState(0)
	const optionContentWidthRef = useRef(0)
	const selectedItems = value ?? EMPTY_SELECTED_ITEMS
	const selectedEntries = useMemo(() => selectedItems.map((item) => ({ index: itemIndexOf(items, item, isItemEqual), item })), [items, selectedItems, isItemEqual])
	const isControlledOpen = open !== undefined
	const isOpen = isControlledOpen ? open : uncontrolledIsOpen
	const visible = isOpen && !disabled && !readOnly
	const hasLabel = label !== undefined && label !== null
	const optionHeight = multiSelectItemHeight(size, itemHeight)
	const styles = multiSelectStyles({ fullWidth, hasLabel, open: visible, size, color })
	const panelStyle = useMemo(() => ({ '--multi-select-width': `${Math.max(triggerWidth, 0)}px`, minWidth: Math.max(triggerWidth, optionContentWidth, 0) }) as React.CSSProperties, [optionContentWidth, triggerWidth])
	const hasColorVariant = color !== undefined && color !== null && color !== 'default'
	const hasSelectedItems = selectedEntries.length > 0
	const canClearSelection = !disallowEmptySelection && hasSelectedItems
	const canUnselectSelectedItem = !disallowEmptySelection || selectedItems.length > 1
	const showClearButton = (clearable || cleareable === true) && canClearSelection && !disabled && !readOnly
	const renderedChipColor = chipColor ?? color ?? 'default'
	const renderedChipSize = chipSize ?? size
	const triggerClassName = disabled
		? 'bg-neutral-900/35 text-neutral-500'
		: readOnly
			? 'bg-neutral-900/55 text-neutral-300'
			: hasColorVariant
				? tw('bg-(--color-variant)/15 text-lighter-(--color-variant)/85 hover:bg-(--color-variant)/20', visible && 'bg-(--color-variant)/25')
				: tw('bg-neutral-900/70 text-neutral-100 hover:bg-neutral-800', visible && 'bg-neutral-800')
	const contentClassName = disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : hasColorVariant ? 'text-lighter-(--color-variant)/60' : 'text-neutral-400'
	const descriptionClassName = disabled ? 'text-neutral-600' : readOnly ? 'text-neutral-500' : hasColorVariant ? 'text-lighter-(--color-variant)/45' : 'text-neutral-500'
	const labelClassName = disabled ? 'text-neutral-600' : readOnly ? 'text-neutral-400' : hasColorVariant ? 'text-lighter-(--color-variant)/65' : 'text-neutral-400'
	const clearButtonClassName = hasColorVariant ? 'text-lighter-(--color-variant)/60 hover:bg-(--color-variant)/15 hover:text-lighter-(--color-variant)/85 active:bg-(--color-variant)/10' : 'text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 active:bg-neutral-800'
	const chevronClassName = disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : hasColorVariant ? (visible ? 'text-lighter-(--color-variant)/85' : 'text-lighter-(--color-variant)/60') : visible ? 'text-neutral-200' : 'text-neutral-400'

	// Updates open state in controlled and uncontrolled modes.
	const setOpen = useEffectEvent((nextOpen: boolean) => {
		if (!isControlledOpen) setUncontrolledIsOpen(nextOpen)
		if (nextOpen === isOpen) return
		onOpenChange?.(nextOpen)
	})

	// Emits a new selected item list after an item is added or removed.
	const setSelectedItems = useEffectEvent((nextSelectedItems: T[]) => {
		if (disallowEmptySelection && nextSelectedItems.length === 0) return
		onValueChange?.(nextSelectedItems)
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

	// Clears mounted option measurements when the floating panel closes.
	useEffect(() => {
		if (visible) return

		optionContentWidthRef.current = 0
		setOptionContentWidth(0)
	}, [visible])

	// Tracks the widest mounted option so the panel can fit visible content.
	function measureOptionWidth(element: HTMLDivElement | null) {
		if (element === null) return

		const width = Math.ceil(element.scrollWidth)
		if (width <= optionContentWidthRef.current) return

		optionContentWidthRef.current = width
		setOptionContentWidth(width)
	}

	// Stores the trigger element while preserving the caller ref.
	function handleTriggerRef(element: HTMLDivElement | null) {
		if (element !== null) setTriggerElement(element)
		assignRef(ref, element)
	}

	// Toggles the panel from pointer interaction on the trigger.
	function handleClick(event: React.MouseEvent<HTMLDivElement>) {
		onClick?.(event)

		if (event.defaultPrevented || disabled || readOnly) return

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

	// Removes one selected item from the controlled value list.
	function unselectItem(item: T) {
		if (!canUnselectSelectedItem) return

		setSelectedItems(selectedItems.filter((selectedItem) => !isItemEqual(item, selectedItem)))
	}

	// Toggles one visible option without closing the floating panel.
	function toggleItem(event: React.MouseEvent, item: T, selected: boolean) {
		event.preventDefault()

		if (disabled || readOnly) return

		if (selected) {
			unselectItem(item)
		} else {
			setSelectedItems([...selectedItems, item])
		}
	}

	// Clears all selected items from the controlled value list.
	function clearSelection(event: React.MouseEvent<HTMLButtonElement>) {
		event.preventDefault()
		event.stopPropagation()

		if (disabled || readOnly || !canClearSelection) return

		setSelectedItems([])
	}

	// Renders one selected chip with the same renderer used by list options.
	function renderChip(item: T, index: number, selectedIndex: number) {
		return (
			<Chip
				className={tw(styles.chip(), classNames?.chip)}
				classNames={{ ...chipClassNames, label: tw(chipClassNames?.label, classNames?.chipLabel), closeButton: tw(chipClassNames?.closeButton, classNames?.chipCloseButton) }}
				color={renderedChipColor}
				disabled={disabled}
				key={selectedIndex}
				onClose={canUnselectSelectedItem ? () => unselectItem(item) : undefined}
				readOnly={readOnly}
				size={renderedChipSize}>
				{children(item, index, true, 'chip')}
			</Chip>
		)
	}

	// Renders one virtualized option row through the caller-provided renderer.
	function renderOption(index: number) {
		const item = items[index]
		const selected = selectedValueIndexOf(selectedItems, item, isItemEqual) >= 0

		return (
			<div
				className={tw(styles.option(), selected ? 'bg-(--color-variant)/15 text-lighter-(--color-variant)/75' : 'text-neutral-200 hover:bg-neutral-800 hover:text-neutral-100 active:bg-neutral-700', classNames?.option)}
				onClick={(event) => toggleItem(event, item, selected)}
				ref={measureOptionWidth}
				role="button">
				<span className={tw(styles.optionContent(), classNames?.optionContent)}>{children(item, index, selected, 'list')}</span>
				<span className={tw(styles.selectedIcon(), selected ? 'opacity-100' : 'opacity-0', classNames?.selectedIcon)}>
					<Icons.Check />
				</span>
			</div>
		)
	}

	function handleOnAction(index: number) {
		onAction!(items[index], index)
	}

	const PanelContent = (
		<div className={tw(styles.panelContent(), classNames?.panelContent)}>
			{headerContent !== undefined && headerContent !== null && <div className={tw(styles.header(), classNames?.header)}>{headerContent}</div>}
			<List className={tw(styles.list(), classNames?.list)} classNames={{ empty: classNames?.empty, item: tw(styles.listItem(), classNames?.listItem) }} emptyContent={emptyContent} itemCount={items.length} itemHeight={optionHeight} overscan={overscan} onAction={onAction && handleOnAction}>
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
				onClick={handleClick}
				ref={handleTriggerRef}
				tabIndex={disabled ? undefined : (tabIndex ?? 0)}>
				<div className={tw(styles.trigger(), triggerClassName, classNames?.trigger)}>
					{startContent !== undefined && startContent !== null && <div className={tw(styles.startContent(), contentClassName, classNames?.startContent)}>{startContent}</div>}
					<div className={tw(styles.field(), classNames?.field)}>
						<div className={tw(styles.value(), startContent !== undefined && startContent !== null && 'pl-0', classNames?.value)}>
							{hasSelectedItems ? <div className={tw(styles.chips(), classNames?.chips)}>{selectedEntries.map((entry, index) => renderChip(entry.item, entry.index, index))}</div> : <span className={tw(styles.description(), descriptionClassName, classNames?.description)}>{description}</span>}
						</div>
						{hasLabel && <span className={tw(styles.label(), startContent !== undefined && startContent !== null && 'left-0', labelClassName, classNames?.label)}>{label}</span>}
					</div>
					{(endContent !== undefined && endContent !== null) || showClearButton ? (
						<div className={tw(styles.endContent(), contentClassName, classNames?.endContent)}>
							{endContent}
							{showClearButton && (
								<button className={tw(styles.clearButton(), clearButtonClassName, classNames?.clearButton)} onClick={clearSelection} type="button">
									<Icons.Close />
								</button>
							)}
						</div>
					) : undefined}
					<div className={tw(styles.chevron(), chevronClassName, classNames?.chevron)}>
						<Icons.ChevronDown />
					</div>
				</div>
			</div>
			<Floating
				autoFlip={autoFlip}
				classNames={{ content: tw(styles.panel(), classNames?.panel) }}
				closeOnEscape
				closeOnClickOutside
				content={PanelContent}
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
