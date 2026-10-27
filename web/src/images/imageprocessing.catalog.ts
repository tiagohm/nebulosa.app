import type { ImageInfo, ImageProcessingOperation, ImageProcessingOperationType, ImageProcessingStep } from 'api'

// Catalog of the operations of the Image Processing tool: how each one is named, grouped in the Add Operation
// selector, created with the toolkit's defaults, and summarized on its collapsed card, and what each step makes of
// the channels and CFA pattern of the image it receives (pipelineIssue), so Run is disabled with the reason before
// the server refuses the pipeline. The server checks the same rules (checkPipeline of the API) and stays the
// authority.

// Operation of a type: the variant whose type includes it (MLT and MMT, or the operations without parameters, share
// one).
export type OperationOf<T extends ImageProcessingOperationType> = ImageProcessingOperation extends infer O ? (O extends ImageProcessingOperation ? (T extends O['type'] ? O : never) : never) : never

// Presentation of an operation type.
interface OperationDefinition<T extends ImageProcessingOperationType> {
	// Name of the operation.
	readonly label: string
	// Heading of its group in the Add Operation selector.
	readonly group: string
	// Returns a new operation with the toolkit's default parameters.
	readonly create: () => OperationOf<T>
	// Returns the most telling parameters of an operation, for its collapsed card.
	readonly summary: (operation: OperationOf<T>) => string
}

// Returns a number with at most three decimals, without trailing zeros.
function formatNumber(value: number): string {
	return String(Number(value.toFixed(3)))
}

// Names of the channels a grayscale step keeps.
export const GRAYSCALE_CHANNEL_LABELS: Readonly<Record<OperationOf<'grayscale'>['channel'], string>> = { GRAY: 'Luminance (BT.709)', RED: 'Red', GREEN: 'Green', BLUE: 'Blue' }

// Names of the background neutralization modes.
export const NEUTRALIZATION_MODE_LABELS: Readonly<Record<OperationOf<'backgroundNeutralization'>['mode'], string>> = { targetBackground: 'Target background', rescale: 'Rescale', rescaleAsNeeded: 'Rescale as needed', truncate: 'Truncate' }

// Names of the background extraction clipping modes.
export const CLIPPING_LABELS: Readonly<Record<OperationOf<'backgroundExtraction'>['clipping'], string>> = { truncate: 'Truncate', rescale: 'Rescale', rescaleAsNeeded: 'Rescale as needed' }

// Default layer of a multiscale transform: no denoising, unit gain (the toolkit's DEFAULT_MLT_LAYER_OPTIONS and
// DEFAULT_MMT_LAYER_OPTIONS).
export const DEFAULT_MULTISCALE_LAYER: OperationOf<'mlt'>['detailLayers'][number] = { threshold: 0, amount: 1, bias: 0 }

// Most detail layers the editor offers for a multiscale transform; each one doubles the scale of the previous.
export const MAX_MULTISCALE_LAYERS = 8

// Every operation type, by type.
export const OPERATIONS: { readonly [T in ImageProcessingOperationType]: OperationDefinition<T> } = {
	debayer: {
		label: 'Debayer',
		group: 'Color Reconstruction',
		create: () => ({ type: 'debayer', pattern: 'auto' }),
		summary: ({ pattern }) => (pattern === 'auto' ? 'Pattern of the image' : `Pattern ${pattern}`),
	},
	backgroundExtraction: {
		label: 'Background Extraction',
		group: 'Background',
		create: () => ({ type: 'backgroundExtraction', model: 'polynomial', degree: 4, smoothing: 0.1, gridSize: 24, tolerance: 3, rejectionLow: 4, rejectionHigh: 2.5, rejectionIterations: 2, colorMode: 'perChannel', correction: 'subtract', clipping: 'truncate' }),
		summary: ({ model, degree, correction, gridSize }) => `${model === 'polynomial' ? `Polynomial ${degree}` : 'Thin-plate spline'} · ${correction === 'subtract' ? 'Subtract' : 'Divide'} · grid ${gridSize}`,
	},
	backgroundNeutralization: {
		label: 'Background Neutralization',
		group: 'Background',
		create: () => ({ type: 'backgroundNeutralization', lowerLimit: 0, upperLimit: 1, targetBackground: 0.05, mode: 'rescaleAsNeeded' }),
		summary: ({ lowerLimit, upperLimit, mode }) => `Reference ${formatNumber(lowerLimit)}–${formatNumber(upperLimit)} · ${NEUTRALIZATION_MODE_LABELS[mode]}`,
	},
	arcsinhStretch: {
		label: 'Arcsinh Stretch',
		group: 'Stretch',
		create: () => ({ type: 'arcsinhStretch', stretchFactor: 1, blackPoint: 0, protectHighlights: false, useRgbWorkingSpace: false }),
		summary: ({ stretchFactor, blackPoint }) => `Factor ${formatNumber(stretchFactor)} · black ${formatNumber(blackPoint)}`,
	},
	mlt: {
		label: 'Multiscale Linear Transform',
		group: 'Noise and Details',
		create: () => ({ type: 'mlt', layers: 3, detailLayers: [], residualGain: 1 }),
		summary: ({ layers, residualGain }) => `${layers} layers · residual ×${formatNumber(residualGain)}`,
	},
	mmt: {
		label: 'Multiscale Median Transform',
		group: 'Noise and Details',
		create: () => ({ type: 'mmt', layers: 3, detailLayers: [], residualGain: 1 }),
		summary: ({ layers, residualGain }) => `${layers} layers · residual ×${formatNumber(residualGain)}`,
	},
	gaussianBlur: {
		label: 'Gaussian Blur',
		group: 'Spatial Filters',
		create: () => ({ type: 'gaussianBlur', sigma: 1.4, size: 5 }),
		summary: ({ sigma, size }) => `σ ${formatNumber(sigma)} px · ${size}×${size}`,
	},
	sharpen: {
		label: 'Sharpen',
		group: 'Spatial Filters',
		create: () => ({ type: 'sharpen' }),
		summary: () => '3×3 kernel',
	},
	cosmeticCorrection: {
		label: 'Cosmetic Correction',
		group: 'Sensor Defects',
		create: () => ({ type: 'cosmeticCorrection', hotSigma: 3, coldSigma: 3, windowRadius: 1, amount: 1 }),
		summary: ({ hotSigma, coldSigma, windowRadius }) => `Hot ${formatNumber(hotSigma)}σ · cold ${formatNumber(coldSigma)}σ · radius ${windowRadius}`,
	},
	horizontalFlip: {
		label: 'Horizontal Flip',
		group: 'Geometry',
		create: () => ({ type: 'horizontalFlip' }),
		summary: () => 'Mirrors left and right',
	},
	verticalFlip: {
		label: 'Vertical Flip',
		group: 'Geometry',
		create: () => ({ type: 'verticalFlip' }),
		summary: () => 'Mirrors top and bottom',
	},
	grayscale: {
		label: 'Grayscale',
		group: 'Channels',
		create: () => ({ type: 'grayscale', channel: 'GRAY' }),
		summary: ({ channel }) => GRAYSCALE_CHANNEL_LABELS[channel],
	},
}

