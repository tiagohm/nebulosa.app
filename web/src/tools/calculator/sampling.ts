import { airyDiskInPixels, airyDiskSize, classifyFWHMSampling, criticalFocusZone, type FWHMSamplingKind, fwhmPixelsToSeeing, recommendedFocalLength, samplingRatio } from 'nebulosa/src/astronomy/formulas'
import { isFraming, type OpticalConfiguration, resolveFraming } from '../../sky/framing'
import { newCheck, type OptionalOutcome, optional, optionalOutcome, type Outcome, outcome, POSITIVE, positiveText, ready, required } from './values'

// Sampling & Focus calculators. Sampling relates the seeing, a stellar FWHM in arcseconds, to the image scale: the
// FWHM in pixels it gives (or, inverted, the seeing a measured FWHM in pixels implies), its sampling class, and the
// focal length that would give a target FWHM in pixels. Diffraction & Focus gives the Airy disk and the critical focus
// zone of a focal ratio at a wavelength. Image scales are arcseconds per pixel, pixel sizes micrometers, wavelengths
// nanometers in the fields and micrometers for the formulas.

// Direction of the Sampling calculation: from the seeing, or from a FWHM measured in pixels.
export type SamplingMode = 'seeing' | 'fwhm'

// Fields of Sampling, as typed.
export interface SamplingDraft {
	// Direction of the calculation.
	readonly mode: SamplingMode
	// Image scale in arcseconds per pixel.
	readonly scale: string
	// Seeing as a stellar FWHM in arcseconds; read from the seeing.
	readonly seeing: string
	// Stellar FWHM measured in pixels; read from a FWHM.
	readonly fwhm: string
	// Pixel size in micrometers; optional, for the recommended focal length.
	readonly pixelSize: string
	// Target FWHM in pixels; optional, for the recommended focal length.
	readonly targetSampling: string
}

// Results of Sampling.
export interface SamplingResult {
	// Stellar FWHM in pixels.
	readonly fwhmPixels: number
	// Sampling class of that FWHM.
	readonly kind: FWHMSamplingKind
	// Seeing in arcseconds, entered or implied by the FWHM.
	readonly seeing: number
	// Focal length in millimeters that gives the target FWHM; absent while its fields are empty.
	readonly recommendedFocalLength: OptionalOutcome<number>
}

// Fields of Diffraction & Focus, as typed.
export interface DiffractionDraft {
	// Wavelength in nanometers.
	readonly wavelength: string
	// Focal ratio of the effective focal length.
	readonly focalRatio: string
	// Pixel size in micrometers; optional, for the Airy disk in pixels.
	readonly pixelSize: string
}

// Results of Diffraction & Focus.
export interface DiffractionResult {
	// Airy disk diameter, to the first dark ring, in micrometers.
	readonly airyDisk: number
	// Airy disk diameter in pixels; absent while the pixel size is empty.
	readonly airyDiskPixels: number | undefined
	// Critical focus zone in micrometers.
	readonly criticalFocusZone: number
}

// Returns the text of a positive number rounded to digits decimals; empty for a value that is not positive.
function roundedText(value: number | undefined, digits: number) {
	return value === undefined ? '' : positiveText(Number(value.toFixed(digits)))
}

// Returns the pixel size of an optical configuration's sensor; empty for a sensor given by its physical size.
function pixelSizeText(optics: Readonly<OpticalConfiguration>) {
	return optics.sensor.kind === 'pixels' ? positiveText(optics.sensor.pixelSize) : ''
}

// Returns the Sampling fields an optical configuration fills: its image scale and pixel size.
export function samplingFromOptics(optics: Readonly<OpticalConfiguration>): Pick<SamplingDraft, 'scale' | 'pixelSize'> {
	const framing = resolveFraming(optics)
	return { scale: isFraming(framing) ? roundedText(framing.scale, 3) : '', pixelSize: pixelSizeText(optics) }
}

// Example of Sampling: 2.5″ seeing on the 1.29″/px of the Imaging Setup example, aiming at 2.5 px.
export const SAMPLING_EXAMPLE: SamplingDraft = { mode: 'seeing', scale: '1.29', seeing: '2.5', fwhm: '', pixelSize: '3.76', targetSampling: '2.5' }

// Computes Sampling in its mode.
export function sampling(draft: SamplingDraft): Outcome<SamplingResult> {
	const check = newCheck()
	const scale = required(check, 'Image scale', draft.scale, POSITIVE)
	const seeing = draft.mode === 'seeing' ? required(check, 'Seeing', draft.seeing, POSITIVE) : Number.NaN
	const fwhm = draft.mode === 'fwhm' ? required(check, 'Measured FWHM', draft.fwhm, POSITIVE) : Number.NaN

	return outcome(check, () => {
		const fwhmPixels = draft.mode === 'seeing' ? samplingRatio(seeing, scale) : fwhm
		const actualSeeing = draft.mode === 'seeing' ? seeing : fwhmPixelsToSeeing(fwhm, scale)
		const recommended = optionalOutcome([draft.pixelSize, draft.targetSampling], (target) => {
			const pixelSize = required(target, 'Pixel size', draft.pixelSize, POSITIVE)
			const targetSampling = required(target, 'Target FWHM', draft.targetSampling, POSITIVE)
			return () => ready(recommendedFocalLength(pixelSize, targetSampling, actualSeeing))
		})

		return ready({ fwhmPixels, kind: classifyFWHMSampling(fwhmPixels), seeing: actualSeeing, recommendedFocalLength: recommended })
	})
}

// Returns the Diffraction & Focus fields an optical configuration fills: its effective focal ratio, when the aperture
// is known, and its pixel size.
export function diffractionFromOptics(optics: Readonly<OpticalConfiguration>): Pick<DiffractionDraft, 'focalRatio' | 'pixelSize'> {
	const framing = resolveFraming(optics)
	return { focalRatio: isFraming(framing) ? roundedText(framing.focalRatio, 2) : '', pixelSize: pixelSizeText(optics) }
}

// Example of Diffraction & Focus: green light at f/5 on 3.76 µm pixels.
export const DIFFRACTION_EXAMPLE: DiffractionDraft = { wavelength: '550', focalRatio: '5', pixelSize: '3.76' }

// Computes Diffraction & Focus.
export function diffraction(draft: DiffractionDraft): Outcome<DiffractionResult> {
	const check = newCheck()
	const wavelength = required(check, 'Wavelength', draft.wavelength, POSITIVE) / 1000
	const focalRatio = required(check, 'Focal ratio', draft.focalRatio, POSITIVE)
	const pixelSize = optional(check, 'Pixel size', draft.pixelSize, POSITIVE)

	return outcome(check, () => {
		const airyDisk = airyDiskSize(wavelength, focalRatio)
		return ready({ airyDisk, airyDiskPixels: pixelSize === undefined ? undefined : airyDiskInPixels(airyDisk, pixelSize), criticalFocusZone: criticalFocusZone(wavelength, focalRatio) })
	})
}
