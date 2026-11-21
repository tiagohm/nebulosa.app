import { type ComponentProps, useId } from 'react'
import { Field, InputSuffix, inputClassName, suffixPadding } from './Field'

// Text field with its label above it, the label tied to the input so the field is named by it and a click on the label
// focuses it.

export interface TextInputProps extends Omit<ComponentProps<'input'>, 'size'> {
	// Label shown above the field and naming it.
	readonly label?: string
	// Unit drawn inside the right end of the field, such as "m" or "°"; shown as written, never uppercased.
	readonly suffix?: string
}

// Labeled text field; without an id of its own it gets a generated one for its label.
export function TextInput({ id, label, suffix, className, type = 'text', style, autoCapitalize = 'off', spellCheck = false, ...props }: TextInputProps) {
	const generated = useId()
	const inputId = id ?? generated

	return (
		<Field label={label} htmlFor={inputId} className={className}>
			<div className="relative">
				<input id={inputId} type={type} className={inputClassName} style={suffix ? { ...style, paddingRight: suffixPadding(suffix) } : style} autoCapitalize={autoCapitalize} spellCheck={spellCheck} {...props} data-1p-ignore />
				{suffix && <InputSuffix>{suffix}</InputSuffix>}
			</div>
		</Field>
	)
}
