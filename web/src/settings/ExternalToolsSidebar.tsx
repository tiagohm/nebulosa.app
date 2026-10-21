import type { ExternalToolState } from 'api'
import { List, ListItem } from '../ui/List'
import { Select } from '../ui/Select'
import { CAPABILITY_LABELS } from './externaltools'
import { summaryOf } from './ExternalToolStatus'

// List of the external programs the server supports, with the state of each one. Wide screens show it
// as a sidebar; narrow ones show a select instead. Selecting a program only shows its settings: nothing
// is run, saved, or changed.

export interface ExternalToolListProps {
	// Supported programs.
	readonly tools: readonly ExternalToolState[]
	// Id of the program shown, if any.
	readonly selected?: string
	// Shows a program.
	readonly onSelect: (id: string) => void
}

// Capabilities of a program, as text.
function capabilitiesOf(tool: ExternalToolState) {
	return tool.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join(' · ')
}

// List of the programs, for wide screens.
export function ExternalToolsSidebar({ tools, selected, onSelect }: ExternalToolListProps) {
	return (
		<aside className="flex w-80 flex-none flex-col border-r border-line-100 bg-base-000">
			<List emptyText="No external tools." className="min-h-0 flex-1 overflow-y-auto p-2">
				{tools.map((tool) => {
					const summary = summaryOf(tool)
					return <ListItem key={tool.id} title={tool.name} description={capabilitiesOf(tool)} meta={<span className={summary.className}>{summary.label}</span>} selected={tool.id === selected} onClick={() => onSelect(tool.id)} />
				})}
			</List>
		</aside>
	)
}

// Select of the programs, for narrow screens.
export function ExternalToolsSelect({ tools, selected, onSelect }: ExternalToolListProps) {
	function format(id: string) {
		const tool = tools.find((t) => t.id === id)
		return tool ? `${tool.name} · ${summaryOf(tool).label}` : id
	}

	return (
		<div className="flex-none border-b border-line-100 p-3">
			<Select options={tools.map((tool) => tool.id)} value={selected ?? ''} format={format} onChange={onSelect} />
		</div>
	)
}
