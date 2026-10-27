import type { DebayerOperation, ImageProcessingOperation } from 'api'
import { Notice } from '../equipment-control/parts'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { Slider } from '../ui/Slider'
import { CLIPPING_LABELS, DEFAULT_MULTISCALE_LAYER, GRAYSCALE_CHANNEL_LABELS, MAX_MULTISCALE_LAYERS, NEUTRALIZATION_MODE_LABELS, type OperationOf } from './imageprocessing.catalog'

// Parameter forms of the Image Processing steps, one per operation, over the shared controls. Ranges follow what the
// toolkit accepts; a form only edits its step's operation, which Run sends.

// Patterns a debayer step can name, after auto (the trusted pattern of the image).
const DEBAYER_PATTERNS: readonly DebayerOperation['pattern'][] = ['auto', 'RGGB', 'BGGR', 'GBRG', 'GRBG', 'GRGB', 'GBGR', 'RGBG', 'BGRG']

// Channels a grayscale step can keep.
const GRAYSCALE_CHANNELS: readonly OperationOf<'grayscale'>['channel'][] = ['GRAY', 'RED', 'GREEN', 'BLUE']

// Neutralization modes, in selector order.
const NEUTRALIZATION_MODES: readonly OperationOf<'backgroundNeutralization'>['mode'][] = ['rescaleAsNeeded', 'rescale', 'truncate', 'targetBackground']

// Background extraction clipping modes, in selector order.
const CLIPPING_MODES: readonly OperationOf<'backgroundExtraction'>['clipping'][] = ['truncate', 'rescale', 'rescaleAsNeeded']

interface FormProps<T extends ImageProcessingOperation> {
	// Operation edited.
	readonly operation: T
	// Called with the edited operation.
	readonly onChange: (operation: T) => void
}

// Parameter form of a step's operation; an operation without parameters says what it does.
export function ProcessingStepForm({ operation, onChange }: FormProps<ImageProcessingOperation>) {
	switch (operation.type) {
		case 'debayer':
			return <DebayerForm operation={operation} onChange={onChange} />
		case 'backgroundExtraction':
			return <BackgroundExtractionForm operation={operation} onChange={onChange} />
		case 'backgroundNeutralization':
			return <BackgroundNeutralizationForm operation={operation} onChange={onChange} />
		case 'arcsinhStretch':
			return <ArcsinhStretchForm operation={operation} onChange={onChange} />
		case 'mlt':
		case 'mmt':
			return <MultiscaleForm operation={operation} onChange={onChange} />
		case 'gaussianBlur':
			return <GaussianBlurForm operation={operation} onChange={onChange} />
		case 'cosmeticCorrection':
			return <CosmeticCorrectionForm operation={operation} onChange={onChange} />
		case 'grayscale':
			return <Select label="Channel" options={GRAYSCALE_CHANNELS} value={operation.channel} format={(channel) => GRAYSCALE_CHANNEL_LABELS[channel]} onChange={(channel) => onChange({ ...operation, channel })} />
		case 'sharpen':
			return <Notice>Sharpens with a 3×3 kernel; no parameters.</Notice>
		case 'horizontalFlip':
		case 'verticalFlip':
			return <Notice>Mirrors the image, its WCS, and the phase of a CFA mosaic; no parameters.</Notice>
	}
}

// Pattern of a debayer step.
function DebayerForm({ operation, onChange }: FormProps<OperationOf<'debayer'>>) {
	return <Select label="CFA pattern" options={DEBAYER_PATTERNS} value={operation.pattern} format={(pattern) => (pattern === 'auto' ? 'Pattern of the image' : pattern)} onChange={(pattern) => onChange({ ...operation, pattern })} />
}

