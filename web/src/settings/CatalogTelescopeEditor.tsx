import type { CatalogTelescopeFields, TelescopeModel } from 'api'
import { useEffect, useMemo, useState } from 'react'
import { useSnapshot } from 'valtio'
import { type CatalogTelescope, catalogState, removeCatalogTelescope, saveCatalogTelescope } from '../equipment/catalog'
import { TelescopeModelSearch } from '../equipment/TelescopeModelSearch'
import { profilesUsingTelescope, telescopeUsage } from '../equipment/telescopes'
import { profileState } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { ConfirmButton } from '../ui/ConfirmButton'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { TextInput } from '../ui/TextInput'

// Editor of one telescope or lens of the Equipment Catalog: its name, model, serial number, notes, the aperture and native
// focal length it declares, and whether it is archived, edited as a local draft that only Save writes; the model and the
// optics can be filled from a model of the telescope model catalog (AstroBin). The Telescope and
// Guide Telescope of every profile that refers to it take the values it declares; deleting it leaves those profiles on
// the values last copied from it. Nothing here commands a device.

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

// Fields of a telescope being edited. An optics value of 0 is one not declared.
interface Draft {
	readonly name: string
	readonly model: string
	readonly serial: string
	readonly notes: string
	// Clear aperture, in millimeters; 0 when not declared.
	readonly aperture: number
	// Native focal length, in millimeters; 0 when not declared.
	readonly focalLength: number
	readonly archived: boolean
}

// Returns the draft of a telescope, or of a new one.
function draftOf(telescope: CatalogTelescopeFields | undefined): Draft {
	return {
		name: telescope?.name ?? '',
		model: telescope?.model ?? '',
		serial: telescope?.serial ?? '',
		notes: telescope?.notes ?? '',
		aperture: telescope?.aperture ?? 0,
		focalLength: telescope?.focalLength ?? 0,
		archived: telescope?.archived ?? false,
	}
}

// Whether two drafts hold the same values.
function sameDraft(a: Draft, b: Draft) {
	return (Object.keys(a) as (keyof Draft)[]).every((key) => a[key] === b[key])
}

// Returns the telescope a draft describes; an aperture or focal length of 0 is not declared.
function fieldsOf({ aperture, focalLength, ...draft }: Draft): CatalogTelescopeFields {
	return { name: draft.name, model: draft.model, serial: draft.serial, notes: draft.notes, ...(aperture > 0 && { aperture }), ...(focalLength > 0 && { focalLength }), archived: draft.archived }
}

