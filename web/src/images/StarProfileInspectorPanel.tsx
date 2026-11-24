import type { SampleConversion, StarProfileMeasured, StarProfileNoStarReason } from 'api'
import type { MoffatFitFailureReason } from 'nebulosa/src/imaging/stars/profile.moffat'
import { toArcsec } from 'nebulosa/src/math/units/angle'
import { useSnapshot } from 'valtio'
import { formatDegrees, formatFixed, formatPixelLength, formatPixelPosition, MISSING } from '../format'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { isotropicPixelScaleAt } from '../platesolving/wcs'
import { activeProfile, profileState, setStarProfileSettings, starProfileSettings } from '../profile/profile'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { EmptyState } from '../shell/WorkspaceLayout'
import { StarPreview } from '../stars/StarPreview'
import { measuredStar, measurementOf, reinspectStar, starProfileOf, TAP_SEARCH_DISTANCE } from '../stars/starprofile'
import { FLAG_LABELS, formatFlux, formatLevel, formatSignal } from '../stars/starprofile.format'
import { MAXIMUM_RADIUS_RANGE, MINIMUM_SNR_RANGE, sameMeasurement, SEARCH_RADIUS_RANGE, STAR_PROFILE_MODELS, type StarProfileSettings } from '../stars/starprofile.settings'
import { StarProfilePlot, type StarProfileSeries } from '../stars/StarProfilePlot'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SectionHeading } from '../ui/SectionHeading'
import { SegmentedControl } from '../ui/SegmentedControl'
import { clearStarProfile, type ImageStarProfileState, imagesState, imageUnavailableReason, isMosaic } from './images'
import type { ImageToolPanelProps } from './tools'

// Star Profile Inspector tool of the Images workspace: a click on a star of the image shown measures it on the server, on
// the samples of the image and whatever its display settings, with no star detection first, and this panel shows the
// samples around it, the cuts through it, and every measurement of its profile. Its HFD is the one Readout of the panel,
// with one status word that names the flags of the measurement and the peak level against the full scale of the image,
// so saturation reads at a glance; the shape, the signal, and the fit follow in sections collapsed by default. Selecting
// the tool runs nothing and neither does editing its settings, which are the profile's: only a click, or Analyze Star on
// the star selected, which keeps the star shown, dimmed, until the next answer. Widths are in pixels, with arcseconds
// only under a solution of this same image whose scale is the same along both axes. Intensities are in ADU or in the
// scale of the source, as the response converts them. What cannot be measured reads as a dash, never as zero, and the
// panel describes the star without diagnosing the optics.

// Names of the profile models.
const MODEL_LABELS: Readonly<Record<StarProfileSettings['model'], string>> = { moffat: 'Moffat', moments: 'Moments' }

// Why a click found no star, for people, with what to try next.
const NO_STAR_MESSAGES: Readonly<Record<StarProfileNoStarReason, string>> = {
	noPeak: 'No star detected near this point. Click on a star, or lower the minimum SNR in Measurement Settings.',
	ambiguous: 'More than one star is near this point; click closer to the one you mean.',
}

// Why a Moffat fit was rejected, for people.
const MOFFAT_FAILURES: Readonly<Record<MoffatFitFailureReason, string>> = { invalidInput: 'the star gave it nothing to fit', singular: 'the fit was singular', notConverged: 'the fit did not converge', nonFinite: 'the fit diverged', poorResidual: 'the model does not describe this star well' }

// Classes of a section that shows the star measured before while the next one measures.
const STALE = 'opacity-50 transition-opacity duration-150 motion-reduce:transition-none'

