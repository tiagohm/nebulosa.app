import type { Mat3 } from 'nebulosa/src/math/linear-algebra/mat3'
import type { Vec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { formatGeographic, formatKilometers } from '../../format'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { ObjectTitle } from '../../ui/ObjectTitle'
import type { LunarFeature } from './moon.features'
import { projectPoint } from './moon.geometry'

// Details of the feature selected in the Lunar Surface Explorer: its official name and descriptor, its center point,
// its approximate size (a diameter for craters, the longest extent for elongated features), the origin of its name,
// the year the IAU approved it, a link to its Gazetteer entry, and whether its center is on the visible hemisphere and
// in daylight now. A feature that turns away keeps its details, saying so.

// Page of a feature in the Gazetteer of Planetary Nomenclature.
const GAZETTEER_FEATURE_URL = 'https://planetarynames.wr.usgs.gov/Feature/'

// Says where a feature is now: on the far side, on the night side, or in daylight.
function featureState(feature: LunarFeature, view: Mat3, sun: Vec3) {
	if (projectPoint(view, feature.vector).z <= 0) return 'Outside the visible hemisphere now.'
	const day = feature.vector[0] * sun[0] + feature.vector[1] * sun[1] + feature.vector[2] * sun[2] >= 0
	return day ? 'On the visible hemisphere, in daylight.' : 'On the visible hemisphere, in the lunar night.'
}

// Details of the selected feature.
export function MoonFeatureDetails({ feature, view, sun }: { readonly feature: LunarFeature; readonly view: Mat3; readonly sun: Vec3 }) {
	return (
		<div className="flex flex-col gap-2">
			<ObjectTitle name={feature.name} kind={feature.descriptor} />
			<DataRow label="Center">{formatGeographic(feature.latitude, feature.longitude, 2)}</DataRow>
			{feature.dimension !== undefined && <DataRow label={feature.elongated ? 'Length' : 'Diameter'}>≈ {formatKilometers(feature.dimension, feature.dimension < 10 ? 1 : 0)}</DataRow>}
			{feature.approvalYear !== undefined && <DataRow label="Approved">{feature.approvalYear}</DataRow>}
			{feature.origin && <p className="m-0 text-sm text-ink-200">{feature.origin}</p>}
			<Notice>{featureState(feature, view, sun)}</Notice>
			<a href={`${GAZETTEER_FEATURE_URL}${feature.id}`} target="_blank" rel="noreferrer" className="text-sm text-accent">
				Gazetteer entry
			</a>
		</div>
	)
}
