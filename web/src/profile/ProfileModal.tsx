import { type SubmitEvent, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { type Connection, connectionState } from '../connection/connection'
import { Button } from '../ui/Button'
import { ConfirmButton } from '../ui/ConfirmButton'
import { List, ListItem } from '../ui/List'
import { Modal } from '../ui/Modal'
import { SectionHeading } from '../ui/SectionHeading'
import { StatusBadge } from '../ui/StatusBadge'
import { TextInput } from '../ui/TextInput'
import { activeSetup, createProfile, deleteProfile, duplicateProfile, PROFILE_NAME_MAX_LENGTH, profileNameBlocker, profileState, renameProfile, selectProfile } from './profile'
import type { Profile } from './schema'

// Modal that leads with the saved profiles, each with the connection it works with, and acts on the highlighted one:
// activates it in this tab, duplicates it, and deletes it once confirmed. Creating and renaming a profile replace the
// list with a form until it is saved or cancelled. Opening it highlights the tab's active profile.

// What the form shows: a new profile, or the profile of the given id being renamed.
type FormView = { readonly kind: 'new' } | { readonly kind: 'rename'; readonly id: string }

// Returns the list description of a profile: the saved connection it works with and how many roles of that
// connection's equipment setup hold a device, or that it has no connection.
function profileDescription(profile: Readonly<Profile>, connections: readonly Readonly<Connection>[]): string {
	if (!profile.connectionId) return 'No connection'
	const connection = connections.find((c) => c.id === profile.connectionId)
	const roles = Object.values(activeSetup(profile)).filter(Boolean).length
	const assigned = roles === 0 ? 'No roles assigned' : roles === 1 ? '1 role assigned' : `${roles} roles assigned`
	return connection ? `${connection.name} · ${assigned}` : assigned
}

// Returns the confirmation message of deleting a profile: everything it holds, what it leaves alone, and fallback, the
// name of the profile the tabs using it switch to; active tells whether this tab is one of them.
function deletionMessage(fallback: string, active: boolean): string {
	const tabs = active ? `This tab and any other tab using it switch to “${fallback}”.` : `Any tab using it switches to “${fallback}”.`
	return `Its equipment setup on every connection it has used, its preferences, and its camera forms are deleted with it. Saved connections, devices, and observing sites are not affected. ${tabs} This cannot be undone.`
}

// Profiles modal, shown while profileState.open is true: the saved profiles and the actions on the highlighted one, or
// the form that creates or renames one.
export function ProfileModal() {
	const { open, profiles } = useSnapshot(profileState)
	const [view, setView] = useState<FormView>()
	// Id of the profile highlighted in the list; the active profile until another is clicked.
	const [highlighted, setHighlighted] = useState<string>()
	// What the last action did, shown under the actions until the next one.
	const [notice, setNotice] = useState<string>()
	// Profile being renamed; undefined for a new one or once another tab deleted it.
	const renamed = view?.kind === 'rename' ? profiles.find((p) => p.id === view.id) : undefined

	// Returns to the list when the profile being renamed is deleted, such as by another tab.
	useEffect(() => {
		if (view?.kind === 'rename' && !renamed) setView(undefined)
	}, [view, renamed])

	// Hides the modal and returns it to the list on the active profile, discarding the form and the last notice.
	function handleClose() {
		profileState.open = false
		setView(undefined)
		setHighlighted(undefined)
		setNotice(undefined)
	}

	// Returns to the list, highlighting the profile the form created or renamed and saying what it did.
	function handleDone(id?: string, message?: string) {
		setView(undefined)
		if (id) setHighlighted(id)
		setNotice(message)
	}

	return (
		<Modal open={open} onClose={handleClose} title="Profiles" className="max-w-160">
			{view === undefined ? (
				<ProfileList
					highlighted={highlighted}
					notice={notice}
					onHighlight={(id) => {
						setHighlighted(id)
						setNotice(undefined)
					}}
					onNotice={setNotice}
					onNew={() => setView({ kind: 'new' })}
					onRename={(id) => setView({ kind: 'rename', id })}
				/>
			) : (
				<ProfileForm key={view.kind === 'rename' ? view.id : 'new'} profile={renamed} onDone={handleDone} />
			)}
		</Modal>
	)
}

// Properties of the list view of the Profiles modal.
interface ProfileListProps {
	// Id of the highlighted profile; undefined highlights the active one.
	readonly highlighted?: string
	// What the last action did, shown under the actions.
	readonly notice?: string
	// Highlights a profile, clearing the notice.
	readonly onHighlight: (id: string | undefined) => void
	// Replaces the notice with what an action did.
	readonly onNotice: (notice: string) => void
	// Opens the form for a new profile.
	readonly onNew: () => void
	// Opens the form that renames the profile of the given id.
	readonly onRename: (id: string) => void
}

// Saved profiles with their connection, and the actions on the highlighted one: activate it in this tab, duplicate it,
// rename it, and delete it once confirmed.
function ProfileList({ highlighted, notice, onHighlight, onNotice, onNew, onRename }: ProfileListProps) {
	const { profiles, activeId } = useSnapshot(profileState)
	const { connections } = useSnapshot(connectionState)
	const listRef = useRef<HTMLDivElement>(null)
	const selected = profiles.find((p) => p.id === highlighted) ?? profiles.find((p) => p.id === activeId)
	const active = selected?.id === activeId
	// Profile the tabs using the highlighted one switch to once it is deleted: the first of the others.
	const fallback = profiles.find((p) => p.id !== selected?.id)
	const last = profiles.length <= 1

	// Makes the highlighted profile the one this tab works with, keeping the focus on its row as Activate disables itself.
	function handleActivate() {
		if (!selected) return
		selectProfile(profileState, selected.id)
		listRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
		onNotice(`“${selected.name}” is now active in this tab.`)
	}

	// Adds a copy of the highlighted profile and highlights it.
	function handleDuplicate() {
		if (!selected) return
		const copy = duplicateProfile(profileState, selected.id)
		if (!copy) return
		onHighlight(copy.id)
		onNotice(`Added “${copy.name}”, a copy of “${selected.name}”.`)
	}

	// Deletes the highlighted profile and highlights the active one.
	function handleDelete() {
		if (!selected || !deleteProfile(profileState, selected.id)) return
		onHighlight(undefined)
		onNotice(`Deleted “${selected.name}”.`)
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-4">
				<SectionHeading className="flex-1">Saved profiles · {profiles.length}</SectionHeading>
				<Button variant="secondary" onClick={onNew}>
					New profile
				</Button>
			</div>
			<div ref={listRef} className="sm:max-h-80 sm:overflow-y-auto">
				<List emptyText="No profiles.">
					{profiles.map((p) => (
						<ListItem
							key={p.id}
							title={p.name}
							description={profileDescription(p, connections)}
							meta={p.id === activeId ? <StatusBadge tone="neutral" label="Active" title="Active in this tab" /> : undefined}
							selected={p.id === selected?.id}
							autoFocus={p.id === selected?.id}
							onClick={() => onHighlight(p.id)}
						/>
					))}
				</List>
			</div>
			<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
				<Button disabled={!selected || active} title={active ? 'Already active in this tab' : undefined} onClick={handleActivate}>
					Activate
				</Button>
				<Button variant="secondary" className="sm:ml-auto" disabled={!selected} onClick={handleDuplicate}>
					Duplicate
				</Button>
				<Button variant="secondary" disabled={!selected} onClick={() => selected && onRename(selected.id)}>
					Rename
				</Button>
				<ConfirmButton destructive disabled={!selected || last} tooltip={last ? 'The last profile cannot be deleted' : undefined} title={`Delete “${selected?.name ?? ''}”?`} message={selected && fallback ? deletionMessage(fallback.name, active) : ''} confirmLabel="Delete" onConfirm={handleDelete}>
					Delete
				</ConfirmButton>
			</div>
			{notice && <p className="m-0 text-sm leading-5 text-ink-200">{notice}</p>}
			<p className="m-0 max-w-[68ch] text-sm leading-5 text-pretty text-ink-300">The active profile belongs to this tab only. Profiles are kept by the Nebulosa server and shared by every tab and browser; when two tabs change the same setting, the first change saved wins.</p>
		</div>
	)
}

// Properties of the form view of the Profiles modal.
interface ProfileFormProps {
	// Profile to rename; undefined for a new one.
	readonly profile?: Readonly<Profile>
	// Returns to the list with the id of the profile created or renamed and what was done, or with neither on Cancel.
	readonly onDone: (id?: string, notice?: string) => void
}

// Form that creates a profile without activating it, or renames the given one.
function ProfileForm({ profile, onDone }: ProfileFormProps) {
	const [name, setName] = useState(profile?.name ?? '')
	const { profiles } = useSnapshot(profileState)
	const unchanged = profile !== undefined && name.trim() === profile.name
	const blocker = unchanged ? 'The name is unchanged' : profileNameBlocker({ profiles }, name, profile?.id)
	// Reason worth showing under the field: a taken or too long name, not a blank one or an unchanged one.
	const shown = name.trim() && !unchanged ? blocker : undefined

	// Renames the profile, or creates a new one, and returns to the list with it highlighted.
	function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
		e.preventDefault()

		if (profile) {
			const previous = profile.name
			if (renameProfile(profileState, profile.id, name)) onDone(profile.id, `Renamed “${previous}” to “${name.trim()}”.`)
		} else {
			const created = createProfile(profileState, name)
			if (created) onDone(created.id, `Created “${created.name}”. Activate it to use it in this tab.`)
		}
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<SectionHeading className="wrap-break-word">{profile ? `Rename “${profile.name}”` : 'New profile'}</SectionHeading>
			<div className="flex flex-col gap-2">
				<TextInput autoFocus label="Name" maxLength={PROFILE_NAME_MAX_LENGTH} value={name} onChange={(e) => setName(e.target.value)} />
				{shown ? <p className="m-0 text-sm leading-5 text-danger">{shown}</p> : !profile && <p className="m-0 text-sm leading-5 text-pretty text-ink-300">A new profile starts with no connection and default preferences. Duplicate copies one instead.</p>}
			</div>
			<div className="mt-1 flex flex-wrap justify-end gap-2">
				<Button variant="secondary" onClick={() => onDone()}>
					Cancel
				</Button>
				<Button type="submit" disabled={blocker !== undefined} title={blocker}>
					{profile ? 'Rename' : 'Create'}
				</Button>
			</div>
		</form>
	)
}
