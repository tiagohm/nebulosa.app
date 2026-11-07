import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatGeographic } from '../format'
import { activeSite, type ObservingSite, siteState } from '../location/site'
import { activeProfile, profileState } from '../profile/profile'
import { navigate, routeState } from '../shell/route'
import { useMediaQuery, WIDE_SCREEN } from '../shell/useMediaQuery'
import { EmptyState } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { List, ListItem } from '../ui/List'
import { Modal, ModalActions } from '../ui/Modal'
import { Select } from '../ui/Select'
import { ObservingSiteEditor } from './ObservingSiteEditor'

// Observing Sites section of the Settings page: the catalog of named places every profile chooses from, shared by every
// tab and browser, and the editor of the one shown. The site shown is part of the URL; without one, the active
// profile's site, or the first one, is shown. Showing another site or creating one with unsaved changes asks before
// discarding them. Nothing here commands a device.

export interface ObservingSitesSettingsProps {
	// Id of the site shown, from the route; absent shows the active profile's site, or the first one.
	readonly site?: string
}

// What the editor shows: a saved site, or a new one being created.
type Shown = { readonly kind: 'site'; readonly id: string } | { readonly kind: 'new' }

// Content of the Observing Sites section.
export function ObservingSitesSettings({ site: routeSite }: ObservingSitesSettingsProps) {
	const profiles = useSnapshot(profileState)
	const { sites } = useSnapshot(siteState)
	const wide = useMediaQuery(WIDE_SCREEN)
	const [creating, setCreating] = useState(false)
	const [dirty, setDirty] = useState(false)
	const [pending, setPending] = useState<Shown>()
	const active = activeSite(activeProfile(profiles), sites)
	const selected = routeSite !== undefined ? sites.find((entry) => entry.id === routeSite) : (active ?? sites[0])

	function show(next: Shown) {
		setDirty(false)
		setCreating(next.kind === 'new')
		if (next.kind === 'site') navigate(routeState, { workspace: 'settings', section: 'observing-sites', site: next.id })
	}

	function request(next: Shown) {
		if (next.kind === 'site' && !creating && next.id === selected?.id) return
		if (next.kind === 'new' && creating) return
		if (dirty) setPending(next)
		else show(next)
	}

	function closed() {
		setDirty(false)
		setCreating(false)
		navigate(routeState, { workspace: 'settings', section: 'observing-sites' })
	}

	function detail() {
		if (creating) return <ObservingSiteEditor key="new" onDirtyChange={setDirty} onSaved={(saved) => show({ kind: 'site', id: saved.id })} onClosed={closed} />
		if (selected) return <ObservingSiteEditor key={selected.id} site={selected} onDirtyChange={setDirty} onSaved={() => setDirty(false)} onClosed={closed} />
		if (sites.length === 0) return <EmptyState title="No observing sites" description="Add the places you observe from; each profile then chooses one in the top bar." action={<Button onClick={() => request({ kind: 'new' })}>Add Site</Button>} />
		return <EmptyState title="Observing site not found" description="It was deleted, or never saved." />
	}

	const list = <SiteList sites={sites} activeId={active?.id} selected={creating ? undefined : selected?.id} onSelect={(id) => request({ kind: 'site', id })} onAdd={() => request({ kind: 'new' })} wide={wide} />

	return (
		<>
			<div className={wide ? 'relative flex min-h-0 flex-1' : 'relative flex min-h-0 flex-1 flex-col'}>
				{(sites.length > 0 || creating) && list}
				{detail()}
			</div>
			<Modal open={pending !== undefined} onClose={() => setPending(undefined)} title="Discard unsaved changes?" className="max-w-md">
				<p className="m-0 text-sm leading-5 text-ink-200">The changes to {creating ? 'the new site' : selected?.name} were not saved. Showing another site discards them.</p>
				<ModalActions>
					<Button variant="secondary" onClick={() => setPending(undefined)}>
						Keep Editing
					</Button>
					<Button
						data-autofocus
						onClick={() => {
							if (pending) show(pending)
							setPending(undefined)
						}}
					>
						Discard Changes
					</Button>
				</ModalActions>
			</Modal>
		</>
	)
}

export interface SiteListProps {
	// Saved sites, in list order.
	readonly sites: readonly ObservingSite[]
	// Id of the active profile's site, if any.
	readonly activeId?: string
	// Id of the site shown, if any.
	readonly selected?: string
	// Shows a site.
	readonly onSelect: (id: string) => void
	// Starts a new site.
	readonly onAdd: () => void
	// Whether the list is a sidebar (wide screens) or a select (narrow ones).
	readonly wide: boolean
}

// Saved sites with the action that adds one: a sidebar on wide screens, a select on narrow ones.
function SiteList({ sites, activeId, selected, onSelect, onAdd, wide }: SiteListProps) {
	if (!wide) {
		return (
			<div className="flex flex-none items-center gap-2 border-b border-line-100 p-3">
				<Select options={sites.map((site) => site.id)} value={selected ?? ''} format={(id) => sites.find((site) => site.id === id)?.name ?? 'New Site'} onChange={onSelect} />
				<Button variant="secondary" onClick={onAdd}>
					Add Site
				</Button>
			</div>
		)
	}

	return (
		<aside className="flex w-80 flex-none flex-col border-r border-line-100 bg-base-000">
			<List emptyText="No observing sites." className="min-h-0 flex-1 overflow-y-auto p-2">
				{sites.map((site) => (
					<ListItem key={site.id} title={site.name} description={formatGeographic(site.latitude, site.longitude)} meta={site.id === activeId ? <span className="text-accent">Active</span> : site.timeZone} selected={site.id === selected} onClick={() => onSelect(site.id)} />
				))}
			</List>
			<div className="flex-none border-t border-line-100 p-2">
				<Button variant="secondary" className="w-full" onClick={onAdd}>
					Add Site
				</Button>
			</div>
		</aside>
	)
}