// Star Profile Inspector panel of the active document.
export function StarProfileInspectorPanel({ document, view, onOpen }: ImageToolPanelProps) {
	const profiles = useSnapshot(profileState)
	const settings = starProfileSettings(activeProfile(profiles).settings)

	if (!document) {
		return (
			<EmptyState
				title="No image open"
				action={
					<Button variant="secondary" onClick={onOpen}>
						Open Image
					</Button>
				}
			/>
		)
	}

	const info = document.info
	const state = starProfileOf(view, info?.id)
	const star = measuredStar(state)
	const fitted = star?.profile.moffat?.success === true
	const unavailable = imageUnavailableReason(document)

	return (
		<>
			<Selection documentKey={document.key} state={state} star={star} settings={settings} unavailable={unavailable} hidden={view?.overlaysHidden === true} untrustedMosaic={!!info && !info.cfa && isMosaic(info)} />
			{star && <Measurement imageId={star.imageId} star={star} settings={settings} selected={view?.plateSolving.selected} stale={state?.status === 'measuring'} />}
			<Visualization settings={settings} fitted={fitted} />
			<MeasurementSettings settings={settings} />
		</>
	)
}

interface SelectionProps {
	// Key of the document.
	readonly documentKey: string
	// Measurement of the image shown.
	readonly state?: ImageStarProfileState
	// Star it measured, or the one measured before while it runs, if any.
	readonly star?: StarProfileMeasured
	// Settings of the next measurement.
	readonly settings: StarProfileSettings
	// Why the document has no image yet.
	readonly unavailable?: string
	// Whether the overlays are hidden, which stops a click from selecting anything.
	readonly hidden: boolean
	// Whether the image is a mosaic with no trusted CFA pattern, whose samples are measured as they are.
	readonly untrustedMosaic: boolean
}

// Returns the state of a measurement in one word, for the summary of its section.
function selectionSummary(state: ImageStarProfileState | undefined, star: StarProfileMeasured | undefined) {
	switch (state?.status) {
		case 'measuring':
			return 'Measuring…'
		case 'noStar':
			return 'No star'
		case 'failed':
			return 'Failed'
		case 'measured':
			return star && formatPixelPosition(star.profile.x, star.profile.y, 2)
		default:
			return undefined
	}
}

// What is selected, with the state of its measurement and how to repeat or clear it. Analyze Star is the primary action
// only while the settings ask for another measurement than the one shown.
function Selection({ documentKey, state, star, settings, unavailable, hidden, untrustedMosaic }: SelectionProps) {
	const measuring = state?.status === 'measuring'
	const changed = state && !sameMeasurement(state.request, measurementOf(settings, state.tapRadius))
	const reason = state?.result?.status === 'noStar' ? state.result.reason : undefined

	return (
		<CollapsibleSection id="images.star-profile.selection" title="Selection" summary={selectionSummary(state, star)}>
			{unavailable ? <Notice>{unavailable}</Notice> : hidden ? <Notice>The overlays are hidden: show them to select a star.</Notice> : !state && <Notice>Click a star in the image to measure it. It needs no star detection first.</Notice>}
			{untrustedMosaic && <Notice>This mosaic has no trusted CFA pattern: its samples are measured as they are, not debayered.</Notice>}
			{state && (
				<>
					<DataList>
						<DataRow label="Point">{formatPixelPosition(state.request.x, state.request.y)}</DataRow>
						{star && !measuring && <DataRow label="Centroid">{formatPixelPosition(star.profile.x, star.profile.y, 2)}</DataRow>}
					</DataList>
					<Actions>
						<Button variant={changed && !measuring ? 'primary' : 'secondary'} className="max-sm:min-h-12.5" disabled={measuring} title={measuring ? 'The star is being measured.' : undefined} onClick={() => void reinspectStar(imagesState, documentKey, settings)}>
							Analyze Star
						</Button>
						<Button
							variant="secondary"
							className="max-sm:min-h-12.5"
							onClick={() => {
								const view = imagesState.views[documentKey]
								if (view) clearStarProfile(view)
							}}
						>
							Clear
						</Button>
					</Actions>
				</>
			)}
			{measuring && <Notice>Measuring…</Notice>}
			{reason && <Notice warning>{NO_STAR_MESSAGES[reason]}</Notice>}
			{state?.error && <Notice error>{state.error}</Notice>}
			{changed && !measuring && <Notice warning>The settings changed since this measurement; analyze the star again to apply them.</Notice>}
		</CollapsibleSection>
	)
}

