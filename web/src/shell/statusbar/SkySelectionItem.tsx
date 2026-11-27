import type { SkyObjectRef, SkyPosition } from 'api'
import { cn } from 'cn'
import { type Ref, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime } from '../../equipment-control/control'
import { formatDegrees, formatLocalTime } from '../../format'
import { locationKey, siteObserver } from '../../location/site'
import { useActiveSite, useDisplayZone } from '../../location/useLocation'
import { profileState, setPanelOpen } from '../../profile/profile'
import { formatDeclination, formatRightAscension } from '../../sky/format'
import { mountRuntime, mountView } from '../../sky/mount'
import { ObjectActions } from '../../sky/ObjectActions'
import { selectionType } from '../../sky/ObjectInspector'
import { fetchSkyPosition, type SkySelection, skyState } from '../../sky/sky'
import { openFramingAt, skySelectionCenter } from '../../tools/framing/framing'
import { DataRow } from '../../ui/DataRow'
import { Icon } from '../../ui/Icon'
import { LinkButton } from '../../ui/LinkButton'
import { Notice } from '../../ui/Notice'
import { ObjectTitle } from '../../ui/ObjectTitle'
import { SectionHeading } from '../../ui/SectionHeading'
import { useNow } from '../../useNow'
import { navigate, routeState } from '../route'
import { type PanelPlacement, panelStyle, useBarPopover } from './popover'
import { HIT_CLASS } from './StatusItems'

// The object selected in the Sky, shown in the status bar from every workspace while one is selected: the target icon and
// its name, a button opening a panel above itself (./popover) with what it is, where it is now for the profile's observing
// site, and the actions of its Object Inspector (Open in Framing, Add to Observing Planner, Explore Orbit, and Slew to
// Object while the mount is connected), so the mount is pointed without leaving Imaging or Equipment Control, and the way to
// the Sky with its inspector. The place is located at the real current time when the panel opens, whatever instant the Sky
// shows, as a slew resolves it; the mount marker, satellites, and meteor shower radiants have no place or action here and
// are only opened in the Sky. Closing the panel never changes the selection.

// Width of the panel, in CSS pixels, when the viewport has room for it.
const PANEL_WIDTH = 360

// Type line of a selection with no line of its own in the Object Inspector.
const KIND_NAMES: Readonly<Partial<Record<SkySelection['ref']['kind'], string>>> = { mount: 'Mount', satellite: 'Artificial satellite', meteorShower: 'Meteor shower radiant' }

// Returns the identity of a selection the sky API locates and the Object Inspector's actions take, or undefined for the
// mount marker, a satellite, and a meteor shower radiant, which have views of their own in the Sky.
function locatable(ref: SkySelection['ref']): SkyObjectRef | undefined {
	return ref.kind === 'mount' || ref.kind === 'satellite' || ref.kind === 'meteorShower' ? undefined : ref
}

interface SkySelectionItemProps {
	// Whether this is the hidden copy the bar measures, which is not a button.
	readonly measure?: boolean
}

// Chip of the Sky selection, and the panel it opens; nothing while nothing is selected.
export function SkySelectionItem({ measure }: SkySelectionItemProps) {
	const { selection } = useSnapshot(skyState)
	const { rootRef, buttonRef, panelRef, placement, toggle, close } = useBarPopover(PANEL_WIDTH)
	const selected = !!selection

	// Closes the panel when the selection is cleared, so a later selection never opens it by itself.
	useEffect(() => {
		if (!selected) close()
	}, [selected])

	if (!selection) return null

	const content = (
		<>
			<Icon name="sky" className="size-3.5 text-ink-300" />
			<span className="max-w-40 truncate">{selection.name}</span>
		</>
	)

	if (measure) return <span className="flex flex-none items-center gap-1">{content}</span>

	return (
		<span ref={rootRef} className="flex flex-none items-center">
			<button
				ref={buttonRef}
				type="button"
				title={`Sky selection: ${selection.name} · Show its place and actions`}
				onClick={toggle}
				className={cn('flex cursor-pointer items-center gap-1 rounded-sm text-ink-200 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent', HIT_CLASS, placement && 'text-ink-100')}
			>
				{content}
			</button>
			{placement && <SkySelectionPanel ref={panelRef} placement={placement} selection={selection} onClose={close} />}
		</span>
	)
}

// Place of the selection now, or why it is not known.
type SkySelectionPosition = { readonly status: 'loading' } | { readonly status: 'ready'; readonly position: SkyPosition } | { readonly status: 'error'; readonly error: string }

interface SkySelectionPanelProps {
	// Element of the panel, focused when it opens.
	readonly ref?: Ref<HTMLDivElement>
	// Position and width of the panel.
	readonly placement: PanelPlacement
	// Selection shown.
	readonly selection: SkySelection
	// Closes the panel.
	readonly onClose: () => void
}

