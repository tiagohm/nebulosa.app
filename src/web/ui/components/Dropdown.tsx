import { Children, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { assignRef, stopPropagation, tw } from '@/shared/util'
import { Icons } from '../Icon'
import { Button, type ButtonProps } from './Button'
import { DEFAULT_FLOATING_OFFSET, Floating, type FloatingPlacement } from './Floating'
import { List } from './List'

const DROPDOWN_ITEM_HEIGHTS = {
	sm: 32,
	md: 40,
	lg: 44,
} as const

const dropdownStyles = tv({
	slots: {
		trigger: 'min-w-0',
		chevron: 'shrink-0 transition',
		panel: 'min-w-(--dropdown-width) max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg bg-neutral-950 p-0 text-neutral-100 shadow-lg shadow-black/40',
		panelContent: 'min-w-0',
		header: 'p-2',
		list: 'max-h-72 rounded-none bg-transparent text-neutral-100',
		listItem: 'hover:bg-transparent',
		option: 'flex h-full w-full min-w-max items-center',
		footer: 'p-2',
	},
	variants: {
		open: {
			true: {
				chevron: 'rotate-180 text-neutral-200',
			},
		},
	},
})

const dropdownItemStyles = tv({
	slots: {
		base: 'flex h-full w-full min-w-max items-center justify-center gap-2 transition py-2 ps-2 pe-4',
		startContent: 'flex shrink-0 items-center justify-center px-2',
		label: 'min-w-max flex-1 overflow-visible whitespace-nowrap',
		endContent: 'flex shrink-0 items-center justify-center px-2',
	},
	variants: {
		disabled: {
			true: {
				base: 'cursor-not-allowed opacity-40 pointer-events-none',
			},
			false: {
				base: 'cursor-pointer',
			},
		},
		variant: {
			solid: {
				base: 'bg-(--color-variant) text-white hover:bg-(--color-variant)/90 active:bg-(--color-variant)/85',
			},
			ghost: {
				base: 'bg-transparent text-(--color-variant) hover:bg-(--color-variant)/20 active:bg-(--color-variant)/15',
			},
			flat: {
				base: 'bg-(--color-variant)/20 text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
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
	},
	compoundVariants: [
		{
			color: 'default',
			variant: 'ghost',
			class: {
				base: 'text-neutral-100 hover:bg-neutral-800 active:bg-neutral-700',
				startContent: 'text-neutral-400',
				label: 'text-neutral-100',
				endContent: 'text-neutral-400',
			},
		},
	],
	defaultVariants: {
		disabled: false,
		color: 'default',
		variant: 'ghost',
	},
})

type DropdownItemVariants = VariantProps<typeof dropdownItemStyles>

type DropdownSize = keyof typeof DROPDOWN_ITEM_HEIGHTS

export interface DropdownClassNames {
	readonly trigger?: ClassValue
	readonly chevron?: ClassValue
	readonly panel?: ClassValue
	readonly panelContent?: ClassValue
	readonly header?: ClassValue
	readonly list?: ClassValue
	readonly listItem?: ClassValue
	readonly option?: ClassValue
	readonly footer?: ClassValue
	readonly empty?: ClassValue
}

export interface DropdownProps extends Omit<ButtonProps, 'children' | 'classNames'> {
	readonly autoFlip?: boolean
	readonly children?: React.ReactNode
	readonly classNames?: DropdownClassNames
	readonly emptyContent?: React.ReactNode
	readonly footerContent?: React.ReactNode
	readonly headerContent?: React.ReactNode
	readonly itemHeight?: number
	readonly onOpenChange?: (open: boolean) => void
	readonly open?: boolean
	readonly overscan?: number
	readonly placement?: FloatingPlacement
	readonly portalContainer?: Element
	readonly readOnly?: boolean
	readonly onAction?: (index: number) => void
	readonly hideChevron?: boolean
}

// Normalizes panel item height to match the trigger size by default.
function dropdownItemHeight(size: DropdownSize, itemHeight: number | undefined) {
	return itemHeight !== undefined && Number.isFinite(itemHeight) && itemHeight > 0 ? itemHeight : DROPDOWN_ITEM_HEIGHTS[size]
}

// Renders a button-triggered dropdown with a floating list panel.
export function Dropdown({
	autoFlip = true,
	children,
	className,
	classNames,
	disabled = false,
	emptyContent = 'No items',
	endContent,
	footerContent,
	headerContent,
	itemHeight,
	loading,
	onKeyDown,
	onOpenChange,
	onClick,
	onAction,
	open,
	overscan,
	placement = 'bottom',
	portalContainer,
	readOnly = false,
	ref,
	size = 'md',
	hideChevron,
	...props
}: DropdownProps) {
	const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false)
	const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null)
	const [triggerWidth, setTriggerWidth] = useState(0)
	const [optionContentWidth, setOptionContentWidth] = useState(0)
	const optionContentWidthRef = useRef(0)
	const items = useMemo(() => Children.toArray(children), [children])
	const isControlledOpen = open !== undefined
	const isOpen = isControlledOpen ? open : uncontrolledIsOpen
	const visible = isOpen && !disabled && !readOnly && loading !== true
	const styles = dropdownStyles({ open: visible })
	const optionHeight = dropdownItemHeight(size, itemHeight)
	const panelStyle = useMemo(() => ({ '--dropdown-width': `${Math.max(triggerWidth, 0)}px`, minWidth: Math.max(triggerWidth, optionContentWidth, 0) }) as React.CSSProperties, [optionContentWidth, triggerWidth])

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

	// Closes the floating panel when the trigger stops accepting interaction.
	useEffect(() => {
		if ((disabled || readOnly || loading === true) && isOpen) {
			setOpen(false)
		}
	}, [disabled, isOpen, loading, readOnly, setOpen])

	// Clears mounted item measurements when the floating panel closes.
	useEffect(() => {
		if (visible) return

		optionContentWidthRef.current = 0
		setOptionContentWidth(0)
	}, [visible])

	// Tracks the widest mounted item so the panel can fit visible content.
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

		if (event.defaultPrevented || disabled || readOnly || loading === true) return

		stopPropagation(event)
		setTriggerElement(event.currentTarget)
		setTriggerWidth(event.currentTarget.getBoundingClientRect().width)
		setOpen(!isOpen)
	}

	// Toggles or closes the panel from simple keyboard interaction.
	function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
		onKeyDown?.(event)

		if (event.defaultPrevented || disabled || readOnly || loading === true) return

		if (event.key === 'Escape') {
			setOpen(false)
			return
		}

		if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
			event.preventDefault()
			setOpen(!isOpen)
		}
	}

	function handleOnAction(index: number) {
		if (disabled || readOnly || loading === true || onAction === undefined) return
		onAction(index)
		setOpen(false)
	}

	function renderItem(index: number) {
		return (
			<div className={tw(styles.option(), classNames?.option)} ref={measureOptionWidth}>
				{items[index]}
			</div>
		)
	}

	const TriggerEndContent = (
		<>
			{endContent}
			{!hideChevron && <Icons.ChevronDown className={tw(styles.chevron(), classNames?.chevron)} />}
		</>
	)

	const PanelContent = (
		<div className={tw(styles.panelContent(), classNames?.panelContent)}>
			{headerContent !== undefined && headerContent !== null && <div className={tw(styles.header(), classNames?.header)}>{headerContent}</div>}
			<List className={tw(styles.list(), classNames?.list)} classNames={{ empty: classNames?.empty, item: tw(styles.listItem(), classNames?.listItem) }} emptyContent={emptyContent} itemCount={items.length} itemHeight={optionHeight} overscan={overscan} onAction={onAction && handleOnAction}>
				{renderItem}
			</List>
			{footerContent !== undefined && footerContent !== null && <div className={tw(styles.footer(), classNames?.footer)}>{footerContent}</div>}
		</div>
	)

	return (
		<>
			<Button
				{...props}
				className={tw(styles.trigger(), readOnly && !disabled && 'cursor-default opacity-90 pointer-events-none', className, classNames?.trigger)}
				disabled={disabled}
				endContent={TriggerEndContent}
				loading={loading}
				onKeyDown={handleKeyDown}
				onClick={handleClick}
				ref={handleTriggerRef}
				size={size}
			/>
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

export interface DropdownItemClassNames {
	readonly base?: ClassValue
	readonly startContent?: ClassValue
	readonly label?: ClassValue
	readonly endContent?: ClassValue
}

export interface DropdownItemProps extends Omit<React.ComponentProps<'div'>, 'color'>, Omit<DropdownItemVariants, 'disabled'> {
	readonly classNames?: DropdownItemClassNames
	readonly disabled?: boolean
	readonly endContent?: React.ReactNode
	readonly label?: React.ReactNode
	readonly startContent?: React.ReactNode
}

// Render a dropdown row with optional leading and trailing content.
export function DropdownItem({ label, children, className, classNames, color, disabled = false, endContent, startContent, variant, ...props }: DropdownItemProps) {
	const content = children ?? label
	const styles = dropdownItemStyles({ color, disabled, variant })

	return (
		<div className={tw(styles.base(), className, classNames?.base)} {...props}>
			{startContent !== undefined && startContent !== null && <span className={tw(styles.startContent(), classNames?.startContent)}>{startContent}</span>}
			{content !== undefined && content !== null && <div className={tw(styles.label(), classNames?.label)}>{content}</div>}
			{endContent !== undefined && endContent !== null && <span className={tw(styles.endContent(), classNames?.endContent)}>{endContent}</span>}
		</div>
	)
}
