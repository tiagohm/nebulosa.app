import type * as React from 'react'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { type ClassValue, tv } from 'tailwind-variants'
import { assignRef, tw } from '@/shared/util'
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
		panel: 'w-(--dropdown-width) min-w-48 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg bg-neutral-950 p-0 text-neutral-100 shadow-lg shadow-black/40',
		panelContent: 'min-w-0',
		header: 'p-2',
		list: 'max-h-72 rounded-none bg-transparent text-neutral-100',
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

type DropdownSize = keyof typeof DROPDOWN_ITEM_HEIGHTS

export interface DropdownClassNames {
	readonly trigger?: ClassValue
	readonly chevron?: ClassValue
	readonly panel?: ClassValue
	readonly panelContent?: ClassValue
	readonly header?: ClassValue
	readonly list?: ClassValue
	readonly listItem?: ClassValue
	readonly footer?: ClassValue
	readonly empty?: ClassValue
}

export interface DropdownProps extends Omit<ButtonProps, 'children'> {
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
	onPointerDown,
	open,
	overscan,
	placement = 'bottom',
	portalContainer,
	readOnly = false,
	ref,
	size = 'md',
	...props
}: DropdownProps) {
	const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false)
	const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null)
	const [triggerWidth, setTriggerWidth] = useState(0)
	const isControlledOpen = open !== undefined
	const isOpen = isControlledOpen ? open : uncontrolledIsOpen
	const visible = isOpen && !disabled && !readOnly && loading !== true
	const styles = dropdownStyles({ open: visible })
	const optionHeight = dropdownItemHeight(size, itemHeight)
	const panelStyle = useMemo(() => ({ '--dropdown-width': `${Math.max(triggerWidth, 0)}px` }) as React.CSSProperties, [triggerWidth])

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

	// Stores the trigger element while preserving the caller ref.
	function handleTriggerRef(element: HTMLDivElement | null) {
		if (element !== null) setTriggerElement(element)
		assignRef(ref, element)
	}

	// Toggles the panel from pointer interaction on the trigger.
	function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
		onPointerDown?.(event)

		if (event.defaultPrevented || disabled || readOnly || loading === true) return
		if (event.pointerType === 'mouse' && event.button !== 0) return

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

	const TriggerEndContent = (
		<>
			{endContent}
			<Icons.ChevronDown className={tw(styles.chevron(), classNames?.chevron)} />
		</>
	)

	const PanelContent = (
		<div className={tw(styles.panelContent(), classNames?.panelContent)}>
			{headerContent !== undefined && headerContent !== null && <div className={tw(styles.header(), classNames?.header)}>{headerContent}</div>}
			<List className={tw(styles.list(), classNames?.list)} classNames={{ empty: classNames?.empty, item: classNames?.listItem }} emptyContent={emptyContent} itemHeight={optionHeight} overscan={overscan}>
				{children}
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
				onPointerDown={handlePointerDown}
				ref={handleTriggerRef}
				size={size}
			/>
			<Floating
				autoFlip={autoFlip}
				classNames={{ content: tw(styles.panel(), classNames?.panel) }}
				closeOnEscape
				closeOnPointerDownOutside
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
