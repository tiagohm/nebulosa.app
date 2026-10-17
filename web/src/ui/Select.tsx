import { cn } from 'cn'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Field, inputClassName } from './Field'

export interface SelectProps<T extends string> {
	readonly label?: string
	readonly options: readonly T[]
	readonly value: T
	readonly onChange: (value: T) => void
	readonly className?: string
	// Display text of an option; the option itself when absent.
	readonly format?: (value: T) => string
	// Why an option cannot be chosen, shown under it; undefined for an available option.
	readonly disabledReason?: (value: T) => string | undefined
	// Whether the whole control is disabled.
	readonly disabled?: boolean
}

// Select-only combobox (WAI-ARIA) with a custom listbox, so the open list matches the theme.
export function Select<T extends string>({ label, options, value, onChange, className, format = String, disabledReason, disabled = false }: SelectProps<T>) {
	const [open, setOpen] = useState(false)
	const [active, setActive] = useState(-1)
	const [up, setUp] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const listRef = useRef<HTMLUListElement>(null)
	const typed = useRef({ text: '', time: 0 })
	const selectedIndex = options.indexOf(value)

	function openList(at: number = Math.max(0, selectedIndex)) {
		const rect = triggerRef.current?.getBoundingClientRect()

		if (rect) {
			const below = window.innerHeight - rect.bottom
			setUp(below < 280 && rect.top > below)
		}

		setActive(at)
		setOpen(true)
	}

	function close(refocus: boolean) {
		setOpen(false)
		if (refocus) triggerRef.current?.focus()
	}

	function choose(index: number) {
		const option = options[index]
		if (option === undefined || disabledReason?.(option)) return
		if (option !== value) onChange(option)
		close(true)
	}

	function typeAhead(key: string) {
		const now = Date.now()
		const state = typed.current
		state.text = (now - state.time > 600 ? '' : state.text) + key.toLowerCase()
		state.time = now

		const from = open ? active : selectedIndex
		const offset = state.text.length > 1 ? 0 : 1

		for (let k = 0; k < options.length; k++) {
			const index = (((from + offset + k) % options.length) + options.length) % options.length

			const option = options[index]

			if (option !== undefined && format(option).toLowerCase().startsWith(state.text)) {
				if (open) setActive(index)
				else choose(index)
				return
			}
		}
	}

	function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
		const { key } = e
		const printable = key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey

		if (!open) {
			if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
				e.preventDefault()
				openList()
			} else if (key === 'Home' || key === 'End') {
				e.preventDefault()
				openList(key === 'Home' ? 0 : options.length - 1)
			} else if (printable) {
				typeAhead(key)
			}

			return
		}

		if (key === 'ArrowDown') {
			e.preventDefault()
			setActive(Math.min(active + 1, options.length - 1))
		} else if (key === 'ArrowUp') {
			e.preventDefault()
			if (e.altKey) choose(active)
			else setActive(Math.max(active - 1, 0))
		} else if (key === 'Home') {
			e.preventDefault()
			setActive(0)
		} else if (key === 'End') {
			e.preventDefault()
			setActive(options.length - 1)
		} else if (key === 'Enter' || key === ' ') {
			e.preventDefault()
			choose(active)
		} else if (key === 'Escape') {
			// Also keeps an enclosing dialog from closing.
			e.preventDefault()
			close(true)
		} else if (key === 'Tab') {
			if (active >= 0 && active !== selectedIndex) choose(active)
			setOpen(false)
		} else if (printable) {
			typeAhead(key)
		}
	}

	useEffect(() => {
		if (!open) return

		function handlePointerDown(e: MouseEvent) {
			if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false)
		}

		document.addEventListener('mousedown', handlePointerDown)
		return () => document.removeEventListener('mousedown', handlePointerDown)
	}, [open])

	useEffect(() => {
		if (open && active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
	}, [open, active])

	return (
		<Field label={label} className={className}>
			<div ref={rootRef} className="relative">
				<button
					ref={triggerRef}
					type="button"
					role="combobox"
					disabled={disabled}
					onClick={() => (open ? close(false) : openList())}
					onKeyDown={handleKeyDown}
					className={cn(inputClassName, 'flex cursor-pointer items-center gap-2 pr-9 text-left select-none', open && 'border-accent outline-2 -outline-offset-1 outline-accent')}
				>
					<span className="min-w-0 flex-1 truncate">{format(value)}</span>
					<span className={cn('pointer-events-none absolute top-1/2 right-3.5 size-[7px] rotate-45 border-r-[1.5px] border-b-[1.5px] border-ink-200 transition-[rotate,margin-top] duration-150', open ? '-mt-0.5 -rotate-135 border-accent' : '-mt-1.5')} />
				</button>
				<ul
					ref={listRef}
					role="listbox"
					tabIndex={-1}
					hidden={!open}
					className={cn('absolute inset-x-0 z-20 m-0 box-border max-h-88 list-none overflow-y-auto overscroll-contain rounded-md border border-line-100 bg-base-200 p-1 text-sm leading-5 shadow-[0_12px_32px_rgb(0_0_0/0.45)]', up ? 'bottom-[calc(100%+4px)]' : 'top-[calc(100%+4px)]')}
				>
					{options.map((option, index) => {
						const reason = disabledReason?.(option)

						return (
							<li
								key={option}
								role="option"
								onMouseDown={(e) => e.preventDefault()}
								onMouseMove={() => active !== index && setActive(index)}
								onClick={() => choose(index)}
								className={cn('flex items-start gap-2 rounded-sm py-2 pr-3 pl-2', reason ? 'cursor-not-allowed text-ink-300' : 'cursor-pointer', index === active && 'bg-base-300', !reason && (index === selectedIndex ? 'text-accent' : 'text-ink-100'))}
							>
								<span className={cn('relative h-5 flex-[0_0_16px]', index === selectedIndex && "after:absolute after:top-1 after:left-[5px] after:h-3 after:w-1 after:rotate-45 after:border-r-2 after:border-b-2 after:border-accent after:content-['']")} />
								<span className="flex min-w-0 flex-col">
									<span>{format(option)}</span>
									{reason && <span className="text-xs leading-4">{reason}</span>}
								</span>
							</li>
						)
					})}
				</ul>
			</div>
		</Field>
	)
}