// Model, sampling, rejection, and correction of a background extraction step.
function BackgroundExtractionForm({ operation, onChange }: FormProps<OperationOf<'backgroundExtraction'>>) {
	const edit = (patch: Partial<OperationOf<'backgroundExtraction'>>) => onChange({ ...operation, ...patch })

	return (
		<>
			<SegmentedControl label="Model" options={['polynomial', 'thinPlateSpline'] as const} value={operation.model} format={(model) => (model === 'polynomial' ? 'Polynomial' : 'Spline')} onChange={(model) => edit({ model })} />
			{operation.model === 'polynomial' ? <NumberInput label="Degree" min={1} max={6} value={operation.degree} onChange={(degree) => edit({ degree })} /> : <Slider label="Smoothing" min={0} max={1} step={0.01} value={operation.smoothing} onChange={(smoothing) => edit({ smoothing })} />}
			<NumberInput label="Grid size" min={2} max={128} value={operation.gridSize} onChange={(gridSize) => edit({ gridSize })} />
			<Slider label="Tolerance (σ)" min={0} max={10} step={0.1} value={operation.tolerance} onChange={(tolerance) => edit({ tolerance })} />
			<Slider label="Rejection low (σ)" min={0} max={10} step={0.1} value={operation.rejectionLow} onChange={(rejectionLow) => edit({ rejectionLow })} />
			<Slider label="Rejection high (σ)" min={0} max={10} step={0.1} value={operation.rejectionHigh} onChange={(rejectionHigh) => edit({ rejectionHigh })} />
			<NumberInput label="Rejection iterations" min={0} max={10} value={operation.rejectionIterations} onChange={(rejectionIterations) => edit({ rejectionIterations })} />
			<SegmentedControl label="Color" options={['perChannel', 'luminance'] as const} value={operation.colorMode} format={(mode) => (mode === 'perChannel' ? 'Per channel' : 'Luminance')} onChange={(colorMode) => edit({ colorMode })} />
			<SegmentedControl label="Correction" options={['subtract', 'divide'] as const} value={operation.correction} format={(correction) => (correction === 'subtract' ? 'Subtract' : 'Divide')} onChange={(correction) => edit({ correction })} />
			<Select label="Clipping" options={CLIPPING_MODES} value={operation.clipping} format={(clipping) => CLIPPING_LABELS[clipping]} onChange={(clipping) => edit({ clipping })} />
			<Checkbox label="Target background" checked={operation.targetBackground !== undefined} onChange={(checked) => onChange(checked ? { ...operation, targetBackground: 0.1 } : withoutTarget(operation))} />
			{operation.targetBackground !== undefined && <Slider label="Target level" min={0} max={1} step={0.01} value={operation.targetBackground} onChange={(targetBackground) => edit({ targetBackground })} />}
			{operation.targetBackground === undefined && <Notice>The mean of the model is restored after the correction.</Notice>}
		</>
	)
}

// Returns a background extraction without a target background, which restores the mean of the model.
function withoutTarget({ targetBackground, ...operation }: OperationOf<'backgroundExtraction'>): OperationOf<'backgroundExtraction'> {
	return operation
}

// Reference range, target, and mode of a background neutralization step.
function BackgroundNeutralizationForm({ operation, onChange }: FormProps<OperationOf<'backgroundNeutralization'>>) {
	const edit = (patch: Partial<OperationOf<'backgroundNeutralization'>>) => onChange({ ...operation, ...patch })

	return (
		<>
			<Slider label="Lower limit" min={0} max={1} step={0.001} value={operation.lowerLimit} onChange={(lowerLimit) => edit({ lowerLimit })} />
			<Slider label="Upper limit" min={0} max={1} step={0.001} value={operation.upperLimit} onChange={(upperLimit) => edit({ upperLimit })} />
			<Select label="Mode" options={NEUTRALIZATION_MODES} value={operation.mode} format={(mode) => NEUTRALIZATION_MODE_LABELS[mode]} onChange={(mode) => edit({ mode })} />
			{operation.mode === 'targetBackground' && <Slider label="Target background" min={0} max={1} step={0.001} value={operation.targetBackground} onChange={(targetBackground) => edit({ targetBackground })} />}
		</>
	)
}

