import type { AnnotationBodyLayer, AnnotationCenter, AnnotationImageContext, AnnotationJob, AnnotationKind, AnnotationLayer, AnnotationObject, AnnotationRequest, AnnotationResult, AnnotationSite, AnnotationSiteSource, ImageInfo, MinorBody } from 'api'
import { toArcsec } from 'nebulosa/src/math/units/angle'
import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { isAnnotationShown } from '../annotations/AnnotationOverlay'
import { annotationKey, annotationPlateSolveJobId, annotationRequest, annotationsState, cancelAnnotation, isActive, resolveMinorBody, runAnnotation, sameAnnotationRequest } from '../annotations/annotations'
import { useAnnotationContext, useAnnotationResult } from '../annotations/useAnnotationResult'
import { Actions, Notice } from '../equipment-control/parts'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { activeProfile, profileState } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { navigate, routeState } from '../shell/route'
import { EmptyState } from '../shell/WorkspaceLayout'
import { formatAngularSize, formatDeclination, formatDegrees, formatMagnitude, formatRightAscension } from '../sky/format'
import type { SkySelectionRef } from '../sky/objects'
import { selectSkyObject, skyState } from '../sky/sky'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { List, ListItem } from '../ui/List'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { TextInput } from '../ui/TextInput'
import { useNow } from '../useNow'
import { holdCameraFrame } from './cameratabs'
import { type AnnotationDensity, type AnnotationLayers, type ImageAnnotationState, imagesState, imageUnavailableReason, selectAnnotation, setAnnotationView } from './images'
import type { ImageToolPanelProps } from './tools'

// Annotation tool of the Images workspace: identifies the catalog stars, deep-sky objects, and constellations, and the
// Sun, Moon, planets, satellites, asteroids, and comets in the field of the active document from its WCS, on the
// server, and shows the observation date and site of the image, the outcome, the groups and appearance of the overlay,
// the objects in the field, and the object selected in the list or the viewer, which opens in the Sky workspace. The
// WCS is the plate solution shown when it is a completed job of the image, else the WCS of its header; nothing is
// solved implicitly, and the date and site always come from the image. Run Analysis is the only action that queries the
// catalog, and Find the only one that asks the SkyBoT service for the solar-system objects:
// showing, hiding, or restyling the overlay never does. A result always belongs to the image it annotated.

// Text shown for a value the result does not have.
const MISSING = '—'

// Objects listed at most; the overlay still draws every one.
const MAX_LISTED = 300

// Display names of the job states.
const STATE_LABELS: Readonly<Record<AnnotationJob['state'], string>> = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' }

// Display names of the groups.
const LAYER_LABELS: Readonly<Record<AnnotationLayer, string>> = { star: 'Stars', deepSky: 'Deep-sky objects', solarSystem: 'Sun, Moon, and planets', satellite: 'Satellites', minorBody: 'Asteroids and comets' }

// Groups of bodies a solar-system search lists, in the order they are offered, and the layer toggle that shows each.
const BODY_LAYERS: readonly (readonly [AnnotationBodyLayer, keyof AnnotationLayers])[] = [
	['solarSystem', 'solarSystem'],
	['satellite', 'satellites'],
	['minorBody', 'minorBodies'],
]

// Display names of the label densities.
const DENSITY_LABELS: Readonly<Record<AnnotationDensity, string>> = { minimal: 'Minimal', balanced: 'Balanced', detailed: 'Detailed' }

// Display names of where the observation instant came from.
const TIME_ORIGIN_LABELS = { dateObs: 'DATE-OBS', dateEnd: 'DATE-END and exposure', now: 'Current time' } as const

// Display names of where a position is seen from.
const CENTER_LABELS: Readonly<Record<AnnotationCenter, string>> = { geocentricCorrected: 'Geocentric, corrected for the parallax of the site', geocentric: 'Geocentric' }

// Display names of where a site came from.
const SITE_SOURCE_LABELS: Readonly<Record<AnnotationSiteSource, string>> = { obsgeoXyz: 'OBSGEO-X/Y/Z', obsgeoBlh: 'OBSGEO-B/L/H', siteKeywords: 'SITELAT/SITELONG/SITEELEV' }

