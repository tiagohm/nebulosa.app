import type { Mat3 } from 'nebulosa/src/math/linear-algebra/mat3'
import type { Vec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { Datum, Note } from '../InspectorParts'
import type { LunarFeature } from './moon.features'
import { projectPoint } from './moon.geometry'

// Details of the feature selected in the Lunar Surface Explorer: its official name and descriptor, its center point,
// its approximate size (a diameter for craters, the longest extent for elongated features), the origin of its name,
// the year the IAU approved it, a link to its Gazetteer entry, and whether its center is on the visible hemisphere and
// in daylight now. A feature that turns away keeps its details, saying so.

// Page of a feature in the Gazetteer of Planetary Nomenclature.
const GAZETTEER_FEATURE_URL = 'https://planetarynames.wr.usgs.gov/Feature/'

// Formats a selenographic latitude and east longitude in degrees: "9.62° N, 20.08° W".
export function formatSelenographicPoint(latitude: number, longitude: number) {
	return `${Math.abs(latitude).toFixed(2)}° ${latitude >= 0 ? 'N' : 'S'}, ${Math.abs(longitude).toFixed(2)}° ${longitude >= 0 ? 'E' : 'W'}`
}

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
			<p className="m-0 text-base leading-6 font-semibold text-ink-100">{feature.name}</p>
			<p className="m-0 text-ink-300">{feature.descriptor}</p>
			<Datum label="Center">{formatSelenographicPoint(feature.latitude, feature.longitude)}</Datum>
			{feature.dimension !== undefined && <Datum label={feature.elongated ? 'Length' : 'Diameter'}>≈ {feature.dimension < 10 ? feature.dimension.toFixed(1) : Math.round(feature.dimension)} km</Datum>}
			{feature.approvalYear !== undefined && <Datum label="Approved">{feature.approvalYear}</Datum>}
			{feature.origin && <p className="m-0 text-[13px] text-ink-200">{feature.origin}</p>}
			<Note>{featureState(feature, view, sun)}</Note>
			<a href={`${GAZETTEER_FEATURE_URL}${feature.id}`} target="_blank" rel="noreferrer" className="text-[13px] text-accent">
				Gazetteer entry
			</a>
		</div>
	)
}
