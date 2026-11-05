import { formatDegrees, formatFixed } from '../../format'
import { formatAngularSize } from '../../sky/format'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { CalculatorLayout, type CalculatorViewProps, DraftBar, FieldGrid, Formula, FormulaNotes, NumberField, OutcomeView, Primary } from './CalculatorParts'
import { IMAGING_SETUP_EXAMPLE, type ImagingSetupDraft, imagingSetup, imagingSetupFromOptics, MOSAIC_EXAMPLE, type MosaicDraft, mosaic, mosaicFromOptics, type SensorKind } from './optics'

// Views of the Optics & Field of View calculators: Imaging Setup and Mosaic Estimator.

// Sensor kinds in display order.
const SENSOR_KINDS: readonly SensorKind[] = ['pixels', 'physical']

// Imaging Setup calculator.
export function ImagingSetupCalculator({ entry, onChange, context }: CalculatorViewProps<ImagingSetupDraft>) {
	const { draft } = entry
	const result = imagingSetup(draft)

	// Changes one field of the draft.
	function set(next: Partial<ImagingSetupDraft>) {
		onChange({ ...entry, draft: { ...draft, ...next } })
	}

	return (
		<CalculatorLayout
			bar={<DraftBar entry={entry} onChange={onChange} context={context} example={IMAGING_SETUP_EXAMPLE} fromOptics={imagingSetupFromOptics} />}
			inputs={
				<>
					<FieldGrid>
						<NumberField label="Focal length (native)" suffix="mm" value={draft.focalLength} onChange={(focalLength) => set({ focalLength })} />
						<NumberField label="Reducer / Barlow" suffix="×" value={draft.focalMultiplier} onChange={(focalMultiplier) => set({ focalMultiplier })} />
						<NumberField label="Aperture" suffix="mm" optional value={draft.aperture} onChange={(aperture) => set({ aperture })} />
					</FieldGrid>
					<SegmentedControl label="Sensor" options={SENSOR_KINDS} value={draft.sensorKind} onChange={(sensorKind) => set({ sensorKind })} format={(kind) => (kind === 'pixels' ? 'Resolution' : 'Physical size')} />
					<FieldGrid>
						{draft.sensorKind === 'pixels' ? (
							<>
								<NumberField label="Width" suffix="px" value={draft.width} onChange={(width) => set({ width })} />
								<NumberField label="Height" suffix="px" value={draft.height} onChange={(height) => set({ height })} />
								<NumberField label="Pixel size" suffix="µm" value={draft.pixelSize} onChange={(pixelSize) => set({ pixelSize })} />
							</>
						) : (
							<>
								<NumberField label="Sensor width" suffix="mm" value={draft.sensorWidth} onChange={(sensorWidth) => set({ sensorWidth })} />
								<NumberField label="Sensor height" suffix="mm" value={draft.sensorHeight} onChange={(sensorHeight) => set({ sensorHeight })} />
							</>
						)}
					</FieldGrid>
					<Notice>The focal length is the native one; the reducer or Barlow factor is applied to it once (1 without).</Notice>
				</>
			}
			results={
				<OutcomeView outcome={result}>
					{({ framing, diagonal }) => (
						<>
							<Primary label="Field of view">
								{formatAngularSize(framing.width)} × {formatAngularSize(framing.height)}
							</Primary>
							<DataRow label="Field (degrees)">
								{formatDegrees(framing.width, 3)} × {formatDegrees(framing.height, 3)}
							</DataRow>
							<DataRow label="Diagonal">{formatDegrees(diagonal, 3)}</DataRow>
							<DataRow label="Image scale">{framing.scale === undefined ? <span className="text-xs text-ink-300">Needs the pixel size: enter the sensor by resolution.</span> : `${formatFixed(framing.scale, 2)}″/px`}</DataRow>
							<DataRow label="Effective focal length">{formatFixed(framing.effectiveFocalLength, 0)} mm</DataRow>
							<DataRow label="Focal ratio">{framing.focalRatio === undefined ? <span className="text-xs text-ink-300">Needs the aperture.</span> : `f/${formatFixed(framing.focalRatio, 1)}`}</DataRow>
							<DataRow label="Sensor">
								{formatFixed(framing.sensorWidth, 2)} × {formatFixed(framing.sensorHeight, 2)} mm
							</DataRow>
						</>
					)}
				</OutcomeView>
			}
			notes={
				<FormulaNotes>
					<Formula>
						F = F_native × factor{'\n'}FOV = 2·atan(d / 2F){'\n'}scale = 206.265 × pixel / F
					</Formula>
					<p className="m-0">d is the sensor width, height, or diagonal in millimeters, F the effective focal length in millimeters, and the pixel size in micrometers gives the scale in arcseconds per pixel. The focal ratio is F divided by the aperture.</p>
					<p className="m-0">This is the geometric field of a flat sensor, the same Sky Framing draws; the small-angle d / F differs from it only for wide fields. Distortion, vignetting, and the image circle of the optics are not modeled, and the rotation of the camera does not change the field.</p>
				</FormulaNotes>
			}
		/>
	)
}

// Mosaic Estimator calculator.
export function MosaicCalculator({ entry, onChange, context }: CalculatorViewProps<MosaicDraft>) {
	const { draft } = entry
	const result = mosaic(draft)

	// Changes one field of the draft.
	function set(next: Partial<MosaicDraft>) {
		onChange({ ...entry, draft: { ...draft, ...next } })
	}

	return (
		<CalculatorLayout
			bar={<DraftBar entry={entry} onChange={onChange} context={context} example={MOSAIC_EXAMPLE} fromOptics={mosaicFromOptics} />}
			inputs={
				<>
					<FieldGrid>
						<NumberField label="Target width" suffix="′" value={draft.targetWidth} onChange={(targetWidth) => set({ targetWidth })} />
						<NumberField label="Target height" suffix="′" value={draft.targetHeight} onChange={(targetHeight) => set({ targetHeight })} />
						<NumberField label="Field width" suffix="′" value={draft.fieldWidth} onChange={(fieldWidth) => set({ fieldWidth })} />
						<NumberField label="Field height" suffix="′" value={draft.fieldHeight} onChange={(fieldHeight) => set({ fieldHeight })} />
						<NumberField label="Overlap" suffix="%" value={draft.overlap} onChange={(overlap) => set({ overlap })} />
					</FieldGrid>
					<Notice>Angles in arcminutes. Importing fills the field of one panel from the optics.</Notice>
				</>
			}
			results={
				<OutcomeView outcome={result}>
					{({ columns, rows, panels }) => (
						<>
							<Primary label="Panels">{panels}</Primary>
							<DataRow label="Grid">
								{columns} × {rows}
							</DataRow>
						</>
					)}
				</OutcomeView>
			}
			notes={
				<FormulaNotes>
					<Formula>panels per axis = ceil(target / (field × (1 − overlap)))</Formula>
					<p className="m-0">A rectangular planning estimate: the panels are aligned with the target and with each other, and their count is the product of both axes. It does not optimize the layout, rotate the camera, or account for the convergence of the panels away from the celestial equator.</p>
				</FormulaNotes>
			}
		/>
	)
}
