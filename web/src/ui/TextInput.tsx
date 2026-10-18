import type { ComponentProps } from 'react'
import { Field, InputSuffix, inputClassName, suffixPadding } from './Field'

export interface TextInputProps extends Omit<ComponentProps<'input'>, 'size'> {
	readonly label?: string
	// Unit drawn inside the right end of the field, such as "m" or "°"; shown as written, never uppercased.
	readonly suffix?: string
}

export function TextInput({ id, label, suffix, className, type = 'text', style, ...props }: TextInputProps) {
	return (
		<Field label={label} className={className}>
			<div className="relative">
				<input type={type} className={inputClassName} style={suffix ? { ...style, paddingRight: suffixPadding(suffix) } : style} {...props} data-1p-ignore />
				{suffix && <InputSuffix>{suffix}</InputSuffix>}
			</div>
		</Field>
	)
}