// Panel of the Sky selection.
function SkySelectionPanel({ ref, placement, selection, onClose }: SkySelectionPanelProps) {
	const observer = useActiveSite()
	const displayZone = useDisplayZone(observer)
	const mount = mountView(useSnapshot(mountRuntime), useSnapshot(controlRuntime))
	const [selectedPosition, setSelectedPosition] = useState<SkySelectionPosition>()
	const now = useNow(true, 30000)
	const target = locatable(selection.ref)
	const place = locationKey(observer)
	const position = selectedPosition?.status === 'ready' ? selectedPosition.position : undefined
	const center = target && skySelectionCenter({ ...selection, position: position ?? selection.position }, mount, true, now)
	const events = selection.events
	const timeZone = displayZone.zone
	const designations = selection.catalog ? selection.catalog.designations : selection.constellation ? [selection.constellation.abbreviation, selection.constellation.genitive] : []

	// Locates the object at the real current time for the observing site, again when the selection or the site changes; a
	// later request or a closed panel ignores an earlier answer.
	useEffect(() => {
		if (!target) return
		const controller = new AbortController()
		setSelectedPosition({ status: 'loading' })
		fetchSkyPosition(target, now, siteObserver(observer), 'accurate', controller.signal).then(
			(response) => !controller.signal.aborted && setSelectedPosition({ status: 'ready', position: response.position }),
			(error: unknown) => !controller.signal.aborted && setSelectedPosition({ status: 'error', error: error instanceof Error ? error.message : 'Request failed' }),
		)
		return () => controller.abort()
	}, [selection.key, place, now])

	// Shows the selection in the Sky, with its Object Inspector in the panel.
	function openInSky() {
		skyState.panel = 'inspector'
		setPanelOpen(profileState, 'sky', true)
		navigate(routeState, { workspace: 'sky' })
		onClose()
	}

	return (
		<div ref={ref} tabIndex={-1} style={panelStyle(placement)} className="fixed z-30 box-border flex flex-col gap-3 overflow-y-auto rounded-md border border-line-100 bg-base-200 p-3 text-xs whitespace-normal text-ink-200 shadow-[0_12px_32px_rgb(0_0_0/0.45)] outline-none">
			<div className="flex items-baseline justify-between gap-3">
				<SectionHeading>Sky Selection</SectionHeading>
				<LinkButton onClick={openInSky}>Open in Sky</LinkButton>
			</div>
			<div className="flex flex-col gap-0.5">
				<ObjectTitle name={selection.name} kind={selectionType(selection) || KIND_NAMES[selection.ref.kind]} designations={designations.join(' · ')} />
			</div>
			{target ? (
				<section className="flex flex-col gap-1">
					<div className="flex items-baseline justify-between gap-3">
						<SectionHeading>Now</SectionHeading>
						<span className="text-ink-300">{observer ? `From ${observer.name ?? 'the active site'}` : 'Geocentric'}</span>
					</div>
					{(!selectedPosition || selectedPosition.status === 'loading') && <p className="m-0 text-ink-300">Locating the object now…</p>}
					{selectedPosition?.status === 'error' && <Notice error>The current position is unavailable: {selectedPosition.error}</Notice>}
					{position && (
						<>
							<DataRow label="RA (of date)">{formatRightAscension(position.rightAscension)}</DataRow>
							<DataRow label="Dec (of date)">{formatDeclination(position.declination)}</DataRow>
							{position.altitude !== undefined && <DataRow label="Altitude">{formatDegrees(position.altitude)}</DataRow>}
							{position.azimuth !== undefined && <DataRow label="Azimuth">{formatDegrees(position.azimuth)}</DataRow>}
							{position.altitude !== undefined && position.altitude < 0 && <p className="m-0 text-warning">Below the horizon now.</p>}
							{events?.state === 'circumpolar' && <DataRow label="Rise and set">Circumpolar</DataRow>}
							{events?.state === 'belowHorizon' && <DataRow label="Rise and set">Below the horizon all day</DataRow>}
							{events?.rise !== undefined && <DataRow label="Rise">{formatLocalTime(events.rise, timeZone, position.time)}</DataRow>}
							{events?.transit !== undefined && (
								<DataRow label="Transit">
									{formatLocalTime(events.transit, timeZone, position.time)}
									{events.transitAltitude !== undefined && ` · ${formatDegrees(events.transitAltitude)}`}
								</DataRow>
							)}
							{events?.set !== undefined && <DataRow label="Set">{formatLocalTime(events.set, timeZone, position.time)}</DataRow>}
						</>
					)}
					{!observer && <p className="m-0 text-ink-300">Select an observing site in the top bar to see altitude and azimuth.</p>}
				</section>
			) : (
				<p className="m-0 text-ink-300">Its place and actions are in the Sky.</p>
			)}
			{target && (
				<ObjectActions
					target={target}
					targetName={selection.name}
					observer={observer}
					onOpenFraming={
						center &&
						(() => {
							openFramingAt(center)
							onClose()
						})
					}
				/>
			)}
		</div>
	)
}