// Annotation panel of the active document.
export function AnnotationPanel({ document, view, onOpen }: ImageToolPanelProps) {
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

	if (!view) return null
	return <Annotation documentKey={document.key} info={document.info} annotation={view.annotation} selectedSolution={view.plateSolving.selected} unavailable={imageUnavailableReason(document)} />
}

interface AnnotationProps {
	// Key of the document.
	readonly documentKey: string
	// Server description of its image; absent until it has one.
	readonly info?: ImageInfo
	// Annotation state of the document.
	readonly annotation: ImageAnnotationState
	// Plate solution the document shows (a job id, 'header', or absent for the latest job).
	readonly selectedSolution?: string
	// Why the document has no image yet.
	readonly unavailable?: string
}

// Sections of the Annotation panel of a document.
function Annotation({ documentKey, info, annotation, selectedSolution, unavailable }: AnnotationProps) {
	const imageId = info?.id
	const { job, result, resultError } = useAnnotationResult(imageId)
	const solar = useAnnotationResult(imageId, 'solarSystemBodies')
	const { submitErrors } = useSnapshot(annotationsState)
	const solution = usePlateSolution(imageId, selectedSolution)
	const plateSolveJobId = annotationPlateSolveJobId(solution)
	const wcsAvailable = plateSolveJobId !== undefined || solution.header !== undefined
	const context = useAnnotationContext(imageId)
	// Both kinds take the observation date and site from the image itself.
	const request = annotationRequest({ magnitudeLimit: annotation.magnitudeLimit, plateSolveJobId })
	const solarRequest = annotationRequest({ kind: 'solarSystemBodies', magnitudeLimit: annotation.magnitudeLimit, plateSolveJobId, bodies: annotation.bodies })
	const results = [result, solar.result].filter((e) => e !== undefined)
	const owner = results.find((e) => e.jobId === annotation.selected?.jobId)
	const selected = owner?.objects.find((e) => e.id === annotation.selected!.id)
	const edit = (patch: Parameters<typeof setAnnotationView>[2]) => setAnnotationView(imagesState, documentKey, patch)
	const submitError = (kind: AnnotationKind) => (imageId === undefined ? undefined : submitErrors[annotationKey(imageId, kind)])

	return (
		<>
			<Analysis documentKey={documentKey} imageId={imageId} request={request} context={context} job={job} wcsAvailable={wcsAvailable} submitError={submitError('local')} unavailable={unavailable} />
			{imageId !== undefined && (
				<SolarSystemBodies
					documentKey={documentKey}
					imageId={imageId}
					request={solarRequest}
					context={context}
					job={solar.job}
					result={solar.result}
					resultError={solar.resultError}
					wcsAvailable={wcsAvailable}
					submitError={submitError('solarSystemBodies')}
					unavailable={unavailable}
					onBodiesChange={(bodies) => edit({ bodies })}
				/>
			)}
			<PanelSection title="Layers">
				<Checkbox label="Deep-sky objects" checked={annotation.layers.deepSky} onChange={(deepSky) => edit({ layers: { deepSky } })} />
				<Checkbox label="Stars" checked={annotation.layers.stars} onChange={(stars) => edit({ layers: { stars } })} />
				{BODY_LAYERS.map(([layer, toggle]) => (
					<Checkbox key={layer} label={LAYER_LABELS[layer]} checked={annotation.layers[toggle]} onChange={(shown) => edit({ layers: { [toggle]: shown } })} />
				))}
				<Checkbox label="Constellation lines" checked={annotation.layers.constellations} onChange={(constellations) => edit({ layers: { constellations } })} />
				<Checkbox label="Constellation names" checked={annotation.layers.constellationLabels} onChange={(constellationLabels) => edit({ layers: { constellationLabels } })} />
				<Notice>Showing or hiding a layer never runs an analysis.</Notice>
			</PanelSection>
			<PanelSection title="Appearance">
				<Checkbox label="Labels" checked={annotation.labels} onChange={(labels) => edit({ labels })} />
				<SegmentedControl label="Label density" options={['minimal', 'balanced', 'detailed'] as const} value={annotation.density} format={(density) => DENSITY_LABELS[density]} disabled={!annotation.labels} onChange={(density) => edit({ density })} />
				<Checkbox label="Outlines of extended objects" checked={annotation.outlines} onChange={(outlines) => edit({ outlines })} />
				<Checkbox label="Motion during the exposure" checked={annotation.motion} onChange={(motion) => edit({ motion })} />
				<NumberInput label="Magnitude limit" value={annotation.magnitudeLimit} min={-2} max={30} step={0.5} onChange={(magnitudeLimit) => edit({ magnitudeLimit })} />
				<Notice>A lower limit hides fainter stars and deep-sky objects at once; a higher one applies to the next analysis. Deep-sky objects of the classic catalogs without a magnitude are always kept, and the limit never hides a solar-system or minor body.</Notice>
			</PanelSection>
			{imageId !== undefined && (
				<>
					<Objects
						job={job}
						objects={results.flatMap((e) => e.objects)}
						warnings={result?.warnings}
						resultError={resultError}
						annotation={annotation}
						selected={selected?.id}
						onSelect={(id) => {
							const found = results.find((e) => e.objects.some((object) => object.id === id))
							if (found) selectAnnotation(imagesState, documentKey, { jobId: found.jobId, id })
						}}
					/>
					<SelectedObject object={selected} />
				</>
			)}
		</>
	)
}

