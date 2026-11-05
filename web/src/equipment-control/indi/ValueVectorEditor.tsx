import { useState } from 'react'
import { MISSING } from '../../format'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { TextInput } from '../../ui/TextInput'
import { indiView, writeIndiVector } from './indi'
import { changedOnDevice, draftElements, editDraft, type IndiValueProperty, reportedTexts, type ValueDraft } from './indi.draft'
import { labelOf, numberText, rangeText } from './indi.format'
import { useAppliedWrite, useWriting } from './IndiWriteStatus'

// Editor of a text or number vector: one field per element, holding what the user types until Apply sends the
// edited elements, or Reset drops them. A number is typed in decimal or sexagesimal, in the driver's units, and
// is never rounded while typing. The fields of a write-only vector start empty, since the driver never reports
// their values, and must all be filled. A read-only vector shows its values.

export interface ValueVectorEditorProps {
	// Vector edited.
	readonly vector: IndiValueProperty
}

// Text or number vector editor.
export function ValueVectorEditor({ vector }: ValueVectorEditorProps) {
	const [draft, setDraft] = useState<ValueDraft>()
	const applied = useAppliedWrite(vector.name, setDraft)
	const writing = useWriting(vector.name)
	const reported = reportedTexts(vector)

	if (vector.permission === 'ro') {
		return (
			<div className="flex flex-col gap-1">
				{vector.elementNames.map((name) => (
					<DataRow key={name} label={labelOf(vector.elements[name])}>
						{vector.type === 'NUMBER' ? numberText(vector.elements[name]) : vector.elements[name].value || MISSING}
					</DataRow>
				))}
			</div>
		)
	}

	const result = draft && draftElements(vector, draft)
	const error = result && 'error' in result ? result.error : undefined

	async function apply() {
		if (!result || !('elements' in result)) return
		await writeIndiVector(indiView, vector.name, result.elements)
		applied()
	}

	return (
		<div className="flex flex-col gap-2">
			{vector.elementNames.map((name) => {
				const element = vector.elements[name]
				const range = vector.type === 'NUMBER' ? rangeText(vector.elements[name]) : undefined

				return (
					<div key={name} className="flex flex-col gap-0.5">
						<TextInput label={labelOf(element)} title={name} value={draft?.values[name] ?? reported[name]} placeholder={vector.permission === 'wo' ? 'Not reported' : undefined} autoComplete="off" onChange={(event) => setDraft(editDraft(draft, reported, name, event.target.value))} />
						{range && <Notice>{range}</Notice>}
					</div>
				)
			})}
			{draft && changedOnDevice(draft, reported) && <Notice>The device changed an edited value since you started editing.</Notice>}
			{error && <Notice error>{error}</Notice>}
			<Actions>
				<Button disabled={!result || !!error || writing} onClick={() => void apply()}>
					Apply
				</Button>
				<Button variant="secondary" disabled={!draft} onClick={() => setDraft(undefined)}>
					Reset
				</Button>
			</Actions>
		</div>
	)
}
