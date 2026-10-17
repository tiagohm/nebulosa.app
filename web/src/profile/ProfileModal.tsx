import { type SubmitEvent, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Button } from '../ui/Button'
import { List, ListItem } from '../ui/List'
import { Modal } from '../ui/Modal'
import { TextInput } from '../ui/TextInput'
import { createProfile, deleteProfile, duplicateProfile, profileState, renameProfile, selectProfile } from './profile'

// Modal that creates, renames, duplicates, deletes, and activates profiles, warning that profiles are
// shared by the tabs of the browser without synchronization.

// Profiles modal, shown while profileState.open is true. The form on the left creates a profile or
// renames the one being edited; the list on the right acts on the highlighted profile.
export function ProfileModal() {
	const { open, profiles, activeId, error } = useSnapshot(profileState)
	const [name, setName] = useState('')
	// Id of the profile loaded into the form by Rename.
	const [editing, setEditing] = useState<string>()
	// Id of the profile highlighted in the list; the active profile until another is clicked.
	const [highlighted, setHighlighted] = useState<string>()
	// Whether Delete is waiting for confirmation of the highlighted profile.
	const [confirming, setConfirming] = useState(false)
	const selected = profiles.find((p) => p.id === highlighted) ?? profiles.find((p) => p.id === activeId)

	// Clears the form and leaves rename mode.
	function reset() {
		setName('')
		setEditing(undefined)
	}

	// Highlights a profile, cancelling a pending delete confirmation.
	function highlight(id: string) {
		setHighlighted(id)
		setConfirming(false)
	}

	// Renames the edited profile, or creates and activates a new one, and clears the form on success.
	function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
		e.preventDefault()

		if (editing) {
			if (renameProfile(profileState, editing, name)) reset()
		} else {
			const profile = createProfile(profileState, name)

			if (profile) {
				selectProfile(profileState, profile.id)
				highlight(profile.id)
				reset()
			}
		}
	}

	// Loads the highlighted profile into the form for renaming.
	function handleRename() {
		if (!selected) return
		setName(selected.name)
		setEditing(selected.id)
	}

	// Adds a copy of the highlighted profile and highlights it.
	function handleDuplicate() {
		if (!selected) return
		const copy = duplicateProfile(profileState, selected.id)
		if (copy) highlight(copy.id)
	}

	// Asks for confirmation, then deletes the highlighted profile.
	function handleDelete() {
		if (!selected) return

		if (!confirming) {
			setConfirming(true)
			return
		}

		if (selected.id === editing) reset()
		deleteProfile(profileState, selected.id)
		highlight(profileState.activeId)
	}

	// Hides the modal, discarding the form and any pending confirmation.
	function handleClose() {
		profileState.open = false
		reset()
		setConfirming(false)
	}

	return (
		<Modal open={open} onClose={handleClose} title="Profiles" className="max-w-[760px]">
			<div className="flex flex-col gap-6">
				<div className="flex flex-wrap gap-6">
					<form onSubmit={handleSubmit} className="flex flex-[1_1_240px] flex-col gap-4 border-r border-line-100 pr-6 max-sm:border-r-0 max-sm:pr-0">
						<div className="text-xs font-medium tracking-[0.04em] text-ink-300 uppercase">{editing ? 'Rename profile' : 'New profile'}</div>
						<TextInput data-autofocus label="Name" placeholder="Deep Sky" value={name} onChange={(e) => setName(e.target.value)} />
						<div className="flex gap-2">
							<Button disabled={!name.trim()} type="submit">
								{editing ? 'Rename' : 'Create'}
							</Button>
							{editing && (
								<Button variant="secondary" onClick={reset}>
									Cancel
								</Button>
							)}
						</div>
					</form>
					<div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
						<div className="text-xs font-medium tracking-[0.04em] text-ink-300 uppercase">Profiles · {profiles.length}</div>
						<div className="max-h-72 overflow-y-auto">
							<List emptyText="No profiles.">
								{profiles.map((p) => (
									<ListItem key={p.id} title={p.name} meta={p.id === activeId ? 'Active' : undefined} selected={p.id === selected?.id} onClick={() => highlight(p.id)} />
								))}
							</List>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Button disabled={!selected || selected.id === activeId} onClick={() => selected && selectProfile(profileState, selected.id)}>
								Activate
							</Button>
							<div className="ml-auto flex flex-wrap gap-2">
								<Button variant="secondary" disabled={!selected} onClick={handleRename}>
									Rename
								</Button>
								<Button variant="secondary" disabled={!selected} onClick={handleDuplicate}>
									Duplicate
								</Button>
								<Button variant="ghost" disabled={!selected || profiles.length <= 1} onClick={handleDelete} title={profiles.length <= 1 ? 'The last profile cannot be deleted' : undefined}>
									{confirming ? 'Confirm delete' : 'Delete'}
								</Button>
								{confirming && (
									<Button variant="secondary" onClick={() => setConfirming(false)}>
										Cancel
									</Button>
								)}
							</div>
						</div>
						{confirming && selected && <p className="m-0 text-[13px] leading-5 text-ink-200">Delete “{selected.name}”? Its connection selection and equipment setup are removed; saved connections and devices are not affected.</p>}
						{error && <p className="m-0 text-[13px] leading-5 text-danger">{error}</p>}
					</div>
				</div>
				<p className="m-0 rounded-md border border-line-100 bg-base-100 px-4 py-3 text-[13px] leading-5 text-ink-200">Profiles are stored locally in this browser. Editing the same profile in multiple tabs may overwrite changes. Avoid editing the same profile simultaneously.</p>
			</div>
		</Modal>
	)
}
