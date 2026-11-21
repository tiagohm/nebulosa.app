import { cn } from 'cn'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Notice } from '../ui/Notice'
import { TextInput } from '../ui/TextInput'

// Search of a model catalog bundled with the web client (the cameras or the telescopes of the AstroBin equipment
// database), in the Equipment Catalog editor and the calculators: the catalog is loaded the first time the field is
// focused, and the models that match what is typed float in a list under the field, like the list of a select. Choosing
// one, by pointer or by the arrow keys and Enter, hands it to the caller, which fills its fields with it. The list closes
// on Escape and when the field loses focus, which a press outside it does.
// The field is a search of its own, cleared once a model is chosen and whose Enter never submits the form, or, given a
// value, the field that edits that value: what is typed is the value, the list opens only while typing or on the arrow
// keys and only with models that match, so any text may be kept, and Enter submits the form while the list is closed.

export interface ModelSearchProps<T extends { readonly model: string }> {
	// Label of the field.
	readonly label: string
	// Placeholder of the field, such as an example to search.
	readonly placeholder: string
	// Loads the models of the catalog; called the first time the field is focused, and again after a failure.
	readonly load: () => Promise<readonly T[]>
	// Returns the models that match a query, in display order.
	readonly search: (models: readonly T[], query: string) => readonly T[]
	// Returns what a model declares, shown under its name.
	readonly describe: (model: T) => string
	// Text of the list when no model matches.
	readonly noMatch: string
	// Notice shown when the catalog loaded is empty, which says how to download it.
	readonly empty: string
	// Called with the model chosen.
	readonly onPick: (model: T) => void
	// Value the field edits, such as the model of a camera; absent for a search of its own.
	readonly value?: string
	// Called with the text typed, when the field edits a value.
	readonly onValueChange?: (value: string) => void
}

// State of the catalog in a field.
type Catalog<T> = { readonly state: 'idle' | 'loading' } | { readonly state: 'loaded'; readonly models: readonly T[] } | { readonly state: 'failed'; readonly error: string }

// Field that searches a model catalog, with the models that match in a floating list below it.
export function ModelSearch<T extends { readonly model: string }>({ label, placeholder, load, search, describe, noMatch, empty, onPick, value, onValueChange }: ModelSearchProps<T>) {
	const [typed, setTyped] = useState('')
	const editing = value !== undefined
	const query = editing ? value : typed
	const [catalog, setCatalog] = useState<Catalog<T>>({ state: 'idle' })
	const [open, setOpen] = useState(false)
	const [active, setActive] = useState(0)
	const listRef = useRef<HTMLUListElement>(null)
	const searching = catalog.state === 'loaded' && catalog.models.length > 0 && query.trim() !== ''
	const found = searching ? search(catalog.models, query) : []
	const shown = open && searching && (!editing || found.length > 0)

	function start() {
		if (catalog.state === 'loading' || catalog.state === 'loaded') return
		setCatalog({ state: 'loading' })
		load().then(
			(models) => setCatalog({ state: 'loaded', models }),
			(error: unknown) => setCatalog({ state: 'failed', error: error instanceof Error ? error.message : String(error) }),
		)
	}

	function pick(model: T | undefined) {
		if (!model) return
		if (!editing) setTyped('')
		setOpen(false)
		onPick(model)
	}

	function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter') {
			if (!shown && editing) return
			e.preventDefault()
			if (shown) pick(found[active])
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault()
			if (!shown) setOpen(true)
			else setActive(e.key === 'ArrowDown' ? Math.min(active + 1, found.length - 1) : Math.max(active - 1, 0))
		} else if (e.key === 'Escape' && shown) {
			// Also keeps an enclosing dialog from closing.
			e.preventDefault()
			setOpen(false)
		}
	}

	useEffect(() => {
		if (shown) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
	}, [shown, active])

	return (
		<div className="flex flex-col gap-2">
			<div className="relative">
				<TextInput
					label={label}
					autoComplete="off"
					value={query}
					placeholder={placeholder}
					onFocus={() => {
						start()
						if (!editing) setOpen(true)
					}}
					onBlur={() => setOpen(false)}
					onChange={(e) => {
						if (editing) onValueChange?.(e.target.value)
						else setTyped(e.target.value)
						setActive(0)
						setOpen(true)
					}}
					onKeyDown={handleKeyDown}
				/>
				{shown && (
					<ul ref={listRef} className="absolute inset-x-0 top-[calc(100%+4px)] z-20 m-0 box-border max-h-88 list-none overflow-y-auto overscroll-contain rounded-md border border-line-100 bg-base-200 p-1 text-sm leading-5 shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
						{found.length === 0 && <li className="px-2 py-2 text-ink-300">{noMatch}</li>}
						{found.map((model, index) => (
							<li key={model.model} data-index={index} onMouseDown={(e) => e.preventDefault()} onMouseMove={() => active !== index && setActive(index)} onClick={() => pick(model)} className={cn('flex cursor-pointer flex-col rounded-sm px-2 py-2', index === active && 'bg-base-300')}>
								<span className={index === active ? 'text-accent' : 'text-ink-100'}>{model.model}</span>
								<span className="text-xs leading-4 text-ink-300">{describe(model)}</span>
							</li>
						))}
					</ul>
				)}
			</div>
			{catalog.state === 'failed' && <Notice error>{catalog.error}</Notice>}
			{catalog.state === 'loaded' && catalog.models.length === 0 && <Notice>{empty}</Notice>}
		</div>
	)
}
