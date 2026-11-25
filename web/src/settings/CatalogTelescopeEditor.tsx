import type { CatalogTelescopeFields, TelescopeModel } from 'api'
import { useEffect, useMemo, useState } from 'react'
import { useSnapshot } from 'valtio'
import { type CatalogTelescope, catalogState, removeCatalogTelescope, saveCatalogTelescope } from '../equipment/catalog'
import { TelescopeModelSearch } from '../equipment/TelescopeModelSearch'
import { telescopeUsage } from '../equipment/telescopes'
import { formatFocalRatio, formatMillimeters } from '../format'
import { profileState } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataList, DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { StatusBadge } from '../ui/StatusBadge'
import { TextInput } from '../ui/TextInput'

// Editor of one telescope or lens of the Equipment Catalog: its name, model, serial number, notes, the aperture and native
// focal length it declares, and whether it is archived, edited as a local draft that only Save writes. Each field names
// its own problem, and Save stays disabled, saying why, while one remains; an optics value left blank is not declared.
// The Model field also searches the telescope model catalog (AstroBin), and a model chosen there fills the optics. Beside
// the form, a saved telescope shows its focal ratio and the profiles whose Telescope or Guide Telescope refer to it, which
// take the values it declares; deleting it leaves those profiles on the values last copied from it. Nothing here
// commands a device.

export interface CatalogTelescopeEditorProps {
	// Telescope edited; absent while a new one is created.
	readonly telescope?: CatalogTelescope
	// Reports whether the draft differs from what was saved.
	readonly onDirtyChange: (dirty: boolean) => void
	// Called with the telescope once saved.
	readonly onSaved: (telescope: CatalogTelescope) => void
	// Called when a new telescope is abandoned or a telescope is deleted.
	readonly onClosed: () => void
}

// Fields of a telescope being edited, as typed. An optics value left blank is one not declared.
interface Draft {
	readonly name: string
	readonly model: string
	readonly serial: string
	readonly notes: string
	// Clear aperture, in millimeters, as typed.
	readonly aperture: string
	// Native focal length, in millimeters, as typed.
	readonly focalLength: string
	readonly archived: boolean
}

// Fields of a draft that can hold a problem.
type CheckedField = 'name' | 'aperture' | 'focalLength'

// Problem of each field of a draft, in words; absent for a field that can be saved.
type Problems = Partial<Record<CheckedField, string>>

// Fields in form order, which is the order their problems are named in.
const CHECKED_FIELDS: readonly CheckedField[] = ['name', 'aperture', 'focalLength']

// Placeholder of an optics field left blank.
const UNDECLARED = 'Not declared'

// Role of the Equipment Setup that refers to a telescope, in the words the profiles list uses.
type TelescopeRole = 'Main Telescope' | 'Guide Telescope' | 'Main Telescope and Guide Telescope'

// Returns the text of an optional number of a field: empty when absent.
function numberText(value: number | undefined) {
	return value === undefined ? '' : `${value}`
}

// Returns the number typed in a field, a comma read as the decimal dot: undefined when blank, NaN when it is not one.
function typedNumber(text: string) {
	const trimmed = text.trim().replace(',', '.')
	return trimmed === '' ? undefined : Number(trimmed)
}

// Returns the draft of a telescope, or of a new one.
function draftOf(telescope: CatalogTelescopeFields | undefined): Draft {
	return {
		name: telescope?.name ?? '',
		model: telescope?.model ?? '',
		serial: telescope?.serial ?? '',
		notes: telescope?.notes ?? '',
		aperture: numberText(telescope?.aperture),
		focalLength: numberText(telescope?.focalLength),
		archived: telescope?.archived ?? false,
	}
}

// Whether two drafts hold the same values.
function sameDraft(a: Draft, b: Draft) {
	return (Object.keys(a) as (keyof Draft)[]).every((key) => a[key] === b[key])
}

// Returns the problems of the fields of a draft, against the other telescopes of the catalog (by name, without regard to
// case); empty when it can be saved.
function problemsOf(draft: Draft, telescopes: readonly Pick<CatalogTelescope, 'id' | 'name'>[], id: string | undefined): Problems {
	const problems: { -readonly [K in CheckedField]?: string } = {}
	const name = draft.name.trim().toLowerCase()
	if (!name) problems.name = 'Enter a name.'
	else if (telescopes.some((telescope) => telescope.id !== id && telescope.name.toLowerCase() === name)) problems.name = 'Another telescope of the catalog has this name.'

	for (const field of ['aperture', 'focalLength'] as const) {
		const value = typedNumber(draft[field])
		if (value !== undefined && !(Number.isFinite(value) && value > 0)) problems[field] = 'A length in millimeters above 0.'
	}

	return problems
}

