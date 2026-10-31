import type { SampleConversion, StarProfileMeasured, StarProfileNoStarReason } from 'api'
import type { MoffatFitFailureReason } from 'nebulosa/src/imaging/stars/profile.moffat'
import { toArcsec } from 'nebulosa/src/math/units/angle'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { Actions, Notice } from '../equipment-control/parts'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { isotropicPixelScaleAt } from '../platesolving/wcs'
import { activeProfile, profileState, setStarProfileSettings, starProfileSettings } from '../profile/profile'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { EmptyState } from '../shell/WorkspaceLayout'
import { StarPreview } from '../stars/StarPreview'
import { measuredStar, reinspectStar, starProfileOf } from '../stars/starprofile'
import { FLAG_LABELS, formatFlux, formatLevel, formatNumber, formatSignal, formatWidth } from '../stars/starprofile.format'
import { MAXIMUM_RADIUS_RANGE, MINIMUM_SNR_RANGE, sameMeasurement, SEARCH_RADIUS_RANGE, STAR_PROFILE_MODELS, type StarProfileSettings } from '../stars/starprofile.settings'
import { StarProfilePlot, type StarProfileSeries } from '../stars/StarProfilePlot'
import { StarProfileRow as Row } from '../stars/StarProfileRow'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { clearStarProfile, type ImageStarProfileState, imagesState, imageUnavailableReason, isMosaic } from './images'
import type { ImageToolPanelProps } from './tools'

// Star Profile Inspector tool of the Images workspace: a click on a star of the image shown measures it on the server, on
// the samples of the image and whatever its display settings, with no star detection first, and this panel shows the
// samples around it, the cuts through it, and every measurement of its profile. Selecting the tool runs nothing and
// neither does editing its settings, which are the profile's: only a click, or Analyze Star on the star selected. Widths
// are in pixels, with arcseconds only under a solution of this same image whose scale is the same along both axes.
// Intensities are in ADU or in the scale of the source, as the response converts them. What cannot be measured reads as
// a dash, never as zero, and the panel describes the star without diagnosing the optics.

// Names of the profile models.
const MODEL_LABELS: Readonly<Record<StarProfileSettings['model'], string>> = { moffat: 'Moffat', moments: 'Moments' }

// Why a click found no star, for people.
const NO_STAR_MESSAGES: Readonly<Record<StarProfileNoStarReason, string>> = { noPeak: 'No star detected near this point.', ambiguous: 'More than one star is near this point; click closer to the one you mean.' }

// Why a Moffat fit was rejected, for people.
const MOFFAT_FAILURES: Readonly<Record<MoffatFitFailureReason, string>> = { invalidInput: 'the star gave it nothing to fit', singular: 'the fit was singular', notConverged: 'the fit did not converge', nonFinite: 'the fit diverged', poorResidual: 'the model does not describe this star well' }

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
	const unavailable = imageUnavailableReason(document)
	const edit = (patch: Partial<StarProfileSettings>) => setStarProfileSettings(profileState, patch)

	return (
		<>
			<Selection documentKey={document.key} state={state} star={star} settings={settings} unavailable={unavailable} hidden={view?.overlaysHidden === true} />
			{info && !info.cfa && isMosaic(info) && <Notice>This mosaic has no trusted CFA pattern: its samples are measured as they are, not debayered.</Notice>}
			{star && <Measurement imageId={star.imageId} star={star} settings={settings} selected={view?.plateSolving.selected} />}
			<CollapsibleSection id="images.star-profile.visualization" title="Visualization" defaultOpen={false}>
				<Checkbox label="Pixel grid" checked={settings.grid} onChange={(grid) => edit({ grid })} />
				<Checkbox label="FWHM ellipse" checked={settings.ellipse} onChange={(ellipse) => edit({ ellipse })} />
				<Checkbox label="Half-flux circle" checked={settings.halfFlux} onChange={(halfFlux) => edit({ halfFlux })} />
				<Checkbox label="Moffat curves" checked={settings.modelCurves} onChange={(modelCurves) => edit({ modelCurves })} />
			</CollapsibleSection>
			<CollapsibleSection id="images.star-profile.settings" title="Measurement Settings" defaultOpen={false}>
				<SegmentedControl label="Model" options={STAR_PROFILE_MODELS} value={settings.model} format={(model) => MODEL_LABELS[model]} onChange={(model) => edit({ model })} />
				<NumberInput label="Search radius" suffix="px" value={settings.searchRadius} min={SEARCH_RADIUS_RANGE[0]} max={SEARCH_RADIUS_RANGE[1]} onChange={(searchRadius) => edit({ searchRadius })} />
				<NumberInput label="Aperture radius" suffix="px" value={settings.maximumRadius} min={MAXIMUM_RADIUS_RANGE[0]} max={MAXIMUM_RADIUS_RANGE[1]} onChange={(maximumRadius) => edit({ maximumRadius })} />
				<NumberInput label="Minimum SNR" value={settings.minSNR} min={MINIMUM_SNR_RANGE[0]} max={MINIMUM_SNR_RANGE[1]} step={0.5} onChange={(minSNR) => edit({ minSNR })} />
				<Notice>A rejected Moffat fit falls back to the moments. These settings apply to the next measurement.</Notice>
			</CollapsibleSection>
		</>
	)
}

