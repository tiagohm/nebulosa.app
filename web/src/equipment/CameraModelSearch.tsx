import type { CameraModel } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import cameraModels from '../../assets/cameras.json.gz' with { type: 'file' }
import { Notice } from '../ui/Notice'
import { TextInput } from '../ui/TextInput'
import { cameraModelDescription, loadCameraModels, searchCameraModels } from './cameramodels'

// Search of the camera model catalog (the cameras of the AstroBin equipment database), in the Equipment Catalog editor and
// the calculators that take a sensor: the catalog is loaded the first time the field is focused, and the models that
// match what is typed float in a list under the field, like the list of a select. Choosing one, by pointer or by the
// arrow keys and Enter, hands it to the caller, which fills its fields with it; Enter never submits the form. The list closes on Escape and when the field loses focus,
// which a press outside it does.

export interface CameraModelSearchProps {
	// Called with the model chosen.
	readonly onPick: (model: CameraModel) => void
	// Label of the field; "Fill From Model" when absent.
	readonly label?: string
}

// State of the catalog in this field.
type Catalog = { readonly state: 'idle' | 'loading' } | { readonly state: 'loaded'; readonly models: readonly CameraModel[] } | { readonly state: 'failed'; readonly error: string }

// Field that searches the camera model catalog, with the models that match in a floating list below it.
export function CameraModelSearch({ onPick, label = 'Fill From Model' }: CameraModelSearchProps) {
	const [query, setQuery] = useState('')
	const [catalog, setCatalog] = useState<Catalog>({ state: 'idle' })
	const [open, setOpen] = useState(false)
	const [active, setActive] = useState(0)
	const listRef = useRef<HTMLUListElement>(null)
	const searching = catalog.state === 'loaded' && catalog.models.length > 0 && query.trim() !== ''
	const found = searching ? searchCameraModels(catalog.models, query) : []
	const shown = open && searching

	function load() {
		if (catalog.state === 'loading' || catalog.state === 'loaded') return
		setCatalog({ state: 'loading' })
		loadCameraModels(cameraModels).then(
			(models) => setCatalog({ state: 'loaded', models }),
			(error: unknown) => setCatalog({ state: 'failed', error: error instanceof Error ? error.message : String(error) }),
		)
	}

	function pick(model: CameraModel | undefined) {
		if (!model) return
		setQuery('')
		setOpen(false)
		onPick(model)
	}

	function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter') {
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
					spellCheck={false}
					autoComplete="off"
					value={query}
					placeholder="Search cameras, such as ASI2600MM"
					onFocus={() => {
						load()
						setOpen(true)
					}}
					onBlur={() => setOpen(false)}
					onChange={(e) => {
						setQuery(e.target.value)
						setActive(0)
						setOpen(true)
					}}
					onKeyDown={handleKeyDown}
				/>
				{shown && (
					<ul ref={listRef} className="absolute inset-x-0 top-[calc(100%+4px)] z-20 m-0 box-border max-h-88 list-none overflow-y-auto overscroll-contain rounded-md border border-line-100 bg-base-200 p-1 text-sm leading-5 shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
						{found.length === 0 && <li className="px-2 py-2 text-ink-300">No camera model matches.</li>}
						{found.map((model, index) => (
							<li key={model.model} data-index={index} onMouseDown={(e) => e.preventDefault()} onMouseMove={() => active !== index && setActive(index)} onClick={() => pick(model)} className={cn('flex cursor-pointer flex-col rounded-sm px-2 py-2', index === active && 'bg-base-300')}>
								<span className={index === active ? 'text-accent' : 'text-ink-100'}>{model.model}</span>
								<span className="text-xs leading-4 text-ink-300">{cameraModelDescription(model)}</span>
							</li>
						))}
					</ul>
				)}
			</div>
			{catalog.state === 'failed' && <Notice error>{catalog.error}</Notice>}
			{catalog.state === 'loaded' && catalog.models.length === 0 && <Notice>The camera model catalog is empty; run bun make:cameras to download it.</Notice>}
		</div>
	)
}
