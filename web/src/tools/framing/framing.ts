import type { FramingDocument } from 'api'
import { proxy } from 'valtio'
import { DEFAULT_OPTICS, type FramePoint } from '../../framing/geometry'
import { EQUIPMENT_FRAMING_ID } from '../../framing/resolve'
import { DEFAULT_SURVEY } from '../../framing/surveys'
import type { ViewEntry } from '../../profile/view'
import { navigate, type RouteState, routeState } from '../../shell/route'
import { fromDate, ofDateMatrix } from '../../sky/footprint'
import type { MountPoint } from '../../sky/mount'

// State of the Framing tool: the framing shown, chosen by the URL (/tools/framing/<id>), and the preview every framing is
// compared in: its J2000 center, which no framing holds (typed, the catalog object selected in Sky, or where the profile's
// mount points), and its background, the Mini-Sky of the catalog or a survey
// cutout of hips2fits, never both. The center, background, and survey are kept in this browser only (framingPreviewEntry);
// whether a cutout is downloading is tab memory.

// Background of the preview: the stars and deep-sky objects of the catalog, drawn offline, or a survey image.
export type PreviewSource = 'sky' | 'survey'

// Preview of the tool.
export interface FramingPreviewState {
	// J2000 center of the preview, in radians; absent until one is entered.
	center?: FramePoint
	// Name of the object the center was taken from; absent for typed coordinates.
	centerName?: string
	// Background.
	source: PreviewSource
	// Survey id of the survey background, of the bundled survey catalog.
	survey: string
	// Whether a survey cutout is downloading, which locks the inputs until it ends.
	downloading: boolean
}

// Preview of the tab.
export const framingPreviewState = proxy<FramingPreviewState>({ source: 'sky', survey: DEFAULT_SURVEY, downloading: false })

// Shape kept in browser storage.
interface StoredPreview {
	readonly center?: FramePoint
	readonly centerName?: string
	readonly source?: PreviewSource
	readonly survey?: string
}

// Keeps the center, background, and survey of the preview in browser storage.
export function framingPreviewEntry(state: FramingPreviewState): ViewEntry {
	return {
		name: 'framingPreview',
		store: state,
		restore: (value) => {
			const stored = value as StoredPreview
			if (stored.center && Number.isFinite(stored.center.rightAscension) && Number.isFinite(stored.center.declination)) state.center = { rightAscension: stored.center.rightAscension, declination: stored.center.declination }
			if (typeof stored.centerName === 'string') state.centerName = stored.centerName
			if (stored.source === 'sky' || stored.source === 'survey') state.source = stored.source
			if (typeof stored.survey === 'string' && stored.survey) state.survey = stored.survey
		},
		value: () => ({ center: state.center && { ...state.center }, centerName: state.centerName, source: state.source, survey: state.survey }) satisfies StoredPreview,
	}
}

// Sets the center of the preview, with the name of the object it was taken from; undefined clears it.
export function setPreviewCenter(state: FramingPreviewState, center: FramePoint | undefined, name?: string) {
	state.center = center && { rightAscension: center.rightAscension, declination: center.declination }
	state.centerName = center ? name : undefined
}

// Returns the J2000 position (radians) of where a mount points, which it reports on the true equator and equinox of date
// (JNOW), at an instant in Unix milliseconds (UTC).
export function mountCenter(point: MountPoint, time: number): FramePoint {
	const [rightAscension, declination] = fromDate(ofDateMatrix(time), [point.rightAscension, point.declination])
	return { rightAscension, declination }
}

// Returns the document of a new framing named name: a 600 mm telescope and an APS-C camera of 3.76 µm pixels, typed by
// hand, without rotation.
export function newFramingDocument(name: string): FramingDocument {
	const { focalLength, focalMultiplier, aperture, sensor } = DEFAULT_OPTICS
	return { name, optics: { telescope: { source: 'manual', focalLength, aperture, focalMultiplier }, camera: { source: 'manual', sensor } }, rotation: 0 }
}

// Returns a name no framing has yet: "Framing n" for the first free n from the count of framings plus one.
export function newFramingName(names: readonly string[]) {
	const taken = new Set(names.map((name) => name.toLowerCase()))
	let n = names.length + 1
	while (taken.has(`framing ${n}`)) n++
	return `Framing ${n}`
}

// Shows a framing in the tool, or the Equipment Setup's.
export function showFraming(id: string, route: RouteState = routeState, history: Pick<History, 'pushState'> = window.history) {
	navigate(route, { workspace: 'tools', tool: 'framing', framing: id === EQUIPMENT_FRAMING_ID ? undefined : id }, history)
}