interface SelectionProps {
	// Key of the document.
	readonly documentKey: string
	// Measurement of the image shown.
	readonly state?: ImageStarProfileState
	// Star it measured, if any.
	readonly star?: StarProfileMeasured
	// Settings of the next measurement.
	readonly settings: StarProfileSettings
	// Why the document has no image yet.
	readonly unavailable?: string
	// Whether the overlays are hidden, which stops a click from selecting anything.
	readonly hidden: boolean
}

// What is selected, with the state of its measurement and how to repeat or clear it.
function Selection({ documentKey, state, star, settings, unavailable, hidden }: SelectionProps) {
	const measuring = state?.status === 'measuring'
	const changed = state && !sameMeasurement(state.request, settings)
	const reason = state?.result?.status === 'noStar' ? state.result.reason : undefined

	return (
		<CollapsibleSection id="images.star-profile.selection" title="Selection">
			{unavailable ? <Notice>{unavailable}</Notice> : hidden ? <Notice>The overlays are hidden: show them to select a star.</Notice> : !state && <Notice>Click a star in the image to measure it. It needs no star detection first.</Notice>}
			{state && (
				<>
					<Property label="Point">{`${state.request.x.toFixed(1)}, ${state.request.y.toFixed(1)} px`}</Property>
					{star && <Property label="Centroid">{`${star.profile.x.toFixed(2)}, ${star.profile.y.toFixed(2)} px`}</Property>}
					<Actions>
						<Button disabled={measuring} onClick={() => void reinspectStar(imagesState, documentKey, settings)}>
							Analyze Star
						</Button>
						<Button
							variant="secondary"
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
			{reason && <Notice>{NO_STAR_MESSAGES[reason]}</Notice>}
			{state?.error && <Notice error>{state.error}</Notice>}
			{changed && !measuring && <Notice>The settings changed since this measurement; analyze the star again to apply them.</Notice>}
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
}

// Preview, cuts, and measurements of a star.
function Measurement({ imageId, star, settings, selected }: MeasurementProps) {
	const { profile, conversion, horizontal, vertical, requestedModel, saturationKnown } = star
	const { solution } = usePlateSolution(imageId, selected)
	const scale = solution && isotropicPixelScaleAt(solution, { x: profile.x + 0.5, y: profile.y + 0.5 })
	const pixelScale = scale === undefined ? undefined : toArcsec(scale)
	const moffat = profile.moffat?.success ? profile.moffat : undefined
	const rejected = profile.moffat?.success === false ? profile.moffat : undefined
	const hfr = profile.hfd === undefined ? undefined : profile.hfd / 2

	return (
		<>
			<CollapsibleSection id="images.star-profile.summary" title="Star">
				<div className="grid grid-cols-2 gap-2">
					<Headline label="HFD">{formatWidth(profile.hfd)}</Headline>
					<Headline label={profile.model === 'moffat' ? 'FWHM (fitted)' : 'FWHM (Gaussian eq.)'}>{formatWidth(profile.fwhm)}</Headline>
				</div>
				<p className={profile.valid ? 'm-0 text-xs text-success' : 'm-0 text-xs text-danger'}>{profile.valid ? 'Valid measurement' : 'Invalid measurement'}</p>
				{profile.flags.length > 0 && <Notice>{profile.flags.map((flag) => FLAG_LABELS[flag]).join(', ')}.</Notice>}
				{rejected && requestedModel === 'moffat' && <Notice>Showing the moments: the Moffat fit was rejected because {MOFFAT_FAILURES[rejected.reason]}.</Notice>}
				{!saturationKnown && <Notice>Saturation cannot be told on this image: its samples were rescaled when it was read.</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="images.star-profile.preview" title="Star Preview">
				<StarPreview star={star} settings={settings} />
			</CollapsibleSection>
			<CollapsibleSection id="images.star-profile.intensity" title="Intensity Profile">
				<StarProfilePlot series={plotSeries(star, settings.modelCurves)} halfMaximum={profile.peak === undefined ? undefined : profile.peak / 2} />
				<p className="m-0 flex flex-wrap gap-x-3 text-xs leading-4 text-ink-300">
					<span className="whitespace-nowrap text-accent">— Horizontal</span>
					<span className="whitespace-nowrap text-success">— Vertical</span>
					{moffat && settings.modelCurves && <span className="whitespace-nowrap">··· Moffat fit</span>}
					<span className="whitespace-nowrap">- - Half peak</span>
				</p>
				<Notice>{`${horizontal.offsets.length} × ${vertical.offsets.length} samples through the centre pixel, in pixels from the centroid, above the background; peak ${formatSignal(profile.peak, conversion)}. The half peak is not the FWHM of the star.`}</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.star-profile.measurements" title="Measurements">
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					<Row label="HFD">{formatWidth(profile.hfd, pixelScale)}</Row>
					<Row label="HFR">{formatWidth(hfr, pixelScale)}</Row>
					<Row label="FWHM">{formatWidth(profile.fwhm, pixelScale)}</Row>
					<Row label="FWHM Major">{formatWidth(profile.major, pixelScale)}</Row>
					<Row label="FWHM Minor">{formatWidth(profile.minor, pixelScale)}</Row>
					<Row label="Eccentricity">{formatNumber(profile.eccentricity, 3)}</Row>
					<Row label="Elongation">{formatNumber(profile.elongation, 3)}</Row>
					<Row label="Orientation">{profile.theta === undefined ? '—' : `${((profile.theta * 180) / Math.PI).toFixed(1)}°`}</Row>
					<Row label="Peak">{formatSignal(profile.peak, conversion)}</Row>
					<Row label="Flux">{formatFlux(profile.flux, conversion)}</Row>
					<Row label="Background">{formatLevel(profile.background, conversion)}</Row>
					<Row label="Noise (σ)">{formatSignal(profile.deviation, conversion)}</Row>
					<Row label="SNR">{formatNumber(profile.snr, 1)}</Row>
					<Row label="Quality">{profile.quality.toFixed(2)}</Row>
					<Row label="Model">{MODEL_LABELS[profile.model]}</Row>
					{moffat && <FitRows fit={moffat} conversion={conversion} />}
				</dl>
				<Notice>The SNR is estimated from the local background, not from a noise model of the camera.</Notice>
			</CollapsibleSection>
		</>
	)
}

// Returns the lines of the plot of a star: its two cuts and, when asked for, the accepted Moffat fit at the same pixels.
function plotSeries({ horizontal, vertical }: StarProfileMeasured, modelCurves: boolean): readonly StarProfileSeries[] {
	const series: StarProfileSeries[] = [
		{ offsets: horizontal.offsets, values: horizontal.values, stroke: 'var(--color-accent)' },
		{ offsets: vertical.offsets, values: vertical.values, stroke: 'var(--color-success)' },
	]

	if (modelCurves && horizontal.model) series.push({ offsets: horizontal.offsets, values: horizontal.model, stroke: 'var(--color-accent)', dash: '1 3' })
	if (modelCurves && vertical.model) series.push({ offsets: vertical.offsets, values: vertical.model, stroke: 'var(--color-success)', dash: '1 3' })
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
			<Row label="Moffat β">{fit.beta.toFixed(2)}</Row>
			<Row label="Moffat α Major / Minor">{`${fit.alphaMajor.toFixed(2)} / ${fit.alphaMinor.toFixed(2)} px`}</Row>
			<Row label="Fit RMS">{formatSignal(fit.rms, conversion)}</Row>
			<Row label="Fit iterations">{fit.iterations}</Row>
		</>
	)
}

interface HeadlineProps {
	// Name of the value.
	readonly label: string
	// Its value.
	readonly children: ReactNode
}

// Value at the top of the measurements of a star.
function Headline({ label, children }: HeadlineProps) {
	return (
		<div className="min-w-0 rounded-md border border-line-100 bg-base-100 px-2 py-1">
			<div className="truncate text-xs text-ink-300">{label}</div>
			<div className="text-sm text-ink-100 tabular-nums">{children}</div>
		</div>
	)
}

interface PropertyProps {
	// Property name.
	readonly label: string
	// Property value.
	readonly children: ReactNode
}

// Name and value of a property.
function Property({ label, children }: PropertyProps) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="flex-none text-xs text-ink-300">{label}</span>
			<span className="min-w-0 text-right text-ink-100 tabular-nums">{children}</span>
		</div>
	)
}
