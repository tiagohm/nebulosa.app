import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatGeographic } from '../format'
import { activeSite, type ObservingSite, SITE_DECIMALS, siteState } from '../location/site'
import { activeProfile, profileState } from '../profile/profile'
import { navigate, redirect, routeState, setLeaveGuard } from '../shell/route'
import { useMediaQuery, WIDE_SCREEN } from '../shell/useMediaQuery'
import { EmptyState } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { List, ListItem } from '../ui/List'
import { Modal, ModalActions } from '../ui/Modal'
import { Select } from '../ui/Select'
import { StatusBadge } from '../ui/StatusBadge'
import { ObservingSiteEditor } from './ObservingSiteEditor'

// Observing Sites section of the Settings page: the catalog of named places every profile chooses from, shared by every
// tab and browser, and the editor of the one shown. The site shown is part of the URL; opened without one, the section
// shows the active profile's site, or the first one, and puts it in the URL, so choosing another site in the top bar
// never swaps the editor. Leaving a site or a new one with unsaved changes, for another site, another section, or another
// workspace, asks before discarding them. Nothing here commands a device.

export interface ObservingSitesSettingsProps {
	// Id of the site shown, from the route; absent shows the active profile's site, or the first one.
	readonly site?: string
}

// Content of the Observing Sites section.
export function ObservingSitesSettings({ site: routeSite }: ObservingSitesSettingsProps) {
	const profiles = useSnapshot(profileState)
	const { sites } = useSnapshot(siteState)
	const wide = useMediaQuery(WIDE_SCREEN)
	// Whether a new site is being created; only while the route names no site.
	const [creating, setCreating] = useState(false)
	const [dirty, setDirty] = useState(false)
	// Step held until the person discards the unsaved changes or keeps editing.
	const [pending, setPending] = useState<() => void>()
	// Removes the leave guard of the unsaved changes; absent while there are none.
	const unguard = useRef<() => void>(undefined)
	const active = activeSite(activeProfile(profiles), sites)
	const selected = routeSite !== undefined ? sites.find((entry) => entry.id === routeSite) : (active ?? sites[0])
	const selectedId = selected?.id

	// A route that comes to name a site ends the creation of a new one. It follows the change of the route, not its value,
	// since the route store reaches this component a render after the state that starts a new site.
	useEffect(() => {
		if (routeSite !== undefined) setCreating(false)
	}, [routeSite])

	// Names the site shown in the URL when the route has none.
	useEffect(() => {
		if (routeSite === undefined && !creating && selectedId) redirect(routeState, { workspace: 'settings', section: 'observing-sites', site: selectedId })
	}, [routeSite, creating, selectedId])

	// Holds every navigation away from the site while its changes are unsaved.
	useEffect(() => {
		if (!dirty) return undefined
		const remove = setLeaveGuard((proceed) => {
			setPending(() => proceed)
			return false
		})
		unguard.current = remove
		return () => {
			remove()
			unguard.current = undefined
		}
	}, [dirty])

	// Drops the unsaved changes and their guard at once, so a navigation right after it is not held.
	function forget() {
		unguard.current?.()
		setDirty(false)
	}

	function select(id: string) {
		if (creating || id !== selectedId) navigate(routeState, { workspace: 'settings', section: 'observing-sites', site: id })
	}

	function startNew() {
		if (creating) return

		const go = () => {
			setCreating(true)
			navigate(routeState, { workspace: 'settings', section: 'observing-sites' })
		}

		if (dirty) setPending(() => go)
		else go()
	}

	function saved(site: ObservingSite) {
		forget()
		navigate(routeState, { workspace: 'settings', section: 'observing-sites', site: site.id })
	}

	function closed() {
		forget()
		setCreating(false)
		navigate(routeState, { workspace: 'settings', section: 'observing-sites' })
	}

	function discard() {
		const proceed = pending
		setPending(undefined)
		forget()
		proceed?.()
	}

	function detail() {
		if (creating) return <ObservingSiteEditor key="new" onDirtyChange={setDirty} onSaved={saved} onClosed={closed} />
		if (selected) return <ObservingSiteEditor key={selected.id} site={selected} onDirtyChange={setDirty} onSaved={() => setDirty(false)} onClosed={closed} />
		if (sites.length === 0) return <EmptyState title="No observing sites" description="Add the places you observe from; each profile then chooses one in the top bar." action={<Button onClick={startNew}>New Site</Button>} />
		return <EmptyState title="Observing site not found" description="It was deleted, or never saved." />
	}

	return (
		<>
			<div className={wide ? 'relative flex min-h-0 flex-1' : 'relative flex min-h-0 flex-1 flex-col'}>
				{(sites.length > 0 || creating) && <SiteList sites={sites} activeId={active?.id} selected={creating ? undefined : selectedId} onSelect={select} onAdd={startNew} wide={wide} />}
				{detail()}
			</div>
			<Modal open={pending !== undefined} onClose={() => setPending(undefined)} title="Discard unsaved changes?" className="max-w-md">
				<p className="m-0 text-sm leading-5 text-ink-200">The changes to {creating ? 'the new site' : selected?.name} were not saved. Leaving them discards them.</p>
				<ModalActions>
					<Button variant="secondary" onClick={() => setPending(undefined)} data-autofocus>
						Keep Editing
					</Button>
					<Button variant="danger" onClick={discard}>
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

// Saved sites with the action that starts a new one: a sidebar on wide screens, a select on narrow ones, where the
// active profile's site is named in its option.
function SiteList({ sites, activeId, selected, onSelect, onAdd, wide }: SiteListProps) {
	if (!wide) {
		return (
			<div className="flex flex-none items-center gap-2 border-b border-line-100 p-3">
				<Select
					options={sites.map((site) => site.id)}
					value={selected ?? ''}
					format={(id) =>
						siteOption(
							sites.find((site) => site.id === id),
							id === activeId,
						)
					}
					onChange={onSelect}
					className="min-w-0 flex-1"
				/>
				<Button variant="secondary" className="flex-none" onClick={onAdd}>
					New Site
				</Button>
			</div>
		)
	}

	return (
		<aside className="flex w-80 flex-none flex-col border-r border-line-100 bg-base-000">
			<List emptyText="No observing sites." className="min-h-0 flex-1 overflow-y-auto p-2">
				{sites.map((site) => (
					<ListItem
						opens
						key={site.id}
						title={site.name}
						description={formatGeographic(site.latitude, site.longitude, SITE_DECIMALS)}
						meta={site.id === activeId ? <StatusBadge tone="neutral" label="Active" title="The observing site of this profile" /> : site.timeZone}
						selected={site.id === selected}
						onClick={() => onSelect(site.id)}
					/>
				))}
			</List>
			<div className="flex-none border-t border-line-100 p-2">
				<Button variant="secondary" className="w-full" onClick={onAdd}>
					New Site
				</Button>
			</div>
		</aside>
	)
}

// Text of a site in the narrow select: its name, marked when it is the active profile's site; "New Site" while a new
// one is created and none is selected.
function siteOption(site: ObservingSite | undefined, active: boolean) {
	if (!site) return 'New Site'
	return active ? `${site.name} · Active` : site.name
}