interface MeasurementProps {
	// Id of the image measured.
	readonly imageId: string
	// Measured star.
	readonly star: StarProfileMeasured
	// What is drawn.
	readonly settings: StarProfileSettings
	// Solution chosen for the document, for the angular widths.
	readonly selected?: string
	// Whether the star is the one measured before, shown dimmed while the next measurement runs.
	readonly stale: boolean
}

// Returns the outcome of a measurement in words, its flags named, with the tone that tints it.
function profileStatus({ valid, flags }: Pick<StarProfileMeasured['profile'], 'valid' | 'flags'>): { readonly label: string; readonly tone: 'success' | 'warning' | 'danger' } {
	const named = flags.map((flag) => FLAG_LABELS[flag]).join(', ')
	if (!valid) return { label: named ? `Invalid · ${named}` : 'Invalid', tone: 'danger' }
	return named ? { label: `Valid · ${named}`, tone: 'warning' } : { label: 'Valid', tone: 'success' }
}

// Returns the brightest level of a star, its background included, in the scale of the source, with its percentage of the
// full scale of the image when that is known; a dash without a peak.
function formatPeakLevel({ peak, background }: Pick<StarProfileMeasured['profile'], 'peak' | 'background'>, conversion: SampleConversion, saturationKnown: boolean) {
	if (peak === undefined || background === undefined) return MISSING
	const level = peak + background
	const text = formatLevel(level, conversion)
	return saturationKnown ? `${text} · ${formatFixed(level * 100, 1)} %` : text
}

