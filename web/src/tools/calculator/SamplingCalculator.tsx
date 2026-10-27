import type { FWHMSamplingKind } from 'nebulosa/src/astronomy/formulas'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { CalculatorLayout, type CalculatorViewProps, Datum, DraftBar, FieldGrid, Formula, FormulaNotes, Note, NumberField, OptionalDatum, OutcomeView, Primary } from './CalculatorParts'
import { DIFFRACTION_EXAMPLE, type DiffractionDraft, diffraction, diffractionFromOptics, SAMPLING_EXAMPLE, type SamplingDraft, type SamplingMode, sampling, samplingFromOptics } from './sampling'
import { formatFixed } from './values'

// Views of the Sampling & Focus calculators: Sampling and Diffraction & Focus.

// Sampling modes in display order.
const SAMPLING_MODES: readonly SamplingMode[] = ['seeing', 'fwhm']

// Display name of each sampling class.
const SAMPLING_KIND_LABELS: Readonly<Record<FWHMSamplingKind, string>> = {
	undersampled: 'Undersampled (below 2 px)',
	optimal: 'Within 2–3 px',
	oversampled: 'Oversampled (above 3 px)',
}

// Sampling calculator.
export function SamplingCalculator({ entry, onChange, context }: CalculatorViewProps<SamplingDraft>) {
	const { draft } = entry
	const result = sampling(draft)

	// Changes one field of the draft.
	function set(next: Partial<SamplingDraft>) {
		onChange({ ...entry, draft: { ...draft, ...next } })
	}

	return (
		<CalculatorLayout
			bar={<DraftBar entry={entry} onChange={onChange} context={context} example={SAMPLING_EXAMPLE} fromOptics={samplingFromOptics} />}
			inputs={
				<>
					<SegmentedControl label="Compute from" options={SAMPLING_MODES} value={draft.mode} onChange={(mode) => set({ mode })} format={(mode) => (mode === 'seeing' ? 'Seeing' : 'Measured FWHM')} />
					<FieldGrid>
						<NumberField label="Image scale" suffix="″/px" value={draft.scale} onChange={(scale) => set({ scale })} />
						{draft.mode === 'seeing' ? <NumberField label="Seeing (FWHM)" suffix="″" value={draft.seeing} onChange={(seeing) => set({ seeing })} /> : <NumberField label="Measured FWHM" suffix="px" value={draft.fwhm} onChange={(fwhm) => set({ fwhm })} />}
						<NumberField label="Pixel size" suffix="µm" optional value={draft.pixelSize} onChange={(pixelSize) => set({ pixelSize })} />
						<NumberField label="Target FWHM" suffix="px" optional value={draft.targetSampling} onChange={(targetSampling) => set({ targetSampling })} />
					</FieldGrid>
					<Note>{draft.mode === 'seeing' ? 'The seeing is the FWHM of a star in arcseconds, not its HFD.' : 'The FWHM of stars measured on a frame, in pixels; an HFD is a different measure.'} The pixel size and target FWHM give the focal length for that sampling.</Note>
				</>
			}
			results={
				<OutcomeView outcome={result}>
					{({ fwhmPixels, kind, seeing, recommendedFocalLength }) => (
						<>
							<Primary label="Stellar FWHM">{formatFixed(fwhmPixels, 2)} px</Primary>
							<Datum label="Sampling">{SAMPLING_KIND_LABELS[kind]}</Datum>
							{draft.mode === 'fwhm' && <Datum label="Seeing">{formatFixed(seeing, 2)}″</Datum>}
							<OptionalDatum label="Focal length for the target" outcome={recommendedFocalLength} hint="Enter the pixel size and a target FWHM.">
								{(focalLength) => `${formatFixed(focalLength, 0)} mm`}
							</OptionalDatum>
						</>
					)}
				</OutcomeView>
			}
			notes={
				<FormulaNotes>
					<Formula>
						FWHM_px = seeing / scale{'\n'}seeing = FWHM_px × scale{'\n'}F = 206.265 × pixel × FWHM_px / seeing
					</Formula>
					<p className="m-0">The seeing and the image scale are in arcseconds; the pixel size in micrometers gives the focal length F in millimeters.</p>
					<p className="m-0">A FWHM of 2 to 3 px is a common rule of thumb for imaging, not an absolute optimum: guiding, optics, and processing shift it, and it does not guarantee image quality.</p>
				</FormulaNotes>
			}
		/>
	)
}

// Diffraction & Focus calculator.
export function DiffractionCalculator({ entry, onChange, context }: CalculatorViewProps<DiffractionDraft>) {
	const { draft } = entry
	const result = diffraction(draft)

	// Changes one field of the draft.
	function set(next: Partial<DiffractionDraft>) {
		onChange({ ...entry, draft: { ...draft, ...next } })
	}

	return (
		<CalculatorLayout
			bar={<DraftBar entry={entry} onChange={onChange} context={context} example={DIFFRACTION_EXAMPLE} fromOptics={diffractionFromOptics} />}
			inputs={
				<>
					<FieldGrid>
						<NumberField label="Wavelength" suffix="nm" value={draft.wavelength} onChange={(wavelength) => set({ wavelength })} />
						<NumberField label="Focal ratio (f/)" value={draft.focalRatio} onChange={(focalRatio) => set({ focalRatio })} />
						<NumberField label="Pixel size" suffix="µm" optional value={draft.pixelSize} onChange={(pixelSize) => set({ pixelSize })} />
					</FieldGrid>
					<Note>550 nm is green light, near the eye&apos;s peak; Hα is 656.3 nm. The focal ratio is that of the effective focal length; importing needs the aperture.</Note>
				</>
			}
			results={
				<OutcomeView outcome={result}>
					{({ airyDisk, airyDiskPixels, criticalFocusZone }) => (
						<>
							<Primary label="Airy disk">{formatFixed(airyDisk, 2)} µm</Primary>
							<Datum label="Airy disk on the sensor">{airyDiskPixels === undefined ? <span className="font-sans text-xs text-ink-300">Enter the pixel size.</span> : `${formatFixed(airyDiskPixels, 2)} px`}</Datum>
							<Datum label="Critical focus zone">{formatFixed(criticalFocusZone, 1)} µm</Datum>
						</>
					)}
				</OutcomeView>
			}
			notes={
				<FormulaNotes>
					<Formula>Airy = 2.44 × λ × N{'\n'}CFZ ≈ 4.88 × λ × N²</Formula>
					<p className="m-0">λ is the wavelength in micrometers and N the focal ratio; the Airy disk is the diameter to the first dark ring in micrometers, and the critical focus zone is in micrometers of focuser travel.</p>
					<p className="m-0">Both assume perfect, unobstructed optics at one wavelength. Seeing usually makes stars far larger than the Airy disk, and this approximation of the focus zone ignores the seeing and the sensor; it is a first estimate of the focus tolerance.</p>
				</FormulaNotes>
			}
		/>
	)
}
