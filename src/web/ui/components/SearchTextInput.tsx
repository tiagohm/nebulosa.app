import { stopPropagation, tw } from 'src/web/shared/util'
import { tv, type ClassValue } from 'tailwind-variants'
import { Icons } from '../Icon'
import { TextInput, type TextInputProps } from './TextInput'

const searchTextInputStyles = tv({
	slots: {
		closeButton: 'flex shrink-0 items-center justify-center rounded-full outline-none transition cursor-pointer',
	},
	variants: {
		size: {
			sm: {
				closeButton: 'size-4 text-xs',
			},
			md: {
				closeButton: 'size-5 text-sm',
			},
			lg: {
				closeButton: 'size-6 text-base',
			},
		},
		color: {
			default: {
				closeButton: 'text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
			primary: {
				closeButton: 'text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
			secondary: {
				closeButton: 'text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
			success: {
				closeButton: 'text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
			danger: {
				closeButton: 'text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
			warning: {
				closeButton: 'text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
		},
	},
	defaultVariants: {
		size: 'md',
		color: 'default',
	},
})

export interface SearchInputProps extends TextInputProps {
	readonly classNames?: TextInputProps['classNames'] & { readonly clearButton?: ClassValue }
	minLengthToSearch?: number
	readonly onClear?: (event: React.MouseEvent<HTMLButtonElement>) => unknown
}

export function SearchTextInput({ color, size, classNames, disabled, readOnly, placeholder = 'Search', minLengthToSearch = 3, startContent, value, onValueChange, onClear, ...props }: SearchInputProps) {
	const styles = searchTextInputStyles({ color, size })

	function handleValueChange(value: string) {
		if (value.length === 0 || value.length >= minLengthToSearch) {
			onValueChange?.(value)
		}
	}

	// Reports close requests without letting the event bubble into the chip root.
	function handleClear(event: React.PointerEvent<HTMLButtonElement>) {
		event.stopPropagation()
		if (disabled || readOnly || onClear === undefined) return
		if (onClear(event) !== false) onValueChange?.('')
	}

	const ClearButton = onClear !== undefined && value !== undefined && value !== '' && (
		<button className={tw(styles.closeButton(), classNames?.clearButton)} onClick={stopPropagation} onPointerDown={handleClear} onPointerUp={stopPropagation} type="button">
			<Icons.Close />
		</button>
	)

	return <TextInput classNames={classNames} color={color} size={size} disabled={disabled} readOnly={readOnly} endContent={ClearButton} onValueChange={handleValueChange} placeholder={placeholder} fireOnEnter startContent={startContent ?? <Icons.Search />} value={value} {...props} />
}
