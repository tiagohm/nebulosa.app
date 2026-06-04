import { IconButton, type IconButtonProps } from './IconButton'

export interface ToggleButtonProps extends Omit<Partial<IconButtonProps>, 'variant'> {
	readonly value?: boolean
	readonly onValueChange?: (value: boolean) => void
	readonly offVariant?: IconButtonProps['variant']
	readonly onVariant?: IconButtonProps['variant']
	readonly offIcon?: IconButtonProps['icon']
	readonly onIcon?: IconButtonProps['icon']
}

// Renders an icon button with separate visual variants for off and on states.
export function ToggleButton({ value = false, onClick, onValueChange, offVariant = 'flat', onVariant = 'solid', offIcon, onIcon, icon, disabled = false, loading = false, readOnly = false, ...props }: ToggleButtonProps) {
	const blocked = disabled || loading || readOnly

	// Preserves caller pointer behavior while exposing a boolean toggle callback.
	function handleClick(event: React.MouseEvent<HTMLDivElement>) {
		onClick?.(event)

		if (!blocked && !event.defaultPrevented) {
			onValueChange?.(!value)
		}
	}

	return <IconButton {...props} disabled={disabled} loading={loading} icon={value ? (onIcon ?? icon!) : (offIcon ?? icon!)} onClick={handleClick} readOnly={readOnly} variant={value ? onVariant : offVariant} />
}