interface AnalysisProps {
	// Key of the document.
	readonly documentKey: string
	// Server id of the image; absent until the document has one.
	readonly imageId?: string
	// Why no analysis can run yet.
	readonly unavailable?: string
	// Request Run Analysis sends.
	readonly request: AnnotationRequest
	// Observation date and site the image header gives, once fetched.
	readonly context?: AnnotationImageContext
	// Latest job of the image.
	readonly job?: AnnotationJob
	// Whether the image has a WCS to annotate with: the plate solution shown or its header's.
	readonly wcsAvailable: boolean
	// Why the latest submission failed.
	readonly submitError?: string
}

// The WCS, the observation date and site of the image that both kinds use, Run and Cancel, and the state of the latest
// job. Without a date in the header, the analysis moves the stars to the current time. Running holds the frame a
// camera tab shows first, so the frame annotated stays shown.
function Analysis({ documentKey, imageId, request, context, job, wcsAvailable, submitError, unavailable }: AnalysisProps) {
	const active = isActive(job)
	const now = useNow(active)
	const changed = job && !sameAnnotationRequest(job.request, request)
	const observation = context?.observation

	return (
		<PanelSection title="Source & Status">
			<Property label="WCS">{request.plateSolveJobId !== undefined ? 'Plate solution shown' : wcsAvailable ? 'Image header' : 'None'}</Property>
			<Property label="Observation (UTC)">{observation ? formatUtc(observation.time) : context ? TIME_ORIGIN_LABELS.now : MISSING}</Property>
			{observation && <Property label="Time from">{`${TIME_ORIGIN_LABELS[observation.origin]}${observation.approximate ? ' (approximate)' : ''}`}</Property>}
			<Property label="Seen from">{context?.site ? formatSite(context.site) : context ? 'Center of the Earth' : MISSING}</Property>
			{context?.site && <Property label="Site from">{SITE_SOURCE_LABELS[context.site.source]}</Property>}
			<Actions>
				<Button
					disabled={active || imageId === undefined || unavailable !== undefined || !wcsAvailable}
					onClick={() => {
						if (imageId === undefined) return
						holdCameraFrame(imagesState, documentKey)
						void runAnnotation(annotationsState, imageId, request)
					}}
				>
					Run Analysis
				</Button>
				<Button variant="secondary" disabled={!active || !job} onClick={() => job && void cancelAnnotation(job.jobId)}>
					Cancel
				</Button>
			</Actions>
			{unavailable && <Notice>{unavailable}</Notice>}
			{!unavailable && imageId !== undefined && !wcsAvailable && <Notice>This image has no WCS. Solve it with Plate Solving first; nothing is solved implicitly.</Notice>}
			{context && !observation && <Notice>The header has no observation date (DATE-OBS, or DATE-END and the exposure), so the analysis moves the stars to the current time and the solar-system bodies cannot be found.</Notice>}
			{submitError && <Notice error>{submitError}</Notice>}
			{job ? (
				<>
					<Property label="Status">{STATE_LABELS[job.state]}</Property>
					<Property label="Elapsed">{formatSeconds(elapsedOf(job, now))}</Property>
					{job.error && <Notice error>{job.error}</Notice>}
					{changed && <Notice>The WCS or the magnitude limit changed since this analysis; run it again to apply them.</Notice>}
				</>
			) : (
				imageId !== undefined && <Notice>No analysis of this image yet.</Notice>
			)}
		</PanelSection>
	)
}

