import { profileState, setSkyLayerVisible, setSkyMagnitudeLimit } from '../profile/profile'
import type { SkySettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Checkbox } from '../ui/Checkbox'
import { Notice } from '../ui/Notice'
import { Slider } from '../ui/Slider'
import { isSkyLayerVisible, MAP_STAR_MAGNITUDE_LIMIT, MIN_MAGNITUDE_LIMIT, SKY_LAYERS } from './display'

// Display settings of the Sky workspace: the layers the star map shows and the faintest stars it draws,
// kept in the active profile. Changes apply to the map in place, keeping its center and zoom.

export interface DisplayPanelProps {
	// Sky preferences of the active profile.
	readonly sky: Readonly<SkySettings>
	// Whether the map is the observer's local sky, where the local meridian exists.
	readonly local: boolean
}

// Display settings form.
export function DisplayPanel({ sky, local }: DisplayPanelProps) {
	const display = sky.display

	return (
		<>
			<CollapsibleSection id="sky.display.layers" title="Layers">
				{SKY_LAYERS.map((layer) => (
					<Checkbox key={layer.id} label={layer.label} checked={isSkyLayerVisible(display, layer)} disabled={layer.localOnly && !local} onChange={(visible) => setSkyLayerVisible(profileState, layer.id, visible)} />
				))}
				{!local && <Notice>The local meridian needs the observer&apos;s location.</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="sky.display.stars" title="Stars">
				<Slider label="Faintest magnitude" value={display?.magnitudeLimit ?? MAP_STAR_MAGNITUDE_LIMIT} min={MIN_MAGNITUDE_LIMIT} max={MAP_STAR_MAGNITUDE_LIMIT} step={0.5} onChange={(limit) => setSkyMagnitudeLimit(profileState, limit)} />
				<Notice>The map holds stars down to magnitude {MAP_STAR_MAGNITUDE_LIMIT}; fainter stars are still found by the search.</Notice>
			</CollapsibleSection>
		</>
	)
}