// Editor of a telescope of the Equipment Catalog.
export function CatalogTelescopeEditor({ telescope, onDirtyChange, onSaved, onClosed }: CatalogTelescopeEditorProps) {
	const { profiles } = useSnapshot(profileState)
	const [base, setBase] = useState(() => draftOf(telescope))
	const [draft, setDraft] = useState(base)
	const [error, setError] = useState<string>()
	const dirty = !sameDraft(draft, base)
	const saved = useMemo(() => draftOf(telescope), [telescope])
	const used = telescope ? profilesUsingTelescope(profiles, telescope.id) : 0

	// Follows a telescope saved elsewhere while the draft is unchanged, or already has its values.
	if (telescope && !sameDraft(saved, base) && (!dirty || sameDraft(draft, saved))) {
		setBase(saved)
		setDraft(saved)
	}

	useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

	function edit(patch: Partial<Draft>) {
		setDraft({ ...draft, ...patch })
		setError(undefined)
	}

	// Fills the model and the optics from a model of the telescope model catalog, and the name of a telescope that has none;
	// a value the model does not declare keeps the one typed.
	function fillFrom(model: TelescopeModel) {
		edit({ name: draft.name.trim() ? draft.name : model.model, model: model.model, aperture: model.aperture ?? draft.aperture, focalLength: model.focalLength ?? draft.focalLength })
	}

	function save() {
		const result = saveCatalogTelescope(catalogState, fieldsOf(draft), telescope?.id)

		if (!result.ok) {
			setError(result.reason === 'name' ? 'Enter a name.' : result.reason === 'nameTaken' ? 'Another telescope of the catalog has this name.' : 'Enter a positive aperture and focal length, or leave them at 0 when they are not declared.')
			return
		}

		const next = draftOf(result.telescope)
		setBase(next)
		setDraft(next)
		onSaved(result.telescope)
	}

	function cancel() {
		setDraft(base)
		setError(undefined)
		if (!telescope) onClosed()
	}

	function remove() {
		if (!telescope) return
		removeCatalogTelescope(catalogState, telescope.id)
		onClosed()
	}

	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-100 px-4 py-3">
				<div className="flex min-w-0 flex-1 basis-60 flex-col">
					<h2 className="m-0 truncate leading-6 font-medium text-ink-100">{telescope ? telescope.name : 'New Telescope'}</h2>
					{telescope && <Notice>{telescopeUsage(used)} The Telescope and Guide Telescope of the Equipment Setup refer to it.</Notice>}
				</div>
			</header>
			<div className="flex min-w-0 flex-col lg:w-112">
				<PanelSection title="Telescope">
					<form
						className="flex flex-col gap-3"
						onSubmit={(e) => {
							e.preventDefault()
							save()
						}}
					>
						<TextInput label="Name" value={draft.name} placeholder="Esprit 100" onChange={(e) => edit({ name: e.target.value })} />
						<TextInput label="Model" value={draft.model} placeholder="Sky-Watcher Esprit 100ED" onChange={(e) => edit({ model: e.target.value })} />
						<TextInput label="Serial Number" spellCheck={false} autoComplete="off" value={draft.serial} onChange={(e) => edit({ serial: e.target.value })} />
						<TextInput label="Notes" value={draft.notes} onChange={(e) => edit({ notes: e.target.value })} />
						<Notice>The name tells telescopes apart in every list; the model, serial number, and notes are for people only and never compared.</Notice>
						<TelescopeModelSearch onPick={fillFrom} />
						<Notice>AstroBin lists a zoom, or a telescope with its reducer or extender, as a range of focal lengths: such a model fills the shortest; check it.</Notice>
						<div className="grid grid-cols-2 gap-3">
							<NumberInput label="Aperture" suffix="mm" min={0} step={1} value={draft.aperture} onChange={(aperture) => edit({ aperture })} />
							<NumberInput label="Focal Length" suffix="mm" min={0} step={1} value={draft.focalLength} onChange={(focalLength) => edit({ focalLength })} />
						</div>
						<Notice>The native focal length, without reducer or Barlow, which each profile applies; 0 leaves a value undeclared, and the profile's own value is used instead.</Notice>
						<Checkbox label="Archived" checked={draft.archived} onChange={(archived) => edit({ archived })} />
						<Notice>An archived telescope is no longer offered to the Equipment Setup and the calculators; the profiles that use it keep it.</Notice>
						{error && <Notice error>{error}</Notice>}
						<Actions>
							<Button type="submit" disabled={telescope !== undefined && !dirty}>
								{telescope ? 'Save' : 'Add Telescope'}
							</Button>
							<Button variant="secondary" disabled={telescope !== undefined && !dirty} onClick={cancel}>
								Cancel
							</Button>
						</Actions>
					</form>
				</PanelSection>
				{telescope && (
					<PanelSection title="Delete">
						<Notice>{used > 0 ? 'The profiles that use this telescope keep the aperture and focal length last copied from it.' : 'No profile uses this telescope, and nothing is recorded against it.'}</Notice>
						<Actions>
							<ConfirmButton title={`Delete ${telescope.name}?`} message="This cannot be undone." confirmLabel="Delete Telescope" onConfirm={remove}>
								Delete Telescope
							</ConfirmButton>
						</Actions>
					</PanelSection>
				)}
			</div>
		</div>
	)
}