// Operation types in the order of the Add Operation selector, each group consecutive.
export const OPERATION_TYPES = Object.keys(OPERATIONS) as readonly ImageProcessingOperationType[]

// Operation the Add Operation selector starts on.
export const DEFAULT_ADDED_OPERATION: ImageProcessingOperationType = 'debayer'

// Returns the name of an operation type.
export function operationLabel(type: ImageProcessingOperationType): string {
	return OPERATIONS[type].label
}

// Returns a new operation of a type with its defaults.
export function createOperation<T extends ImageProcessingOperationType>(type: T): OperationOf<T> {
	return OPERATIONS[type].create()
}

// Returns the summary of an operation.
export function operationSummary(operation: ImageProcessingOperation): string {
	return (OPERATIONS[operation.type].summary as (operation: ImageProcessingOperation) => string)(operation)
}

// Channels and CFA pattern of an image (ImageInfo channels and cfa).
export interface ImageShape {
	// Number of channels: 1 for grayscale or a raw CFA mosaic, 3 for RGB.
	readonly channels: number
	// Trusted CFA pattern of a raw mosaic; absent otherwise.
	readonly cfa?: ImageInfo['cfa']
}

// A step that cannot apply to the image it would receive, and why.
export interface PipelineIssue {
	// Id of the step.
	readonly stepId: string
	// Why, for people.
	readonly error: string
}

// Operations with a defined meaning on a raw CFA mosaic: they follow the colour phases (cosmetic correction), keep
// them in phase (flips), or turn the mosaic into RGB (debayer).
const CFA_OPERATIONS: ReadonlySet<ImageProcessingOperationType> = new Set(['debayer', 'cosmeticCorrection', 'horizontalFlip', 'verticalFlip'])

// Returns the first step that cannot apply to the image it would receive, following what each step makes of the
// channels and CFA pattern of image, as the server checks it: debayer needs a mono image and a pattern (the trusted one
// for auto) and makes RGB; grayscale makes mono; background neutralization needs RGB; a raw CFA mosaic takes only
// CFA_OPERATIONS. Returns undefined when every step applies.
export function pipelineIssue(image: ImageShape, steps: readonly ImageProcessingStep[]): PipelineIssue | undefined {
	let { channels, cfa } = image

	for (const { id, operation } of steps) {
		if (channels === 1 && cfa !== undefined && !CFA_OPERATIONS.has(operation.type)) return { stepId: id, error: `${operationLabel(operation.type)} cannot apply to a raw CFA mosaic; debayer it first.` }

		if (operation.type === 'debayer') {
			if (channels !== 1) return { stepId: id, error: 'Debayer needs a mono CFA mosaic.' }
			if (operation.pattern === 'auto' && cfa === undefined) return { stepId: id, error: 'The image has no known CFA pattern; choose one to debayer it.' }
			channels = 3
			cfa = undefined
		} else if (operation.type === 'backgroundNeutralization') {
			if (channels !== 3) return { stepId: id, error: 'Background Neutralization needs an RGB image.' }
		} else if (operation.type === 'grayscale') {
			channels = 1
		}
	}

	return undefined
}