interface SolarSystemBodiesProps {
	// Key of the document.
	readonly documentKey: string
	// Server id of the image.
	readonly imageId: string
	// Why no search can run yet.
	readonly unavailable?: string
	// Request Find sends, with the groups it lists.
	readonly request: AnnotationRequest
	// Observation date and site the image header gives, once fetched.
	readonly context?: AnnotationImageContext
	// Latest solar-system search of the image.
	readonly job?: AnnotationJob
	// Its result, once fetched.
	readonly result?: AnnotationResult
	// Why its result could not be fetched.
	readonly resultError?: string
	// Whether the image has a WCS to search with.
	readonly wcsAvailable: boolean
	// Why the latest submission failed.
	readonly submitError?: string
	// Changes the groups the next search lists.
	readonly onBodiesChange: (bodies: Partial<Record<AnnotationBodyLayer, boolean>>) => void
}

// Explicit search of the Sun, Moon, planets, satellites, asteroids, and comets of the field, the groups chosen, with
// the IMCCE SkyBoT service at the observation date of the image header, seen from the site of the header (geocentric
// positions corrected for its parallax) or else from the center of the Earth. An image without an observation date
// cannot be searched. It never runs on its own, and its failure leaves the local annotation as it is.
function SolarSystemBodies({ documentKey, imageId, request, context, job, result, resultError, wcsAvailable, submitError, unavailable, onBodiesChange }: SolarSystemBodiesProps) {
	const active = isActive(job)
	const now = useNow(active)
	const changed = job && !sameAnnotationRequest(job.request, request)
	const observation = context?.observation
	const bodies = request.bodies!
	const chosen = bodies.solarSystem || bodies.satellite || bodies.minorBody

	return (
		<PanelSection title="Solar System Bodies">
			{BODY_LAYERS.map(([layer]) => (
				<Checkbox key={layer} label={LAYER_LABELS[layer]} checked={bodies[layer]} onChange={(listed) => onBodiesChange({ [layer]: listed })} />
			))}
			{observation && <Property label="Positions">{CENTER_LABELS[observation.center]}</Property>}
			<Actions>
				<Button
					disabled={active || unavailable !== undefined || !wcsAvailable || !observation || !chosen}
					onClick={() => {
						holdCameraFrame(imagesState, documentKey)
						void runAnnotation(annotationsState, imageId, request)
					}}
				>
					Find
				</Button>
				<Button variant="secondary" disabled={!active || !job} onClick={() => job && void cancelAnnotation(job.jobId)}>
					Cancel
				</Button>
			</Actions>
			{!chosen && <Notice>Choose at least one group of bodies to find.</Notice>}
			{context?.observation && !context.site && <Notice>The header locates no site (OBSGEO or SITELAT/SITELONG), so the bodies are seen from the center of the Earth: the Moon may be up to a degree and a near-Earth object far from its predicted position.</Notice>}
			<Notice>Asks the IMCCE SkyBoT service over the internet for the bodies at the date of the image; it may take several seconds. SkyBoT answers for the center of the Earth only, so the positions are corrected here for the parallax of the site. They are predictions, not detections in the image.</Notice>
			{submitError && <Notice error>{submitError}</Notice>}
			{job && (
				<>
					<Property label="Status">{STATE_LABELS[job.state]}</Property>
					<Property label="Elapsed">{formatSeconds(elapsedOf(job, now))}</Property>
					{job.summary &&
						BODY_LAYERS.map(([layer]) => (
							<Property key={layer} label={LAYER_LABELS[layer]}>
								{job.summary!.counts[layer]}
							</Property>
						))}
					{job.error && <Notice error>{job.error}</Notice>}
					{changed && <Notice>The WCS or the groups changed since this search; run it again to apply them.</Notice>}
					{result?.warnings.map((warning) => (
						<Notice key={warning}>{warning}</Notice>
					))}
					{resultError && <Notice error>{resultError}</Notice>}
				</>
			)}
		</PanelSection>
	)
}

