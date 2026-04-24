import * as React from 'react'
import { useEffect, useEffectEvent, useState } from 'react'
import { assignRef } from '@/shared/util'
import { Floating, type FloatingClassNames, type FloatingPlacement } from './Floating'

export type PopoverPlacement = FloatingPlacement
export type PopoverClassNames = FloatingClassNames

export interface PopoverProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'content'> {
	readonly children?: React.ReactNode
	readonly trigger?: React.ReactNode
	readonly placement?: PopoverPlacement
	readonly open?: boolean
	readonly onOpenChange?: (open: boolean) => void
	readonly disabled?: boolean
	readonly autoFlip?: boolean
	readonly portalContainer?: Element
	readonly classNames?: PopoverClassNames
	readonly offset?: number
}

// Renders a pointer-triggered popover wrapper around the shared floating content.
export function Popover({ autoFlip, trigger, children, className, classNames, id, open, onOpenChange, disabled = false, offset, placement, portalContainer, ref, style, ...props }: PopoverProps) {
	const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false)
	const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null)
	const hasContent = children !== undefined && children !== null && children !== false
	const isControlled = open !== undefined
	const isOpen = isControlled ? open : uncontrolledIsOpen
	const visible = hasContent && !disabled && isOpen

	// Updates the popover open state in controlled and uncontrolled modes.
	const setOpen = useEffectEvent((nextOpen: boolean) => {
		if (!isControlled) setUncontrolledIsOpen(nextOpen)
		if (nextOpen === isOpen) return
		onOpenChange?.(nextOpen)
	})

	// Keeps the trigger element available for controlled initial-open rendering.
	function handleTriggerRef(element: HTMLElement | null) {
		if (element !== null) setTriggerElement(element)
	}

	// Closes the popover through the shared floating surface callbacks.
	const closePopover = useEffectEvent(() => {
		setOpen(false)
	})

	// Forces the popover closed when content disappears or the trigger becomes disabled.
	useEffect(() => {
		if (disabled || !hasContent) {
			closePopover()
		}
	}, [disabled, hasContent, closePopover])

	if (hasContent) {
		// Toggles the popover from the current trigger element.
		function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
			if (disabled || !hasContent) return
			if (event.pointerType === 'mouse' && event.button !== 0) return
			handleTriggerRef(event.currentTarget)
			setOpen(!isOpen)
		}

		if (React.isValidElement(trigger) && trigger.type !== React.Fragment) {
			const child = trigger as React.ReactElement<React.DOMAttributes<HTMLElement> & { readonly ref?: React.Ref<HTMLElement> }>

			trigger = React.cloneElement(child, {
				ref: (element: HTMLElement | null) => {
					handleTriggerRef(element)
					assignRef(child.props.ref, element)
				},
				onPointerDown: (event) => {
					child.props.onPointerDown?.(event)

					if (!event.defaultPrevented) {
						handlePointerDown(event)
					}
				},
			})
		} else {
			trigger = (
				<span className="w-fit" onPointerDown={handlePointerDown} ref={handleTriggerRef}>
					{trigger}
				</span>
			)
		}
	}

	return (
		<>
			{trigger}
			{hasContent && (
				<Floating
					{...props}
					autoFlip={autoFlip}
					className={className}
					classNames={classNames}
					closeOnEscape
					closeOnPointerDownOutside
					content={children}
					id={id}
					interactive
					offset={offset}
					onOpenChange={setOpen}
					open={visible}
					placement={placement}
					portalContainer={portalContainer}
					ref={ref}
					style={style}
					triggerElement={triggerElement}
				/>
			)}
		</>
	)
}
