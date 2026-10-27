import { mosaicPanelCount, sensorDiagonalFov } from 'nebulosa/src/astronomy/formulas'
import { toArcmin } from 'nebulosa/src/math/units/angle'
import { DEFAULT_OPTICS, type Framing, isFraming, type OpticalConfiguration, resolveFraming, type SensorGeometry } from '../../sky/framing'
import { between, newCheck, optional, type Outcome, outcome, POSITIVE, POSITIVE_INTEGER, positiveText, ready, required } from './values'

// Optics & Field of View calculators. Imaging Setup resolves a telescope or lens with a camera through resolveFraming,
// the convention of Sky Framing (2·atan(d / 2F) per axis, the reducer or Barlow factor applied once to the native focal
// length), and adds the diagonal field. Mosaic Estimator counts the panels of a rectangular mosaic along each axis
// with mosaicPanelCount. Lengths are millimeters, pixel sizes micrometers, angles radians in results and arcminutes in
// the mosaic fields.

// How the sensor of Imaging Setup is entered.
export type SensorKind = SensorGeometry['kind']

// Fields of Imaging Setup, as typed.
export interface ImagingSetupDraft {
	// Native focal length in millimeters.
	readonly focalLength: string
	// Reducer (below 1) or Barlow (above 1) factor.
	readonly focalMultiplier: string
	// Aperture in millimeters; optional.
	readonly aperture: string
	// Whether the sensor is given by its pixels or its physical size.
	readonly sensorKind: SensorKind
	// Width in pixels.
	readonly width: string
	// Height in pixels.
	readonly height: string
	// Pixel size in micrometers.
	readonly pixelSize: string
	// Sensor width in millimeters.
	readonly sensorWidth: string
	// Sensor height in millimeters.
	readonly sensorHeight: string
}

// Results of Imaging Setup.
export interface ImagingSetupResult {
	// Field of view, sensor size, effective focal length, image scale, and focal ratio, as resolveFraming gives them.
	readonly framing: Framing
	// Diagonal field of view in radians.
	readonly diagonal: number
}

// Fields of Mosaic Estimator, as typed.
export interface MosaicDraft {
	// Angular width of the target in arcminutes.
	readonly targetWidth: string
	// Angular height of the target in arcminutes.
	readonly targetHeight: string
	// Angular width of one panel's field in arcminutes.
	readonly fieldWidth: string
	// Angular height of one panel's field in arcminutes.
	readonly fieldHeight: string
	// Overlap of adjacent panels in percent of the field, [0, 100).
	readonly overlap: string
}

// Panel counts of Mosaic Estimator.
export interface MosaicResult {
	// Panels along the width.
	readonly columns: number
	// Panels along the height.
	readonly rows: number
	// Total panels.
	readonly panels: number
}

// Returns the text of a positive number rounded to digits decimals; empty for a value that is not positive.
function roundedText(value: number, digits: number) {
	return positiveText(Number(value.toFixed(digits)))
}

// Returns the Imaging Setup fields of an optical configuration. A sensor given by its pixels also fills its physical
// size; a sensor given by its physical size leaves the pixels empty, since its pixel size is unknown.
export function imagingSetupFromOptics(optics: Readonly<OpticalConfiguration>): ImagingSetupDraft {
	const { sensor } = optics
	const pixels = sensor.kind === 'pixels'

	return {
		focalLength: positiveText(optics.focalLength),
		focalMultiplier: positiveText(optics.focalMultiplier),
		aperture: positiveText(optics.aperture),
		sensorKind: sensor.kind,
		width: pixels ? positiveText(sensor.width) : '',
		height: pixels ? positiveText(sensor.height) : '',
		pixelSize: pixels ? positiveText(sensor.pixelSize) : '',
		sensorWidth: pixels ? roundedText((sensor.width * sensor.pixelSize) / 1000, 3) : positiveText(sensor.width),
		sensorHeight: pixels ? roundedText((sensor.height * sensor.pixelSize) / 1000, 3) : positiveText(sensor.height),
	}
}

// Example of Imaging Setup: the default optics of a new Sky Framing preset.
export const IMAGING_SETUP_EXAMPLE: ImagingSetupDraft = imagingSetupFromOptics(DEFAULT_OPTICS)

// Computes Imaging Setup. The aperture is optional and only gives the focal ratio; a sensor given by its physical size
// gives no image scale.
export function imagingSetup(draft: ImagingSetupDraft): Outcome<ImagingSetupResult> {
	const check = newCheck()
	const focalLength = required(check, 'Focal length', draft.focalLength, POSITIVE)
	const focalMultiplier = required(check, 'Reducer / Barlow factor', draft.focalMultiplier, POSITIVE)
	const aperture = optional(check, 'Aperture', draft.aperture, POSITIVE)
	const sensor: SensorGeometry =
		draft.sensorKind === 'pixels'
			? { kind: 'pixels', width: required(check, 'Width', draft.width, POSITIVE_INTEGER), height: required(check, 'Height', draft.height, POSITIVE_INTEGER), pixelSize: required(check, 'Pixel size', draft.pixelSize, POSITIVE) }
			: { kind: 'physical', width: required(check, 'Sensor width', draft.sensorWidth, POSITIVE), height: required(check, 'Sensor height', draft.sensorHeight, POSITIVE) }

	return outcome(check, () => {
		const framing = resolveFraming({ focalLength, focalMultiplier, aperture: aperture ?? 0, sensor, rotation: 0 })
		if (!isFraming(framing)) return { status: 'incomplete', missing: framing.missing }
		return ready({ framing, diagonal: sensorDiagonalFov(Math.hypot(framing.sensorWidth, framing.sensorHeight), framing.effectiveFocalLength) })
	})
}

// Returns the Mosaic Estimator field of one panel from an optical configuration, in arcminutes; empty when the
// configuration lacks what its field needs.
export function mosaicFromOptics(optics: Readonly<OpticalConfiguration>): Pick<MosaicDraft, 'fieldWidth' | 'fieldHeight'> {
	const framing = resolveFraming(optics)
	if (!isFraming(framing)) return { fieldWidth: '', fieldHeight: '' }
	return { fieldWidth: roundedText(toArcmin(framing.width), 2), fieldHeight: roundedText(toArcmin(framing.height), 2) }
}

// Example of Mosaic Estimator: a 4° × 2° target, about the Andromeda Galaxy with its halo, with the field of the
// Imaging Setup example and a 15 % overlap.
export const MOSAIC_EXAMPLE: MosaicDraft = { targetWidth: '240', targetHeight: '120', ...mosaicFromOptics(DEFAULT_OPTICS), overlap: '15' }

// Computes Mosaic Estimator: the panels along each axis cover the target with the overlap, ceil(target / (field ·
// (1 − overlap))); the panels are aligned with the target and never rotated.
export function mosaic(draft: MosaicDraft): Outcome<MosaicResult> {
	const check = newCheck()
	const targetWidth = required(check, 'Target width', draft.targetWidth, POSITIVE)
	const targetHeight = required(check, 'Target height', draft.targetHeight, POSITIVE)
	const fieldWidth = required(check, 'Field width', draft.fieldWidth, POSITIVE)
	const fieldHeight = required(check, 'Field height', draft.fieldHeight, POSITIVE)
	const overlap = required(check, 'Overlap', draft.overlap, between(0, 100, false, true))

	return outcome(check, () => {
		const columns = mosaicPanelCount(targetWidth, fieldWidth, overlap / 100)
		const rows = mosaicPanelCount(targetHeight, fieldHeight, overlap / 100)
		return ready({ columns, rows, panels: columns * rows })
	})
}