// Formats an instant (Unix milliseconds) in UTC to the second: "2026-01-15 00:00:00 UTC".
function formatUtc(time: number): string {
	return `${new Date(time).toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

// Formats a site: "23.5500° S, 46.6300° W, 760 m".
function formatSite({ latitude, longitude, elevation }: AnnotationSite): string {
	return `${Math.abs(latitude).toFixed(4)}° ${latitude < 0 ? 'S' : 'N'}, ${Math.abs(longitude).toFixed(4)}° ${longitude < 0 ? 'W' : 'E'}, ${elevation.toFixed(0)} m`
}

interface ObjectsProps {
	// Latest local annotation job of the image.
	readonly job?: AnnotationJob
	// Objects of the shown results: the local annotation and the solar-system search.
	readonly objects: readonly AnnotationObject[]
	// Conditions worth knowing about the local annotation, meant for people.
	readonly warnings?: readonly string[]
	// Why the result of the local annotation could not be fetched.
	readonly resultError?: string
	// Annotation state of the document, whose groups and magnitude limit filter the list.
	readonly annotation: ImageAnnotationState
	// Id of the selected object.
	readonly selected?: string
	// Selects an object by id.
	readonly onSelect: (id: string) => void
}

// Groups the local annotation counts.
const LOCAL_LAYERS: readonly AnnotationLayer[] = ['deepSky', 'star']

// Counts of the latest local annotation and the list of the objects shown, solar-system bodies included, filtered by
// name.
function Objects({ job, objects, warnings, resultError, annotation, selected, onSelect }: ObjectsProps) {
	const [filter, setFilter] = useState('')
	const summary = job?.summary
	const text = filter.trim().toLowerCase()
	const shown = objects.filter((object) => isAnnotationShown(annotation, object) && (!text || object.name.toLowerCase().includes(text) || object.designations.some((e) => e.toLowerCase().includes(text))))

	return (
		<PanelSection title="Objects in Field">
			{summary || objects.length > 0 ? (
				<>
					{summary &&
						LOCAL_LAYERS.map((layer) => (
							<Property key={layer} label={LAYER_LABELS[layer]}>
								{summary.counts[layer]}
							</Property>
						))}
					{summary && <Property label="Duration">{formatSeconds(summary.elapsed)}</Property>}
					{warnings?.map((warning) => (
						<Notice key={warning}>{warning}</Notice>
					))}
					{resultError && <Notice error>{resultError}</Notice>}
					<TextInput label="Filter" value={filter} placeholder="Name or designation" onChange={(event) => setFilter(event.currentTarget.value)} />
					<List emptyText={objects.length > 0 ? 'No object matches.' : 'No catalog object in this field.'} className="max-h-80 overflow-y-auto">
						{shown.slice(0, MAX_LISTED).map((object) => (
							<ListItem key={object.id} title={object.name} description={object.typeName} meta={object.magnitude === undefined ? undefined : formatMagnitude(object.magnitude)} selected={object.id === selected} onClick={() => onSelect(object.id)} />
						))}
					</List>
					{shown.length > MAX_LISTED && <Notice>{`${shown.length - MAX_LISTED} more objects are drawn but not listed; filter by name to find them.`}</Notice>}
				</>
			) : (
				<Notice>{job && isActive(job) ? 'Annotating…' : 'No results.'}</Notice>
			)}
		</PanelSection>
	)
}

// Details of the object selected in the list or the viewer, and its link to the Sky workspace. A minor body SkyBoT
// listed has no SPK-ID, so it is looked up in SBDB first and opens only when SBDB knows exactly one body by its
// designation; a satellite other than the Moon is not known to the Sky workspace.
function SelectedObject({ object }: { readonly object?: AnnotationObject }) {
	const profiles = useSnapshot(profileState)
	// Why the SBDB lookup of the selected minor body failed, by object id, and the object being looked up.
	const [lookup, setLookup] = useState<{ readonly id: string; readonly error?: string }>()
	const observer = activeProfile(profiles).settings.sky.observer

	// Selects an object in the Sky workspace and opens it; a satellite other than the Moon has no ref and never opens.
	function openInSky(ref: SkySelectionRef, name: string, minorBody?: MinorBody) {
		const { layer } = object!
		selectSkyObject(skyState, { ref, source: 'search', name, category: layer === 'satellite' ? 'solarSystem' : layer, ...(minorBody && { minorBody }) }, observer)
		navigate(routeState, { workspace: 'sky' })
	}

	// Looks the selected minor body up in SBDB and opens it when found.
	async function openMinorBody(target: AnnotationObject) {
		setLookup({ id: target.id })
		const body = await resolveMinorBody(target)
		if (typeof body === 'string') setLookup({ id: target.id, error: body })
		else openInSky({ kind: 'minorBody', spkId: body.spkId, designation: body.designation }, body.name, body)
	}

	return (
		<PanelSection title="Selected Object">
			{object ? (
				<>
					<Property label="Name">{object.name}</Property>
					{object.designations.length > 0 && <p className="text-xs wrap-break-word text-ink-300">{object.designations.slice(0, 6).join(' · ')}</p>}
					<Property label="Type">{object.typeName}</Property>
					<Property label="Magnitude">{object.magnitude === undefined ? MISSING : formatMagnitude(object.magnitude)}</Property>
					<Property label="Right ascension (J2000)">{formatRightAscension(object.rightAscension)}</Property>
					<Property label="Declination (J2000)">{formatDeclination(object.declination)}</Property>
					{object.majorAxis !== undefined && <Property label="Size">{object.minorAxis === undefined ? formatAngularSize(object.majorAxis) : `${formatAngularSize(object.majorAxis)} × ${formatAngularSize(object.minorAxis)}`}</Property>}
					{object.orientation !== undefined && <Property label="Position angle">{formatDegrees(object.orientation)}</Property>}
					{object.positionError !== undefined && <Property label="Position uncertainty">{formatUncertainty(object.positionError)}</Property>}
					{object.center && <Property label="Position">{CENTER_LABELS[object.center]}</Property>}
					{object.ref ? (
						<Button variant="secondary" className="self-start" onClick={() => openInSky(object.ref!, object.name)}>
							Open in Sky
						</Button>
					) : (
						object.layer === 'minorBody' && (
							<Button variant="secondary" className="self-start" disabled={lookup?.id === object.id && lookup.error === undefined} onClick={() => void openMinorBody(object)}>
								Find in SBDB and Open in Sky
							</Button>
						)
					)}
					{lookup?.id === object.id && lookup.error && <Notice error>{lookup.error}</Notice>}
					{object.ref || object.layer === 'minorBody' ? <Notice>The Sky workspace keeps its own time: it shows the object now, not at the time of this image.</Notice> : <Notice>This satellite cannot be opened in the Sky workspace.</Notice>}
				</>
			) : (
				<Notice>Click a marker in the image or an object in the list to inspect it.</Notice>
			)}
		</PanelSection>
	)
}

interface PropertyProps {
	// Property name.
	readonly label: string
	// Property value.
	readonly children: ReactNode
}

// Name and value of a property. A long name wraps; the value keeps its width, so the values stay aligned on the right.
function Property({ label, children }: PropertyProps) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="min-w-0 text-xs wrap-break-word text-ink-300">{label}</span>
			<span className="flex-[min-content] text-right text-ink-100 tabular-nums">{children}</span>
		</div>
	)
}

// Returns how long a job ran, or has been running, in milliseconds; 0 while it waits.
function elapsedOf(job: AnnotationJob, now: number): number {
	if (job.summary) return job.summary.elapsed
	if (job.startedAt === undefined) return 0
	return (job.endedAt ?? now) - job.startedAt
}

// Returns a duration in milliseconds as seconds with two decimals below 10 s, one above.
function formatSeconds(milliseconds: number): string {
	const seconds = milliseconds / 1000
	return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`
}

// Formats a position uncertainty in radians as arcseconds with two significant digits: "0.026″", "45″".
function formatUncertainty(angle: number): string {
	return `${Number(toArcsec(angle).toPrecision(2))}″`
}
