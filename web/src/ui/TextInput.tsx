import type { ComponentProps } from 'react'
import { Field, inputClassName } from './Field'

export interface TextInputProps extends Omit<ComponentProps<'input'>, 'size'> {
	readonly label?: string
}

export function TextInput({ id, label, className, type = 'text', ...props }: TextInputProps) {
	return (
		<Field label={label} className={className}>
			<input type={type} className={inputClassName} {...props} />
		</Field>
	)
}
