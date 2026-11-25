import { showFraming } from '../tools/framing/framing'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/Select'
import { useResolvedFramings } from './resolve'

// Choice of a framing by the tools that apply one: the pseudo-framings of the Equipment Setup's Main Camera and Guide
// Camera first, then every framing of the Framing tool by name, with the way to open the one chosen there. A framing
// deleted elsewhere reads as the Main Camera's until another is chosen.

// Props of the select.
export interface FramingSelectProps {
	// Id of the framing chosen; absent or unknown reads as the Main Camera's of the Equipment Setup.
	readonly value?: string
	// Called with the id of the framing chosen.
	readonly onChange: (id: string) => void
	// Label of the field.
	readonly label?: string
	// Whether the select is disabled.
	readonly disabled?: boolean
}

// Select of a framing.
export function FramingSelect({ value, onChange, label = 'Framing', disabled = false }: FramingSelectProps) {
	const framings = useResolvedFramings()
	const selected = framings.find((framing) => framing.id === value) ?? framings[0]

	return (
		<div className="flex flex-wrap items-end gap-2">
			<Select label={label} className="min-w-48 flex-1" options={framings.map((framing) => framing.id)} value={selected.id} disabled={disabled} onChange={onChange} format={(id) => framings.find((framing) => framing.id === id)?.name ?? id} />
			<IconButton icon="edit" className="self-end" label="Open in Framing" onClick={() => showFraming(selected.id)} />
		</div>
	)
}
