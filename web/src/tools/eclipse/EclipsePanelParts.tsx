import type { ResolvedLocation, ToolLocation } from '../../location/site'
import { TimeZoneSelect } from '../../location/TimeZoneSelect'
import { ToolLocationSection } from '../../location/ToolLocationSection'
import { describeDisplayZone, type DisplayZone, type DisplayZoneOverride } from '../../location/zone'
import { Notice } from '../../ui/Notice'

// Pieces of the Local Circumstances panels of the eclipse map tools: the Location section, where the tool observes
// from the active site, another saved site, or coordinates typed in or clicked on the map, and the selector of the
// zone the times are shown in. Neither changes the profile, a site, or a request.

export interface EclipseLocationSectionProps {
	// Identifier of the section, namespaced by the tool's panel.
	readonly id: string
	// Location chosen for the tool.
	readonly value: ToolLocation
	// Place it gives; absent when there is none.
	readonly location?: ResolvedLocation
	// Receives the location chosen.
	readonly onChange: (location: ToolLocation) => void
}

// Location section of an eclipse map; the elevation is not asked for, since the local circumstances ignore it.
export function EclipseLocationSection({ id, value, location, onChange }: EclipseLocationSectionProps) {
	return <ToolLocationSection id={id} value={value} location={location} onChange={onChange} hint={<Notice>A click on the map observes from that point, in the zone of the coordinates entered before, or UTC.</Notice>} />
}

export interface EclipseZoneSelectProps {
	// Zone override of the tool.
	readonly value: DisplayZoneOverride
	// Zone the times are shown in, resolved from the override and the location.
	readonly zone: DisplayZone
	// Place the tool observes from; absent when there is none.
	readonly location?: ResolvedLocation
	// Whether the location is not the active profile's site.
	readonly selectedSite: boolean
	// Receives the override chosen.
	readonly onChange: (value: DisplayZoneOverride) => void
}

// Selector of the zone of the times, saying so when the browser's zone stands in for a location there is none of.
export function EclipseZoneSelect({ value, zone, location, selectedSite, onChange }: EclipseZoneSelectProps) {
	return (
		<>
			<TimeZoneSelect value={value} site={location} selectedSite={selectedSite} onChange={onChange} />
			{zone.source === 'browserFallback' && <Notice>Times are in {describeDisplayZone(zone)}: the tool has no location.</Notice>}
		</>
	)
}