// Readout, status, preview, cuts, and measurements of a star.
function Measurement({ imageId, star, settings, selected, stale }: MeasurementProps) {
	const { profile, conversion, horizontal, vertical, requestedModel, saturationKnown } = star
	const { solution } = usePlateSolution(imageId, selected)
	const scale = solution && isotropicPixelScaleAt(solution, { x: profile.x + 0.5, y: profile.y + 0.5 })
	const pixelScale = scale === undefined ? undefined : toArcsec(scale)
	const moffat = profile.moffat?.success ? profile.moffat : undefined
	const rejected = profile.moffat?.success === false && requestedModel === 'moffat' ? profile.moffat : undefined
	const hfd = formatPixelLength(profile.hfd)
	const hfr = profile.hfd === undefined ? undefined : profile.hfd / 2
	const status = profileStatus(profile)
	const saturated = profile.flags.includes('saturated')
	const className = stale ? STALE : undefined

	return (
		<>
			<CollapsibleSection id="images.star-profile.summary" title="Star" summary={`HFD ${hfd} · ${status.label}`} className={className}>
				<div className="flex flex-wrap items-baseline justify-between gap-x-3">
					<SectionHeading>HFD</SectionHeading>
					<span className="ml-auto flex flex-col items-end">
						<span className="text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-100 tabular-nums">{hfd}</span>
						{pixelScale !== undefined && profile.hfd !== undefined && <span className="text-sm leading-5 text-ink-200 tabular-nums">{formatFixed(profile.hfd * pixelScale, 2)}″</span>}
					</span>
				</div>
				<DataList>
					<DataRow label="Status" tone={status.tone}>
						{status.label}
					</DataRow>
					<DataRow label="FWHM" title={profile.model === 'moffat' ? 'Fitted by the Moffat model.' : 'Gaussian equivalent of the moments.'}>
						{formatPixelLength(profile.fwhm, pixelScale)}
					</DataRow>
					<DataRow label="Elongation" title="Major over minor FWHM: 1 is round.">
						{formatFixed(profile.elongation, 2)}
					</DataRow>
					<DataRow label="Peak level" tone={saturated ? 'warning' : 'default'} title="Brightest level of the star, its background included, and its share of the full scale of the image.">
						{formatPeakLevel(profile, conversion, saturationKnown)}
					</DataRow>
				</DataList>
				{!saturationKnown && <Notice>Saturation cannot be told on this image: its samples were rescaled when it was read.</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="images.star-profile.preview" title="Star Preview" summary={`${star.preview.width} × ${star.preview.height} px`} className={className}>
				<StarPreview star={star} settings={settings} />
			</CollapsibleSection>
			<CollapsibleSection id="images.star-profile.intensity" title="Intensity Profile" summary={`Peak ${formatSignal(profile.peak, conversion)}`} className={className}>
				<StarProfilePlot title={`Horizontal and vertical cuts through the star, peak ${formatSignal(profile.peak, conversion)}`} series={plotSeries(star, settings.modelCurves)} halfMaximum={profile.peak === undefined ? undefined : profile.peak / 2} />
				<p className="m-0 flex flex-wrap gap-x-3 text-xs leading-4 text-ink-300">
					<span className="whitespace-nowrap text-axis-1">— Horizontal</span>
					<span className="whitespace-nowrap text-axis-2">— Vertical</span>
					{moffat && settings.modelCurves && <span className="whitespace-nowrap">··· Moffat fit</span>}
					<span className="whitespace-nowrap" title="Half the peak, which is not the FWHM of the star.">
						- - Half peak
					</span>
				</p>
				<Notice>{`${horizontal.offsets.length} × ${vertical.offsets.length} samples through the centre pixel: pixels from the centroid against the signal above the background.`}</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.star-profile.shape" title="Shape" summary={`FWHM ${formatFixed(profile.major, 2)} × ${formatFixed(profile.minor, 2)} px`} defaultOpen={false} className={className}>
				<DataList>
					<DataRow label="HFR">{formatPixelLength(hfr, pixelScale)}</DataRow>
					<DataRow label="FWHM Major">{formatPixelLength(profile.major, pixelScale)}</DataRow>
					<DataRow label="FWHM Minor">{formatPixelLength(profile.minor, pixelScale)}</DataRow>
					<DataRow label="Orientation" title="Of the major axis, clockwise from the image's +X; a dash for a star too round to have one.">
						{profile.theta === undefined ? MISSING : formatDegrees(profile.theta, 1)}
					</DataRow>
				</DataList>
			</CollapsibleSection>
			<CollapsibleSection id="images.star-profile.signal" title="Signal" summary={`SNR ${formatFixed(profile.snr, 1)}`} defaultOpen={false} className={className}>
				<DataList>
					<DataRow label="Peak" title="Brightest signal above the background.">
						{formatSignal(profile.peak, conversion)}
					</DataRow>
					<DataRow label="Flux">{formatFlux(profile.flux, conversion)}</DataRow>
					<DataRow label="Background">{formatLevel(profile.background, conversion)}</DataRow>
					<DataRow label="Noise (σ)">{formatSignal(profile.deviation, conversion)}</DataRow>
					<DataRow label="SNR" title="Estimated from the local background, not from a noise model of the camera.">
						{formatFixed(profile.snr, 1)}
					</DataRow>
				</DataList>
			</CollapsibleSection>
			<CollapsibleSection id="images.star-profile.fit" title="Fit" summary={rejected ? 'Moments · Moffat rejected' : MODEL_LABELS[profile.model]} defaultOpen={false} className={className}>
				<DataList>
					<DataRow label="Model">{rejected ? 'Moments · Moffat rejected' : MODEL_LABELS[profile.model]}</DataRow>
					<DataRow label="Quality" title="From 0 to 1, lowered by each flag of the measurement.">
						{formatFixed(profile.quality, 2)}
					</DataRow>
					{moffat && <FitRows fit={moffat} conversion={conversion} />}
				</DataList>
				{rejected && <Notice>The Moffat fit was rejected because {MOFFAT_FAILURES[rejected.reason]}; the moments are shown.</Notice>}
			</CollapsibleSection>
		</>
	)
}

// Returns the lines of the plot of a star: its two cuts and, when asked for, the accepted Moffat fit at the same pixels.
function plotSeries({ horizontal, vertical }: StarProfileMeasured, modelCurves: boolean): readonly StarProfileSeries[] {
	const series: StarProfileSeries[] = [
		{ offsets: horizontal.offsets, values: horizontal.values, stroke: 'var(--color-axis-1)' },
		{ offsets: vertical.offsets, values: vertical.values, stroke: 'var(--color-axis-2)' },
	]

	if (modelCurves && horizontal.model) series.push({ offsets: horizontal.offsets, values: horizontal.model, stroke: 'var(--color-axis-1)', dash: '1 3' })
	if (modelCurves && vertical.model) series.push({ offsets: vertical.offsets, values: vertical.model, stroke: 'var(--color-axis-2)', dash: '1 3' })
	return series
}

interface FitRowsProps {
	// Accepted Moffat fit.
	readonly fit: Extract<NonNullable<StarProfileMeasured['profile']['moffat']>, { readonly success: true }>
	// Conversion of its intensities.
	readonly conversion: SampleConversion
}

// Parameters of an accepted Moffat fit.
function FitRows({ fit, conversion }: FitRowsProps) {
	return (
		<>
			<DataRow label="Moffat β">{formatFixed(fit.beta, 2)}</DataRow>
			<DataRow label="Moffat α Major / Minor">{`${formatFixed(fit.alphaMajor, 2)} / ${formatFixed(fit.alphaMinor, 2)} px`}</DataRow>
			<DataRow label="Fit RMS">{formatSignal(fit.rms, conversion)}</DataRow>
			<DataRow label="Fit iterations">{fit.iterations}</DataRow>
		</>
	)
}

interface VisualizationProps {
	// What is drawn.
	readonly settings: StarProfileSettings
	// Whether the star shown has an accepted Moffat fit to draw.
	readonly fitted: boolean
}

// What the preview, the plot, and the marker draw, counted while collapsed.
function Visualization({ settings, fitted }: VisualizationProps) {
	const edit = (patch: Partial<StarProfileSettings>) => setStarProfileSettings(profileState, patch)
	const shown = [settings.grid, settings.ellipse, settings.halfFlux, settings.modelCurves].filter(Boolean).length

	return (
		<CollapsibleSection id="images.star-profile.visualization" title="Visualization" summary={`${shown} of 4 shown`} defaultOpen={false}>
			<Checkbox label="Pixel grid" className="max-sm:min-h-11" checked={settings.grid} onChange={(grid) => edit({ grid })} />
			<Checkbox label="FWHM ellipse" className="max-sm:min-h-11" checked={settings.ellipse} onChange={(ellipse) => edit({ ellipse })} />
			<Checkbox label="Half-flux circle" className="max-sm:min-h-11" checked={settings.halfFlux} onChange={(halfFlux) => edit({ halfFlux })} />
			<Checkbox label="Moffat curves" className="max-sm:min-h-11" checked={settings.modelCurves} disabled={!fitted} title={fitted ? undefined : 'The star shown has no accepted Moffat fit to draw.'} onChange={(modelCurves) => edit({ modelCurves })} />
		</CollapsibleSection>
	)
}

// Settings of the next measurement, its model named while collapsed.
function MeasurementSettings({ settings }: { readonly settings: StarProfileSettings }) {
	const edit = (patch: Partial<StarProfileSettings>) => setStarProfileSettings(profileState, patch)

	return (
		<CollapsibleSection id="images.star-profile.settings" title="Measurement Settings" summary={MODEL_LABELS[settings.model]} defaultOpen={false}>
			<SegmentedControl label="Model" options={STAR_PROFILE_MODELS} value={settings.model} format={(model) => MODEL_LABELS[model]} onChange={(model) => edit({ model })} />
			<NumberInput label="Search radius" suffix="px" value={settings.searchRadius} min={SEARCH_RADIUS_RANGE[0]} max={SEARCH_RADIUS_RANGE[1]} onChange={(searchRadius) => edit({ searchRadius })} />
			<NumberInput label="Aperture radius" suffix="px" value={settings.maximumRadius} min={MAXIMUM_RADIUS_RANGE[0]} max={MAXIMUM_RADIUS_RANGE[1]} onChange={(maximumRadius) => edit({ maximumRadius })} />
			<NumberInput label="Minimum SNR" value={settings.minSNR} min={MINIMUM_SNR_RANGE[0]} max={MINIMUM_SNR_RANGE[1]} step={0.5} onChange={(minSNR) => edit({ minSNR })} />
			<Notice>{`A click searches at least ${TAP_SEARCH_DISTANCE} screen pixels around it, wider than the search radius at a small zoom. A rejected Moffat fit falls back to the moments. These settings apply to the next measurement.`}</Notice>
		</CollapsibleSection>
	)
}
