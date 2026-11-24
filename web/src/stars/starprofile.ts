import type { StarProfileMeasurement, StarProfilePreview, StarProfileRequest, StarProfileResult } from 'api'
import { ref } from 'valtio'
import { type ApiFetch, browserFetch, fetchJson, jsonInit } from '../http'
import { type ImageStarProfileState, type ImagesState, message } from '../images/images'
import type { Point } from '../viewer/transform'
import type { StarProfileMeasurementSettings } from './starprofile.settings'

// Star Profile Inspector of a document: asks the server for the profile of the star near a point of its image and keeps
// the latest answer in the view state of the document, in tab memory only. Nothing runs unless a person points at a star
// or asks to measure it again. A newer measurement aborts the one before it, and an answer commits only while its token
// is still the current one, since an abort may lose the race with a response. While a measurement of the same image
// runs, the star measured before it stays, so the panel never empties between two answers; a failure drops it. A tap
// searches at least a fixed distance on screen whatever the zoom, so a finger finds a star on a phone at fit zoom.
// Showing another frame or closing the document drops the state, so a measurement is never shown over an image it did
// not measure.

// Least distance a tap searches around it for a star, in CSS pixels on screen: about a fingertip.
export const TAP_SEARCH_DISTANCE = 24

// Most a tap widens the search, in image pixels, which bounds the region the server reads at a small zoom.
export const MAX_TAP_SEARCH_RADIUS = 128

// Token of the latest measurement started in the tab.
let token = 0

// Returns the search radius a tap asks for at a zoom, in whole image pixels, as the region the server reads is: at least
// TAP_SEARCH_DISTANCE on screen, at most MAX_TAP_SEARCH_RADIUS. scale is the zoom of the viewer, in screen pixels per
// image pixel, greater than 0.
export function tapSearchRadius(scale: number) {
	return Math.min(Math.ceil(TAP_SEARCH_DISTANCE / scale), MAX_TAP_SEARCH_RADIUS)
}

// Returns what a measurement asks for with the settings, its search radius widened to at least tapRadius, in image
// pixels.
export function measurementOf({ model, searchRadius, maximumRadius, minSNR }: StarProfileMeasurementSettings, tapRadius = 0): StarProfileMeasurementSettings {
	return { model, searchRadius: Math.max(searchRadius, tapRadius), maximumRadius, minSNR }
}

// Measures the star near a point of the image of a document, replacing what the document shows. detected says that a
// star detection already found a star at the point; tapRadius, in image pixels, is the least search radius the tap
// asks for (tapSearchRadius), 0 for none. Ignored for an unknown key.
export function inspectStar(state: ImagesState, key: string, imageId: string, point: Point, detected: boolean, settings: StarProfileMeasurementSettings, tapRadius: number, request: ApiFetch = browserFetch) {
	const body: StarProfileRequest = { x: point.x, y: point.y, ...(detected && { detected }), ...measurementOf(settings, tapRadius) }
	return measure(state, key, imageId, body, tapRadius, request)
}

// Measures again the star of a document with new settings, from the same point and with the search its tap asked for.
// Ignored without one.
export function reinspectStar(state: ImagesState, key: string, settings: StarProfileMeasurementSettings, request: ApiFetch = browserFetch) {
	const current = state.views[key]?.starProfile
	if (!current) return Promise.resolve()
	const tapRadius = current.tapRadius ?? 0
	return measure(state, key, current.imageId, { ...current.request, ...measurementOf(settings, tapRadius) }, tapRadius, request)
}

// Runs a measurement and commits its answer while it is still the one the document waits for, keeping the star the
// document measured on the same image until then.
async function measure(state: ImagesState, key: string, imageId: string, body: StarProfileRequest, tapRadius: number, request: ApiFetch) {
	const view = state.views[key]
	if (!view) return

	const previous = view.starProfile
	previous?.controller?.abort()
	const kept = previous?.imageId === imageId ? measuredStar(previous) : undefined
	const current = ++token
	const controller = new AbortController()
	view.starProfile = { imageId, request: body, tapRadius, token: current, status: 'measuring', controller: ref(controller), ...(kept && { result: ref(kept) }) }

	// Returns the state of this measurement, unless another one took its place.
	const latest = () => {
		const profile = state.views[key]?.starProfile
		return profile?.token === current ? profile : undefined
	}

	try {
		const result = await fetchJson<StarProfileResult>({ fetch: (input, init) => request(input, init) }, `/api/images/${encodeURIComponent(imageId)}/star-profile`, jsonInit('POST', body, controller.signal))
		const profile = latest()
		if (!profile) return
		profile.status = result.status
		profile.result = ref(result)
		profile.controller = undefined
	} catch (error) {
		const profile = latest()
		if (!profile) return
		profile.status = 'failed'
		profile.result = undefined
		profile.error = message(error)
		profile.controller = undefined
	}
}

// Returns the star profile a document shows for an image: nothing for the measurement of another image, even in the same
// tab, whose pixels are not the ones shown.
export function starProfileOf<T extends { readonly imageId: string }>(view: { readonly starProfile?: T } | undefined, imageId: string | undefined): T | undefined {
	return view?.starProfile?.imageId === imageId ? view?.starProfile : undefined
}

// Returns the measured star of a state, if any.
export function measuredStar(state: Pick<ImageStarProfileState, 'result'> | undefined) {
	return state?.result?.status === 'measured' ? state.result : undefined
}

// Returns the width and height of the half-power ellipse of a star, as its major and minor FWHM, in pixels, and its
// rotation clockwise from +X, in degrees; undefined when the shape of the star is unknown.
export function profileEllipse({ major, minor, theta }: Pick<StarProfileMeasurement, 'major' | 'minor' | 'theta'>) {
	return major === undefined || minor === undefined ? undefined : { rx: major / 2, ry: minor / 2, rotation: ((theta ?? 0) * 180) / Math.PI }
}

// Returns the RGBA pixels of a preview, in its rows, gray from black at low to white at high in normalized samples; a
// non-finite sample is transparent, so it never reads as a dark or bright pixel.
export function previewPixels({ samples }: Pick<StarProfilePreview, 'samples'>, low: number, high: number): Uint8ClampedArray<ArrayBuffer> {
	const pixels = new Uint8ClampedArray(samples.length * 4)
	const scale = 255 / Math.max(high - low, Number.EPSILON)

	for (let i = 0; i < samples.length; i++) {
		const sample = samples[i]
		if (sample === null) continue
		const level = (sample - low) * scale
		const at = i * 4
		pixels[at] = level
		pixels[at + 1] = level
		pixels[at + 2] = level
		pixels[at + 3] = 255
	}

	return pixels
}
