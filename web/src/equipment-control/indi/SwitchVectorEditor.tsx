import type { IndiSwitchProperty } from 'api'
import { useState } from 'react'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Select } from '../../ui/Select'
import { Actions, Readout } from '../parts'
import { indiView, writeIndiVector } from './indi'
import { labelOf } from './indi.format'
import { useAppliedWrite, useWriting } from './IndiWriteStatus'

// Editor of a switch vector, by its rule: AtMostOne is a row of action buttons that send at once (the active one
// marked, never turned off locally after sending) with an explicit Clear; OneOfMany is a select applied with
// Apply; AnyOfMany is a wrapping row of checkboxes applied with Apply, which sends every switch. A read-only
// vector shows which switches are on. The states shown are always those the driver reports.

export interface SwitchVectorEditorProps {
	// Vector edited.
	readonly vector: IndiSwitchProperty
}

// Switch vector editor.
export function SwitchVectorEditor({ vector }: SwitchVectorEditorProps) {
	const writing = useWriting(vector.name)

	if (vector.permission === 'ro') {
		return (
			<div className="flex flex-col gap-1">
				{vector.elementNames.map((name) => (
					<Readout key={name} label={labelOf(vector.elements[name])}>
						{vector.elements[name].value ? 'On' : 'Off'}
					</Readout>
				))}
			</div>
		)
	}

	if (vector.rule === 'AtMostOne') return <ActionSwitches vector={vector} writing={writing} />
	if (vector.rule === 'OneOfMany') return <SelectSwitches vector={vector} writing={writing} />
	return <CheckboxSwitches vector={vector} writing={writing} />
}

interface RuleEditorProps extends SwitchVectorEditorProps {
	// Whether a write of the vector is in flight.
	readonly writing: boolean
}

// Sends a selection of switches; switches left out are sent off.
function write(vector: IndiSwitchProperty, elements: Record<string, boolean>) {
	return writeIndiVector(indiView, vector.name, elements)
}

// Buttons of an AtMostOne vector: a click sends that switch on and the others off.
function ActionSwitches({ vector, writing }: RuleEditorProps) {
	const any = vector.elementNames.some((name) => vector.elements[name].value)

	return (
		<Actions>
			{vector.elementNames.map((name) => (
				<Button key={name} variant={vector.elements[name].value ? 'primary' : 'secondary'} title={`${name}: ${vector.elements[name].value ? 'on' : 'off'}`} disabled={writing} onClick={() => void write(vector, { [name]: true })}>
					{labelOf(vector.elements[name])}
				</Button>
			))}
			{any && (
				<Button variant="ghost" title="Turn every switch off" disabled={writing} onClick={() => void write(vector, {})}>
					Clear
				</Button>
			)}
		</Actions>
	)
}

// Select of a OneOfMany vector, applied with Apply.
function SelectSwitches({ vector, writing }: RuleEditorProps) {
	const reported = vector.elementNames.find((name) => vector.elements[name].value)
	const [selected, setSelected] = useState<string>()
	const applied = useAppliedWrite(vector.name, setSelected)
	const value = selected ?? reported ?? vector.elementNames[0]

	return (
		<div className="flex flex-wrap items-end gap-2">
			<Select className="min-w-48 flex-1" options={vector.elementNames} value={value} format={(name) => (labelOf(vector.elements[name]) === name ? name : `${labelOf(vector.elements[name])} (${name})`)} onChange={setSelected} />
			<Button disabled={selected === undefined || selected === reported || writing} onClick={() => void write(vector, { [value]: true }).then(applied)}>
				Apply
			</Button>
		</div>
	)
}

// Checkboxes of an AnyOfMany vector, applied with Apply, which sends every switch.
function CheckboxSwitches({ vector, writing }: RuleEditorProps) {
	const [draft, setDraft] = useState<Readonly<Record<string, boolean>>>()
	const applied = useAppliedWrite(vector.name, setDraft)
	const checked = (name: string) => draft?.[name] ?? vector.elements[name].value

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap gap-x-4 gap-y-1">
				{vector.elementNames.map((name) => (
					<Checkbox key={name} label={labelOf(vector.elements[name])} checked={checked(name)} onChange={(value) => setDraft({ ...draft, [name]: value })} />
				))}
			</div>
			<Actions>
				<Button disabled={!draft || writing} onClick={() => void write(vector, Object.fromEntries(vector.elementNames.map((name) => [name, checked(name)]))).then(applied)}>
					Apply
				</Button>
				<Button variant="secondary" disabled={!draft} onClick={() => setDraft(undefined)}>
					Reset
				</Button>
			</Actions>
		</div>
	)
}
