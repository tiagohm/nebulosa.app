import { cn } from 'cn'
import { profileState, setSkyLayerVisible, setSkyMagnitudeLimit } from '../profile/profile'
import type { SkySettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Checkbox } from '../ui/Checkbox'
import { Notice } from '../ui/Notice'
import { Slider } from '../ui/Slider'
import { isSkyLayerVisible, MAP_STAR_MAGNITUDE_LIMIT, MIN_MAGNITUDE_LIMIT, SKY_LAYERS, type SkyLayerId } from './display'

// Display settings of the Sky workspace: the layers the star map shows, grouped into objects, names, and lines, and the
// faintest stars it draws, kept in the active profile. Changes apply to the map in place, keeping its center and zoom. A
// layer drawn in a colour of its own shows it beside its name, so the panel is also the map's legend.

// Group of layers shown as one collapsible section.
interface LayerGroup {
	// Id of the section, which keeps its collapsed state.
	readonly id: string
	// Heading of the section.
	readonly title: string
	// Layers of the group, in display order.
	readonly layers: readonly SkyLayerId[]
}

// Sections of the layers: what is drawn, what is named, and the lines drawn over the sky. Every layer of SKY_LAYERS is in
// exactly one.
const LAYER_GROUPS: readonly LayerGroup[] = [
	{ id: 'sky.display.objects', title: 'Objects', layers: ['stars', 'deepSky', 'movingBodies', 'satellites', 'meteorRadiants'] },
	{ id: 'sky.display.names', title: 'Names', layers: ['starLabels', 'constellationLabels'] },
	{ id: 'sky.display.lines', title: 'Lines', layers: ['constellations', 'constellationBoundaries', 'grid', 'celestialEquator', 'ecliptic', 'localMeridian'] },
]

// Swatch classes of the layers drawn in a colour of their own (the map palette of ./palette): a short line for a
// reference line or a set of lines, a dot for a kind of object.
const LAYER_SWATCHES: Partial<Record<SkyLayerId, string>> = {
	deepSky: 'size-2 rounded-full bg-map-deep-sky',
	movingBodies: 'size-2 rounded-full bg-map-planet',
	meteorRadiants: 'size-2 rounded-full bg-map-radiant',
	constellations: 'h-0.5 w-4 rounded-full bg-line-200',
	grid: 'h-0.5 w-4 rounded-full bg-line-200',
	celestialEquator: 'h-0.5 w-4 rounded-full bg-map-equator',
	ecliptic: 'h-0.5 w-4 rounded-full bg-map-ecliptic',
	localMeridian: 'h-0.5 w-4 rounded-full bg-map-meridian',
}

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
			{LAYER_GROUPS.map((group) => {
				const layers = SKY_LAYERS.filter((layer) => group.layers.includes(layer.id))
				const shown = layers.filter((layer) => isSkyLayerVisible(display, layer) && (local || !layer.localOnly)).length

				return (
					<CollapsibleSection key={group.id} id={group.id} title={group.title} summary={`${shown} of ${layers.length} shown`}>
						{layers.map((layer) => {
							const swatch = LAYER_SWATCHES[layer.id]

							return (
								<div key={layer.id} className="flex items-center gap-2">
									<Checkbox label={layer.label} checked={isSkyLayerVisible(display, layer)} disabled={layer.localOnly && !local} onChange={(visible) => setSkyLayerVisible(profileState, layer.id, visible)} className="min-w-0 flex-1" />
									{swatch && <span className={cn('flex-none', swatch)} />}
								</div>
							)
						})}
						{!local && group.layers.includes('localMeridian') && <Notice>The local meridian needs the observer&apos;s location.</Notice>}
					</CollapsibleSection>
				)
			})}
			<CollapsibleSection id="sky.display.stars" title="Stars">
				<Slider label="Faintest magnitude" value={display?.magnitudeLimit ?? MAP_STAR_MAGNITUDE_LIMIT} min={MIN_MAGNITUDE_LIMIT} max={MAP_STAR_MAGNITUDE_LIMIT} step={0.5} onChange={(limit) => setSkyMagnitudeLimit(profileState, limit)} />
				<Notice>The map holds stars down to magnitude {MAP_STAR_MAGNITUDE_LIMIT}; fainter stars are still found by the search.</Notice>
			</CollapsibleSection>
		</>
	)
}