// Strength, black point, and colour handling of an arcsinh stretch step.
function ArcsinhStretchForm({ operation, onChange }: FormProps<OperationOf<'arcsinhStretch'>>) {
	const edit = (patch: Partial<OperationOf<'arcsinhStretch'>>) => onChange({ ...operation, ...patch })

	return (
		<>
			<Slider label="Stretch factor" min={1} max={1000} step={1} value={operation.stretchFactor} onChange={(stretchFactor) => edit({ stretchFactor })} />
			<Slider label="Black point" min={0} max={0.5} step={0.001} value={operation.blackPoint} onChange={(blackPoint) => edit({ blackPoint })} />
			<Checkbox label="Protect highlights" checked={operation.protectHighlights} onChange={(protectHighlights) => edit({ protectHighlights })} />
			<Checkbox label="BT.709 luminance (RGB)" checked={operation.useRgbWorkingSpace} onChange={(useRgbWorkingSpace) => edit({ useRgbWorkingSpace })} />
		</>
	)
}

// Layers, per-layer denoising and gain, and residual gain of a multiscale transform step.
function MultiscaleForm({ operation, onChange }: FormProps<OperationOf<'mlt' | 'mmt'>>) {
	const edit = (patch: Partial<OperationOf<'mlt' | 'mmt'>>) => onChange({ ...operation, ...patch })
	const layers = Array.from({ length: operation.layers }, (_, i) => ({ ...DEFAULT_MULTISCALE_LAYER, ...operation.detailLayers[i] }))

	// Replaces the parameters of one layer, filling the layers before it with their defaults.
	function editLayer(index: number, patch: Partial<typeof DEFAULT_MULTISCALE_LAYER>) {
		edit({ detailLayers: layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)) })
	}

	return (
		<>
			<NumberInput label="Layers" min={1} max={MAX_MULTISCALE_LAYERS} value={operation.layers} onChange={(count) => edit({ layers: count, detailLayers: operation.detailLayers.slice(0, count) })} />
			{layers.map((layer, i) => (
				<div key={i} className="flex flex-col gap-2 border-t border-line-100 pt-2">
					<h4 className="m-0 text-xs font-medium text-ink-100">
						Layer {i + 1} · {2 ** i} px
					</h4>
					<Slider label="Threshold (σ)" min={0} max={10} step={0.1} value={layer.threshold} onChange={(threshold) => editLayer(i, { threshold })} />
					<Slider label="Amount" min={0} max={1} step={0.01} value={layer.amount} onChange={(amount) => editLayer(i, { amount })} />
					<Slider label="Bias" min={-1} max={4} step={0.01} value={layer.bias} onChange={(bias) => editLayer(i, { bias })} />
				</div>
			))}
			<Slider label="Residual gain" min={0} max={2} step={0.01} value={operation.residualGain} onChange={(residualGain) => edit({ residualGain })} />
		</>
	)
}

// Sigma and kernel size of a Gaussian blur step.
function GaussianBlurForm({ operation, onChange }: FormProps<OperationOf<'gaussianBlur'>>) {
	return (
		<>
			<Slider label="Sigma (px)" min={0.5} max={5} step={0.1} value={operation.sigma} onChange={(sigma) => onChange({ ...operation, sigma })} />
			<NumberInput label="Kernel size" min={3} max={31} step={2} suffix="px" value={operation.size} onChange={(size) => onChange({ ...operation, size: size % 2 === 1 ? size : size + 1 })} />
		</>
	)
}

// Detection thresholds, window, and amount of a cosmetic correction step.
function CosmeticCorrectionForm({ operation, onChange }: FormProps<OperationOf<'cosmeticCorrection'>>) {
	const edit = (patch: Partial<OperationOf<'cosmeticCorrection'>>) => onChange({ ...operation, ...patch })

	return (
		<>
			<Slider label="Hot pixels (σ)" min={0} max={10} step={0.1} value={operation.hotSigma} onChange={(hotSigma) => edit({ hotSigma })} />
			<Slider label="Cold pixels (σ)" min={0} max={10} step={0.1} value={operation.coldSigma} onChange={(coldSigma) => edit({ coldSigma })} />
			<NumberInput label="Window radius" min={1} max={5} suffix="px" value={operation.windowRadius} onChange={(windowRadius) => edit({ windowRadius })} />
			<Slider label="Amount" min={0} max={1} step={0.01} value={operation.amount} onChange={(amount) => edit({ amount })} />
			<Notice>0 σ disables the detection of that kind of pixel.</Notice>
		</>
	)
}
