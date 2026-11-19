import type { FramingDocument } from 'api'
import { proxy } from 'valtio'
import { DEFAULT_OPTICS, type FramePoint, type OpticalConfiguration } from '../../framing/geometry'
import { EQUIPMENT_FRAMING_ID } from '../../framing/resolve'
import { DEFAULT_SURVEY } from '../../framing/surveys'
import type { ViewEntry } from '../../profile/view'
import { navigate, type RouteState, routeState } from '../../shell/route'
import { fromDate, ofDateMatrix } from '../../sky/footprint'
import { type MountPoint, type MountView, selectionPoint } from '../../sky/mount'
import type { SkySelection } from '../../sky/sky'

// State of the Framing tool: the framing shown, chosen by the URL (/tools/framing/<id>), and the preview every framing is
// compared in: its J2000 center, which no framing holds (typed, an object of the catalog searched, the catalog object
// selected in Sky, a point of the preview clicked, where the profile's mount points, or the Sky selection sent by Open in
// Framing), its background, the Mini-Sky of
// the catalog or a survey cutout of hips2fits drawn over it, and what it is scaled to fit, every framing or the one
// shown, leaving out the framings hidden from it. The center, background, survey, fit, and hidden framings are kept in
// this browser only (framingPreviewEntry).

// Background of the preview: the stars and deep-sky objects of the catalog, drawn offline, or a survey image.
export type PreviewSource = 'sky' | 'survey'

// What the preview is scaled to fit: every framing that has a field, or the one shown in the panel.
export type PreviewFit = 'all' | 'selected'

// Preview of the tool.
export interface FramingPreviewState {
	// J2000 center of the preview, in radians; absent until one is entered.
	center?: FramePoint
	// Name of the object the center was taken from; absent for typed or clicked coordinates.
	centerName?: string
	// Background.
	source: PreviewSource
	// Survey id of the survey background, of the bundled survey catalog.
	survey: string
	// What the scale fits.
	fit: PreviewFit
	// Ids of the framings left out of the preview, the Equipment Setup's included; the Sky hides its own.
	hidden: string[]
}

// Preview of the tab.
export const framingPreviewState = proxy<FramingPreviewState>({ source: 'sky', survey: DEFAULT_SURVEY, fit: 'all', hidden: [] })

// Shape kept in browser storage.
interface StoredPreview {
	readonly center?: FramePoint
	readonly centerName?: string
	readonly source?: PreviewSource
	readonly survey?: string
	readonly fit?: PreviewFit
	readonly hidden?: readonly string[]
}

// Keeps the center, background, survey, fit, and hidden framings of the preview in browser storage.
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
			if (stored.fit === 'all' || stored.fit === 'selected') state.fit = stored.fit
			if (Array.isArray(stored.hidden)) state.hidden = stored.hidden.filter((id) => typeof id === 'string')
		},
		value: () => ({ center: state.center && { ...state.center }, centerName: state.centerName, source: state.source, survey: state.survey, fit: state.fit, hidden: [...state.hidden] }) satisfies StoredPreview,
	}
}

// Sets the center of the preview, with the name of the object it was taken from; undefined clears it.
export function setPreviewCenter(state: FramingPreviewState, center: FramePoint | undefined, name?: string) {
	state.center = center && { rightAscension: center.rightAscension, declination: center.declination }
	state.centerName = center ? name : undefined
}

// Hides a framing from the preview, or shows it again.
export function setFramingHidden(state: FramingPreviewState, id: string, hidden: boolean) {
	const others = state.hidden.filter((each) => each !== id)
	state.hidden = hidden ? [...others, id] : others
}

// Returns the J2000 position (radians) of where a mount points, which it reports on the true equator and equinox of date
// (JNOW), at an instant in Unix milliseconds (UTC).
export function mountCenter(point: MountPoint, time: number): FramePoint {
	const [rightAscension, declination] = fromDate(ofDateMatrix(time), [point.rightAscension, point.declination])
	return { rightAscension, declination }
}

// Center the Sky sends to the tool: a J2000 position with the name it is shown under.
export interface FramingCenter {
	// J2000 position, in radians.
	readonly center: FramePoint
	// Name of what the center was taken from.
	readonly name: string
}

// Returns the J2000 center of a Sky selection at an instant in Unix milliseconds (UTC), or undefined while it is not known:
// a catalog object's catalog position, where the mount points now (see selectionPoint: only while live and connected),
// or the astrometric J2000 position of anything else, once computed.
export function skySelectionCenter(selection: Pick<SkySelection, 'ref' | 'name' | 'catalog' | 'position'>, mount: Pick<MountView, 'target' | 'state'>, live: boolean, time: number): FramingCenter | undefined {
	if (selection.ref.kind === 'mount') {
		const point = selectionPoint(selection, mount, live)
		return point && { center: mountCenter(point, time), name: mount.target?.name || 'Mount' }
	}

	if (selection.catalog) return { center: { rightAscension: selection.catalog.rightAscension, declination: selection.catalog.declination }, name: selection.name }
	const position = selection.position
	return position && { center: { rightAscension: position.rightAscensionJ2000, declination: position.declinationJ2000 }, name: selection.name }
}

// Opens the tool on the Equipment Setup's framing with the preview centered on a position sent from the Sky.
export function openFramingAt({ center, name }: FramingCenter, state: FramingPreviewState = framingPreviewState, route: RouteState = routeState, history: Pick<History, 'pushState'> = window.history) {
	setPreviewCenter(state, center, name)
	navigate(route, { workspace: 'tools', tool: 'framing' }, history)
}

// Returns the document of a new framing named name in a colour, without rotation: the telescope and Main Camera of the
// Equipment Setup, with the optics they resolve to (setup) kept as the copy it falls back to, when the setup gives a
// field; otherwise a 600 mm telescope and an APS-C camera of 3.76 µm pixels, typed by hand.
export function newFramingDocument(name: string, color: number, setup?: OpticalConfiguration): FramingDocument {
	if (setup) {
		const { focalLength, focalMultiplier, aperture, sensor } = setup
		return { name, color, optics: { telescope: { source: 'setup', setupOptics: 'telescope', focalLength, aperture, focalMultiplier }, camera: { source: 'setup', role: 'MAIN_CAMERA', sensor } }, rotation: 0 }
	}

	const { focalLength, focalMultiplier, aperture, sensor } = DEFAULT_OPTICS
	return { name, color, optics: { telescope: { source: 'manual', focalLength, aperture, focalMultiplier }, camera: { source: 'manual', sensor } }, rotation: 0 }
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
