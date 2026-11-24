import { cn } from 'cn'
import { type ChangeEvent, type ComponentProps, type CSSProperties, type MouseEvent, type Ref, useId, useRef, useState } from 'react'
import { Field, InputSuffix, inputClassName, suffixPadding } from './Field'
import { Icon } from './Icon'

// Text field with its label above it, the label tied to the input so the field is named by it and a click on the label
// focuses it. A free-text field holding text offers a clear button at its right end while hovered or focused.

// Input types whose content is free text, the only ones a clear button empties; a date, time or password field never shows it.
const CLEARABLE_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'url', 'email', 'tel'])

// Width of the clear button and its gap to the content or suffix on its right, reserved at the right of a field that shows it.
const CLEAR_PADDING = '2rem'

export interface TextInputProps extends Omit<ComponentProps<'input'>, 'size'> {
	// Label shown above the field and naming it.
	readonly label?: string
	// Unit drawn inside the right end of the field, such as "m" or "°"; shown as written, never uppercased.
	readonly suffix?: string
	// Whether a field of free text offers a button that empties it, shown while it holds text and is hovered or focused;
	// on by default, and ignored for a disabled or read-only field.
	readonly clearable?: boolean
}

// Labeled text field; without an id of its own it gets a generated one for its label.
export function TextInput({ id, label, suffix, clearable = true, className, type = 'text', style, autoCapitalize = 'off', spellCheck = false, ref, value, defaultValue, onChange, disabled, readOnly, ...props }: TextInputProps) {
	const generated = useId()
	const inputId = id ?? generated
	const inputRef = useRef<HTMLInputElement | null>(null)
	// Text of a field the caller leaves uncontrolled, followed so the clear button knows whether there is anything to clear.
	const [typed, setTyped] = useState(() => String(defaultValue ?? ''))
	const filled = (value === undefined ? typed : String(value)) !== ''
	const showClear = clearable && CLEARABLE_TYPES.has(type) && filled && !disabled && !readOnly
	const padding = showClear ? (suffix ? `calc(${suffixPadding(suffix)} + ${CLEAR_PADDING})` : CLEAR_PADDING) : suffix ? suffixPadding(suffix) : undefined
	const inputStyle: CSSProperties | undefined = padding ? { ...style, paddingRight: padding } : style

	// Hands the input to both the caller's ref and the one the clear button uses.
	function attach(input: HTMLInputElement | null) {
		inputRef.current = input
		assignRef(ref, input)
	}

	// Follows the text of an uncontrolled field before passing the change on.
	function handleChange(event: ChangeEvent<HTMLInputElement>) {
		setTyped(event.target.value)
		onChange?.(event)
	}

	// Keeps the focus in the field, so a press on the button neither blurs it nor closes what its focus opened.
	function keepFocus(event: MouseEvent<HTMLButtonElement>) {
		event.preventDefault()
	}

	// Empties the field as if the operator deleted its text, so the caller receives it through its change handler, and
	// focuses it for typing again.
	function clear() {
		const input = inputRef.current
		if (!input) return
		clearInput(input)
		input.focus()
	}

	return (
		<Field label={label} htmlFor={inputId} className={className}>
			<div className="group relative">
				<input
					ref={attach}
					id={inputId}
					type={type}
					className={cn(inputClassName, '[&::-webkit-search-cancel-button]:appearance-none')}
					style={inputStyle}
					autoCapitalize={autoCapitalize}
					spellCheck={spellCheck}
					value={value}
					defaultValue={defaultValue}
					onChange={handleChange}
					disabled={disabled}
					readOnly={readOnly}
					{...props}
					data-1p-ignore
				/>
				{showClear && (
					<button
						type="button"
						title="Clear"
						tabIndex={-1}
						onMouseDown={keepFocus}
						onClick={clear}
						style={suffix ? { right: `calc(${suffix.length}ch + 1rem)` } : undefined}
						className="invisible absolute top-1/2 right-1.5 z-2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-ink-300 transition-colors duration-150 group-focus-within:visible group-hover:visible hover:bg-base-300 hover:text-ink-100 motion-reduce:transition-none"
					>
						<Icon name="close" strokeWidth={1.8} className="size-4" />
					</button>
				)}
				{suffix && <InputSuffix>{suffix}</InputSuffix>}
			</div>
		</Field>
	)
}

// Points a ref given by the caller, either a callback or an object, at the input.
function assignRef(ref: Ref<HTMLInputElement> | undefined, input: HTMLInputElement | null) {
	if (typeof ref === 'function') ref(input)
	else if (ref) ref.current = input
}

// Empties an input through the native value setter and an input event, the path React follows to call the change
// handler of a controlled field, so the field's owner updates its state exactly as for typed text.
function clearInput(input: HTMLInputElement) {
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '')
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