// Returns the telescope a draft without problems describes; an aperture or focal length left blank is not declared.
function fieldsOf(draft: Draft): CatalogTelescopeFields {
	const aperture = typedNumber(draft.aperture)
	const focalLength = typedNumber(draft.focalLength)
	return { name: draft.name, model: draft.model, serial: draft.serial, notes: draft.notes, ...(aperture !== undefined && { aperture }), ...(focalLength !== undefined && { focalLength }), archived: draft.archived }
}

// Returns the confirmation of the deletion of a telescope a number of profiles use.
function deleteMessage(used: number) {
	const who = used === 0 ? 'No profile uses it.' : used === 1 ? 'The profile that uses it keeps the aperture and focal length last copied from it.' : `The ${used} profiles that use it keep the aperture and focal length last copied from it.`
	return `${who} This cannot be undone.`
}

// Editor of a telescope of the Equipment Catalog.
export function CatalogTelescopeEditor({ telescope, onDirtyChange, onSaved, onClosed }: CatalogTelescopeEditorProps) {
	const { profiles } = useSnapshot(profileState)
	const { telescopes } = useSnapshot(catalogState)
	const [base, setBase] = useState(() => draftOf(telescope))
	const [draft, setDraft] = useState(base)
	// Whether the telescope was just saved, until the next edit.
	const [justSaved, setJustSaved] = useState(false)
	// Whether a zoom model of the AstroBin catalog filled the optics of this draft with its shortest focal length.
	const [pickedRange, setPickedRange] = useState(false)
	const dirty = !sameDraft(draft, base)
	const saved = useMemo(() => draftOf(telescope), [telescope])

	// Follows a telescope saved elsewhere while the draft is unchanged, or already has its values.
	if (telescope && !sameDraft(saved, base) && (!dirty || sameDraft(draft, saved))) {
		setBase(saved)
		setDraft(saved)
	}

	useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
	// An editor that goes away, such as one whose record another tab deleted, leaves no unsaved changes behind.
	useEffect(() => () => onDirtyChange(false), [onDirtyChange])

	// Profiles whose Main Telescope or Guide Telescope refer to this telescope, with the role that does.
	const users = telescope
		? profiles.flatMap(({ id, name, settings }) => {
				const main = settings.mainTelescope?.telescopeId === telescope.id
				const guide = settings.guideTelescope?.telescopeId === telescope.id
				const role: TelescopeRole | undefined = main && guide ? 'Main Telescope and Guide Telescope' : main ? 'Main Telescope' : guide ? 'Guide Telescope' : undefined
				return role ? [{ id, name, role }] : []
			})
		: []
	const problems = problemsOf(draft, telescopes, telescope?.id)
	const firstProblem = CHECKED_FIELDS.map((field) => problems[field]).find((problem) => problem !== undefined)
	// Problem shown under a field: only once its text differs from the saved one, so an empty new form is not all errors.
	const shown = (field: CheckedField) => (draft[field] !== base[field] ? problems[field] : undefined)
	const saveBlocked = firstProblem ?? (telescope && !dirty ? 'No changes to save' : undefined)

	function edit(patch: Partial<Draft>) {
		setDraft({ ...draft, ...patch })
		setJustSaved(false)
	}

	// Fills the model and the optics from a model of the telescope model catalog, and the name of a telescope that has none;
	// a value the model does not declare keeps the one typed.
	function fillFrom(model: TelescopeModel) {
		edit({ name: draft.name.trim() ? draft.name : model.model, model: model.model, aperture: model.aperture === undefined ? draft.aperture : numberText(model.aperture), focalLength: model.focalLength === undefined ? draft.focalLength : numberText(model.focalLength) })
		setPickedRange(model.maxFocalLength !== undefined)
	}

	function save() {
		if (saveBlocked) return
		const result = saveCatalogTelescope(catalogState, fieldsOf(draft), telescope?.id)
		if (!result.ok) return
		const next = draftOf(result.telescope)
		setBase(next)
		setDraft(next)
		setPickedRange(false)
		setJustSaved(true)
		onSaved(result.telescope)
	}

	function cancel() {
		setDraft(base)
		setPickedRange(false)
		if (!telescope) onClosed()
	}

	function remove() {
		if (!telescope) return
		removeCatalogTelescope(catalogState, telescope.id)
		onClosed()
	}

	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<header className="z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-100 bg-base-100 px-4 py-3 sm:sticky sm:top-0">
				<div className="flex min-w-0 flex-1 basis-60 flex-col">
					<h2 className="m-0 truncate leading-6 font-medium text-ink-100" title={telescope?.name}>
						{telescope ? telescope.name : 'New Telescope'}
					</h2>
					{telescope && <Notice>{telescopeUsage(users.length)}</Notice>}
				</div>
				{telescope?.archived && <StatusBadge tone="muted" label="Archived" title="No longer offered to the Equipment Setup and the calculators" />}
			</header>
			<div className="grid lg:grid-cols-[24rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
				<form
					className="flex min-w-0 flex-col lg:col-start-1 lg:row-start-1"
					onSubmit={(e) => {
						e.preventDefault()
						save()
					}}
				>
					<PanelSection title="Identity">
						<div className="flex flex-col gap-1">
							<TextInput label="Name" value={draft.name} placeholder="Esprit 100" onChange={(e) => edit({ name: e.target.value })} />
							{shown('name') && <Notice error>{shown('name')}</Notice>}
						</div>
						<TelescopeModelSearch label="Model" placeholder="Search AstroBin…" value={draft.model} onValueChange={(model) => edit({ model })} onPick={fillFrom} />
						<TextInput label="Serial Number" value={draft.serial} onChange={(e) => edit({ serial: e.target.value })} />
						<TextInput label="Notes" value={draft.notes} onChange={(e) => edit({ notes: e.target.value })} />
						<Notice>Only the name tells telescopes apart; the model, serial number, and notes are never compared.</Notice>
					</PanelSection>
					<PanelSection title="Optics">
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="flex flex-col gap-1">
								<TextInput label="Aperture" suffix="mm" inputMode="decimal" placeholder={UNDECLARED} value={draft.aperture} onChange={(e) => edit({ aperture: e.target.value })} />
								{shown('aperture') && <Notice error>{shown('aperture')}</Notice>}
							</div>
							<div className="flex flex-col gap-1">
								<TextInput label="Focal Length" suffix="mm" inputMode="decimal" placeholder={UNDECLARED} value={draft.focalLength} onChange={(e) => edit({ focalLength: e.target.value })} />
								{shown('focalLength') && <Notice error>{shown('focalLength')}</Notice>}
							</div>
						</div>
						{pickedRange && <Notice warning>AstroBin lists this model as a range of focal lengths, a zoom or a telescope with its reducer or extender: the shortest was filled. Check it.</Notice>}
						<Notice>Native, without the reducer or Barlow each profile applies. Leave a value blank when it is not declared, and the profile's own value is used.</Notice>
					</PanelSection>
					<PanelSection title="Status">
						<Checkbox label="Archived" checked={draft.archived} onChange={(archived) => edit({ archived })} />
						<Notice>No longer offered to the Equipment Setup and the calculators; the profiles that use it keep it.</Notice>
					</PanelSection>
					<div className="px-4 py-3">
						<Actions>
							<Button type="submit" disabled={saveBlocked !== undefined} title={saveBlocked}>
								{telescope ? 'Save' : 'Add Telescope'}
							</Button>
							<Button variant="secondary" disabled={telescope !== undefined && !dirty} title={telescope !== undefined && !dirty ? 'No changes to cancel' : undefined} onClick={cancel}>
								Cancel
							</Button>
							{justSaved && <Notice>Saved.</Notice>}
						</Actions>
					</div>
				</form>
				{telescope && (
					<div className="min-w-0 border-t border-line-100 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-t-0 lg:border-l">
						<PanelSection title="Declared Optics">
							{telescope.aperture === undefined && telescope.focalLength === undefined ? (
								<Notice>No aperture or focal length is declared; the profiles that use it keep their own.</Notice>
							) : (
								<DataList>
									{telescope.aperture !== undefined && <DataRow label="Aperture">{formatMillimeters(telescope.aperture)}</DataRow>}
									{telescope.focalLength !== undefined && <DataRow label="Focal Length">{formatMillimeters(telescope.focalLength)}</DataRow>}
									{telescope.aperture !== undefined && telescope.focalLength !== undefined && <DataRow label="Focal Ratio">{formatFocalRatio(telescope.focalLength / telescope.aperture)}</DataRow>}
								</DataList>
							)}
						</PanelSection>
						<PanelSection title="Profiles">
							{users.length === 0 ? (
								<Notice>No profile uses this telescope. Choose it for the Telescope or Guide Telescope in the Equipment Setup.</Notice>
							) : (
								<DataList>
									{users.map((user) => (
										<DataRow key={user.id} label={user.name}>
											{user.role}
										</DataRow>
									))}
								</DataList>
							)}
						</PanelSection>
					</div>
				)}
				{telescope && (
					<div className="min-w-0 border-t border-line-100 lg:col-start-1 lg:row-start-2">
						<PanelSection title="Delete">
							<Notice>{users.length > 0 ? 'The profiles that use this telescope keep the aperture and focal length last copied from it.' : 'No profile uses this telescope, and nothing is recorded against it.'}</Notice>
							<Actions>
								<ConfirmButton destructive title={`Delete ${telescope.name}?`} message={deleteMessage(users.length)} confirmLabel="Delete Telescope" onConfirm={remove}>
									Delete Telescope
								</ConfirmButton>
							</Actions>
						</PanelSection>
					</div>
				)}
			</div>
		</div>
	)
}
