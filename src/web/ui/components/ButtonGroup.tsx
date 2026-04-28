import type * as React from 'react'
import { Children, Fragment, isValidElement } from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { tw } from '@/shared/util'

const BUTTON_GROUP_ITEM_CHILD_TYPE = Symbol('ButtonGroupItem')

const buttonGroupStyles = tv({
	slots: {
		base: 'inline-flex min-w-0 items-stretch gap-px align-top',
		item: ['inline-flex min-w-0 items-center justify-center gap-2 font-normal select-none transition', 'focus-visible:outline-none focus-visible:ring-0'],
		startContent: 'flex shrink-0 items-center justify-center',
		label: 'min-w-0 flex-1 truncate text-center',
		endContent: 'flex shrink-0 items-center justify-center',
	},
	variants: {
		size: {
			sm: {
				item: 'h-8 min-w-8 px-2 text-sm',
				startContent: 'text-sm',
				label: 'text-sm',
				endContent: 'text-sm',
			},
			md: {
				item: 'h-10 min-w-10 px-2 text-sm',
				startContent: 'text-sm',
				label: 'text-sm',
				endContent: 'text-sm',
			},
			lg: {
				item: 'h-11 min-w-11 px-2 text-base',
				startContent: 'text-base',
				label: 'text-base',
				endContent: 'text-base',
			},
		},
		color: {
			default: {
				base: '[--color-variant:var(--color-neutral-500)]',
				item: '[--color-variant:var(--color-neutral-500)]',
			},
			primary: {
				base: '[--color-variant:var(--primary)]',
				item: '[--color-variant:var(--primary)]',
			},
			secondary: {
				base: '[--color-variant:var(--secondary)]',
				item: '[--color-variant:var(--secondary)]',
			},
			success: {
				base: '[--color-variant:var(--success)]',
				item: '[--color-variant:var(--success)]',
			},
			danger: {
				base: '[--color-variant:var(--danger)]',
				item: '[--color-variant:var(--danger)]',
			},
			warning: {
				base: '[--color-variant:var(--warning)]',
				item: '[--color-variant:var(--warning)]',
			},
		},
		selected: {
			true: {
				item: 'bg-(--color-variant) text-white hover:bg-(--color-variant)/90 active:bg-(--color-variant)/85',
			},
			false: {
				item: 'bg-(--color-variant)/20 text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
		},
		position: {
			single: {
				item: 'rounded-lg',
			},
			first: {
				item: 'rounded-l-lg rounded-r-none',
			},
			middle: {
				item: 'rounded-none',
			},
			last: {
				item: 'rounded-l-none rounded-r-lg',
			},
		},
		fullWidth: {
			true: {
				base: 'w-full',
				item: 'flex-1',
			},
		},
	},
	defaultVariants: {
		size: 'md',
		color: 'primary',
		selected: false,
		position: 'single',
	},
})

type ButtonGroupVariants = Omit<VariantProps<typeof buttonGroupStyles>, 'position' | 'selected'>
type ButtonGroupItemVariants = Pick<ButtonGroupVariants, 'color' | 'size'>
type ButtonGroupItemPosition = 'single' | 'first' | 'middle' | 'last'

type ButtonGroupChildComponent = {
	buttonGroupChildType?: symbol
}

export type ButtonGroupId = string | number | boolean | bigint | symbol

export interface ButtonGroupClassNames {
	readonly base?: ClassValue
	readonly item?: ClassValue
	readonly itemStartContent?: ClassValue
	readonly itemLabel?: ClassValue
	readonly itemEndContent?: ClassValue
}

export interface ButtonGroupProps<T extends ButtonGroupId = string> extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'color' | 'defaultValue' | 'onChange'>, ButtonGroupVariants {
	readonly children?: React.ReactNode
	readonly classNames?: ButtonGroupClassNames
	readonly disabled?: boolean
	readonly readOnly?: boolean
	readonly value: T
	readonly onValueChange: (value: T) => void
}

export interface ButtonGroupItemProps<T extends ButtonGroupId = string> extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'color' | 'id'>, ButtonGroupItemVariants {
	readonly children?: React.ReactNode
	readonly disabled?: boolean
	readonly endContent?: React.ReactNode
	readonly id: T
	readonly label?: React.ReactNode
	readonly readOnly?: boolean
	readonly startContent?: React.ReactNode
}

// Marks selectable button declarations that are rendered by the owning ButtonGroup.
export function ButtonGroupItem<T extends ButtonGroupId = string>(props: ButtonGroupItemProps<T>) {
	return null
}

const ButtonGroupItemMarker = ButtonGroupItem as typeof ButtonGroupItem & ButtonGroupChildComponent
ButtonGroupItemMarker.buttonGroupChildType = BUTTON_GROUP_ITEM_CHILD_TYPE

// Reads the marker from a compound ButtonGroup child component.
function buttonGroupChildTypeOf(type: unknown) {
	return typeof type === 'function' || (typeof type === 'object' && type !== null) ? (type as ButtonGroupChildComponent).buttonGroupChildType : undefined
}

// Checks whether the value can be used as a primitive ButtonGroup id.
function isButtonGroupId(value: unknown): value is ButtonGroupId {
	const type = typeof value
	return type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint' || type === 'symbol'
}

// Checks whether a React element can be rendered as a ButtonGroup item.
function isButtonGroupItemElement<T extends ButtonGroupId>(child: React.ReactElement): child is React.ReactElement<ButtonGroupItemProps<T>> {
	if (buttonGroupChildTypeOf(child.type) === BUTTON_GROUP_ITEM_CHILD_TYPE) return true
	return isButtonGroupId((child.props as { id?: unknown }).id)
}

// Collects selectable children while allowing callers to group items in fragments.
function collectButtonGroupItems<T extends ButtonGroupId>(children: React.ReactNode, items: React.ReactElement<ButtonGroupItemProps<T>>[] = []) {
	for (const child of Children.toArray(children)) {
		if (!isValidElement(child)) continue

		if (child.type === Fragment) {
			collectButtonGroupItems<T>((child.props as { children?: React.ReactNode }).children, items)
			continue
		}

		if (isButtonGroupItemElement<T>(child)) {
			items.push(child)
		}
	}

	return items
}

// Returns the rounded-edge placement for an item inside the group.
function buttonGroupItemPosition(index: number, count: number): ButtonGroupItemPosition {
	if (count <= 1) return 'single'
	if (index === 0) return 'first'
	if (index === count - 1) return 'last'
	return 'middle'
}

// Renders a controlled, segmented button group using Button flat and solid styling.
export function ButtonGroup<T extends ButtonGroupId = string>({ children, className, classNames, color, disabled = false, fullWidth, onValueChange, readOnly = false, ref, size, value, ...props }: ButtonGroupProps<T>) {
	const items = collectButtonGroupItems<T>(children)
	const styles = buttonGroupStyles({ color, fullWidth, size })

	// Updates the selected value unless the group is already blocked or unchanged.
	function selectItem(nextValue: T) {
		if (disabled || readOnly || Object.is(value, nextValue)) return
		onValueChange(nextValue)
	}

	// Renders one selectable ButtonGroup item declaration.
	function renderItem(item: React.ReactElement<ButtonGroupItemProps<T>>, index: number) {
		const { children: itemChildren, className: itemClassName, color: itemColor = color, disabled: itemDisabled = false, endContent, id, label, onKeyDown, onPointerUp, readOnly: itemReadOnly = false, ref: itemRef, size: itemSize = size, startContent, tabIndex, ...itemProps } = item.props
		const selected = Object.is(value, id)
		const itemStyles = buttonGroupStyles({ color: itemColor, fullWidth, position: buttonGroupItemPosition(index, items.length), selected, size: itemSize })
		const content = label ?? itemChildren
		const blocked = disabled || itemDisabled || readOnly || itemReadOnly
		const stateClassName = disabled || itemDisabled ? 'cursor-not-allowed opacity-40 pointer-events-none' : readOnly || itemReadOnly ? 'cursor-default opacity-90 pointer-events-none' : 'cursor-pointer'

		// Selects this item from pointer interaction.
		function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
			onPointerUp?.(event)

			if (event.defaultPrevented || blocked) return
			if (event.pointerType === 'mouse' && event.button !== 0) return

			event.preventDefault()
			selectItem(id)
		}

		// Selects this item from simple keyboard interaction.
		function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
			onKeyDown?.(event)

			if (event.defaultPrevented || blocked) return

			if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
				event.preventDefault()
				selectItem(id)
			}
		}

		return (
			<div {...itemProps} className={tw(itemStyles.item(), stateClassName, classNames?.item, itemClassName)} key={item.key ?? String(id)} onKeyDown={handleKeyDown} onPointerUp={handlePointerUp} ref={itemRef} role="button" tabIndex={disabled || itemDisabled ? undefined : (tabIndex ?? 0)}>
				{startContent !== undefined && startContent !== null && <span className={tw(itemStyles.startContent(), classNames?.itemStartContent)}>{startContent}</span>}
				{content !== undefined && content !== null && <span className={tw(itemStyles.label(), classNames?.itemLabel)}>{content}</span>}
				{endContent !== undefined && endContent !== null && <span className={tw(itemStyles.endContent(), classNames?.itemEndContent)}>{endContent}</span>}
			</div>
		)
	}

	return (
		<div {...props} className={tw(styles.base(), className, classNames?.base)} ref={ref}>
			{items.map(renderItem)}
		</div>
	)
}
