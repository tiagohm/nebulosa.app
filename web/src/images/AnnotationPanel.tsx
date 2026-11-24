import type { AnnotationBodyLayer, AnnotationCenter, AnnotationImageContext, AnnotationJob, AnnotationKind, AnnotationLayer, AnnotationObject, AnnotationRequest, AnnotationResult, AnnotationSite, AnnotationSiteSource, ImageInfo, MinorBody } from 'api'
import { toArcsec } from 'nebulosa/src/math/units/angle'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { analysisElapsed, isActive } from '../analysis'
import { isAnnotationShown } from '../annotations/AnnotationOverlay'
import { annotationAnswers, annotationKey, annotationPlateSolveJobId, annotationRequest, annotationsState, cancelAnnotation, requestedBodies, resolveMinorBody, runAnnotation } from '../annotations/annotations'
import { type AnnotationResultView, useAnnotationContext, useAnnotationResult } from '../annotations/useAnnotationResult'
import { formatClockTime, formatDegrees, formatDuration, formatElevation, formatGeographic, formatZonedDateTime, MISSING } from '../format'
import { useActiveSite, useActiveTimeZone } from '../location/useLocation'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { pointAt } from '../platesolving/wcs'
import { profileState, setAnnotationPreferences } from '../profile/profile'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { navigate, routeState } from '../shell/route'
import { EmptyState } from '../shell/WorkspaceLayout'
import { setSkyTime, setSkyTimeNow, skyClock } from '../sky/clock'
import { formatApparentSize, formatDeclination, formatMagnitude, formatRightAscension } from '../sky/format'
import type { SkySelectionRef } from '../sky/objects'
import { selectSkyObject, skyState } from '../sky/sky'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SectionHeading } from '../ui/SectionHeading'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { VirtualList } from '../ui/VirtualList'
import { useNow } from '../useNow'
import { type AnnotationDensity, type AnnotationLayers, centerImageView, type ImageAnnotationState, imagesState, imageUnavailableReason, selectAnnotation, selectImageTool, setAnnotationView } from './images'
import type { ImageToolPanelProps } from './tools'

// Annotation tool of the Images workspace: identifies the catalog stars, deep-sky objects, and constellations, and the
// Sun, Moon, planets, satellites, asteroids, and comets in the field of the active document from its WCS, on the
// server, and reads the frame as an answer to "what is in it": how many objects of each group, the list of them, which
// the viewer centers when one is selected, and the object selected in the list or the viewer, which opens in the Sky
// workspace at the current time or at the time of the image. The panel has two states: before the image has an
// annotation it is Run Analysis above its settings (the WCS, the observation date and site of the image, and the
// magnitude limit); once one runs or has a result, the settings fold into one collapsed section and the result takes
// the panel, with the optional online search of the solar-system bodies and how the overlay is drawn folded below. The
// result shown of each kind is that of its newest completed run, so a run that waits, fails, or is cancelled keeps it.
// The WCS is the plate solution shown when it is a completed job of the image, else the WCS of its header; nothing is
// solved implicitly, and the date and site always come from the image. Run Analysis is the only action that queries the
// catalog, and Find Bodies Online the only one that asks the SkyBoT service for the solar-system bodies: showing,
// hiding, or restyling the overlay, or a brighter magnitude limit, never does. A result always belongs to the image it
// annotated.

// Text an object is searched by in the list: its name and every designation.
function objectSearchText(object: AnnotationObject) {
	return [object.name, ...object.designations].join(' ')
}

// Id of an object, its key in the list.
function objectKey(object: AnnotationObject) {
	return object.id
}

// Name of an object, the title of its row.
function objectName(object: AnnotationObject) {
	return object.name
}

// Kind of an object, the description of its row.
function objectType(object: AnnotationObject) {
	return object.typeName
}

// Magnitude of an object, the meta of its row; nothing when it has none.
function objectMagnitude(object: AnnotationObject) {
	return object.magnitude === undefined ? undefined : `mag ${formatMagnitude(object.magnitude)}`
}

// Display names of the groups.
const LAYER_LABELS: Readonly<Record<AnnotationLayer, string>> = { star: 'Stars', deepSky: 'Deep-sky objects', solarSystem: 'Sun, Moon, and planets', satellite: 'Satellites', minorBody: 'Asteroids and comets' }

// Singular and plural nouns of each group, in a count: "1 star", "7 deep-sky objects".
const LAYER_NOUNS: Readonly<Record<AnnotationLayer, readonly [string, string]>> = {
	star: ['star', 'stars'],
	deepSky: ['deep-sky object', 'deep-sky objects'],
	solarSystem: ['Sun, Moon, or planet', 'Sun, Moon, or planets'],
	satellite: ['satellite', 'satellites'],
	minorBody: ['asteroid or comet', 'asteroids or comets'],
}

// Groups a local annotation counts, in the order they are listed.
const LOCAL_LAYERS: readonly AnnotationLayer[] = ['deepSky', 'star']

// Groups of bodies a solar-system search lists, in the order they are offered, and the layer toggle that shows each.
const BODY_LAYERS: readonly (readonly [AnnotationBodyLayer, keyof AnnotationLayers])[] = [
	['solarSystem', 'solarSystem'],
	['satellite', 'satellites'],
	['minorBody', 'minorBodies'],
]

// Layer toggles of the overlay, in the order they are offered, with their labels.
const LAYER_TOGGLES: readonly (readonly [keyof AnnotationLayers, string])[] = [
	['deepSky', 'Deep-sky objects'],
	['stars', 'Stars'],
	['solarSystem', LAYER_LABELS.solarSystem],
	['satellites', LAYER_LABELS.satellite],
	['minorBodies', LAYER_LABELS.minorBody],
	['constellations', 'Constellation lines'],
	['constellationLabels', 'Constellation names'],
]

// Display names of the label densities.
const DENSITY_LABELS: Readonly<Record<AnnotationDensity, string>> = { minimal: 'Minimal', balanced: 'Balanced', detailed: 'Detailed' }

// Display names of where the observation instant came from.
const TIME_ORIGIN_LABELS = { dateObs: 'DATE-OBS', dateEnd: 'DATE-END and exposure', now: 'Current time' } as const

// Display names of where a position is seen from.
const CENTER_LABELS: Readonly<Record<AnnotationCenter, string>> = { geocentricCorrected: 'Geocentric + site parallax', geocentric: 'Geocentric' }

// Display names of where a site came from.
const SITE_SOURCE_LABELS: Readonly<Record<AnnotationSiteSource, string>> = { obsgeoXyz: 'OBSGEO-X/Y/Z', obsgeoBlh: 'OBSGEO-B/L/H', siteKeywords: 'SITELAT/SITELONG/SITEELEV' }

// What Find Bodies Online does, its tooltip while it can run.
const SKYBOT_NOTE = 'Asks the IMCCE SkyBoT service over the internet for the bodies at the date of the image; it may take several seconds.'

// Tone of a status word.
type StatusTone = 'default' | 'success' | 'warning' | 'danger'

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

// Sections of the Annotation panel of a document: Analysis always, then its settings until the image has an annotation
// that runs or a result, or the result, the selected object, the solar-system search, and the drawing once it has, with
// the settings folded.
function Annotation({ documentKey, info, annotation, selectedSolution, unavailable }: AnnotationProps) {
	const imageId = info?.id
	const local = useAnnotationResult(imageId)
	const solar = useAnnotationResult(imageId, 'solarSystemBodies')
	const { submitErrors } = useSnapshot(annotationsState)
	const solution = usePlateSolution(imageId, selectedSolution)
	const plateSolveJobId = annotationPlateSolveJobId(solution)
	const wcs = plateSolveJobId !== undefined ? 'solution' : solution.header !== undefined ? 'header' : undefined
	const context = useAnnotationContext(imageId)
	// Both kinds take the observation date and site from the image itself.
	const request = annotationRequest({ magnitudeLimit: annotation.magnitudeLimit, plateSolveJobId })
	const solarRequest = annotationRequest({ kind: 'solarSystemBodies', magnitudeLimit: annotation.magnitudeLimit, plateSolveJobId, bodies: annotation.bodies })
	const results = [local.result, solar.result].filter((e) => e !== undefined)
	// Read before the closures rather than asserted inside them: the React Compiler of the executable reads an asserted
	// `annotation.selected!.id` during the render to memoize the closure, which throws while nothing is selected.
	const selectedId = annotation.selected?.id
	const owner = results.find((e) => e.jobId === annotation.selected?.jobId)
	const selected = owner?.objects.find((e) => e.id === selectedId)

	// Changes the document, and the profile for the documents opened next.
	function edit(patch: Parameters<typeof setAnnotationView>[2]) {
		setAnnotationView(imagesState, documentKey, patch)
		setAnnotationPreferences(profileState, patch)
	}

	const submitError = (kind: AnnotationKind) => (imageId === undefined ? undefined : submitErrors[annotationKey(imageId, kind)])
	const analysis = <Analysis documentKey={documentKey} imageId={imageId} request={request} context={context} view={local} wcsAvailable={wcs !== undefined} submitError={submitError('local')} unavailable={unavailable} />
	const settings = (id: string, defaultOpen: boolean) => <AnalysisSettings id={id} defaultOpen={defaultOpen} wcs={wcs} context={context} magnitudeLimit={annotation.magnitudeLimit} onMagnitudeLimitChange={(magnitudeLimit) => edit({ magnitudeLimit })} />
	const bodies = imageId !== undefined && <SolarSystemBodies imageId={imageId} request={solarRequest} context={context} view={solar} wcsAvailable={wcs !== undefined} submitError={submitError('solarSystemBodies')} unavailable={unavailable} onBodiesChange={(changed) => edit({ bodies: changed })} />

	if (imageId === undefined || (!local.job && !isActive(local.latest) && !solar.job && !isActive(solar.latest))) {
		return (
			<>
				{analysis}
				{settings('images.annotation.settings-first', true)}
				{bodies}
			</>
		)
	}

	return (
		<>
			{analysis}
			{settings('images.annotation.settings', false)}
			{(local.job ?? solar.job) && (
				<Objects
					local={local}
					solar={solar}
					objects={results.flatMap((e) => e.objects)}
					annotation={annotation}
					selected={selected?.id}
					onCenterSelectedChange={(centerSelected) => edit({ centerSelected })}
					onSelect={(id) => {
						const found = results.find((e) => e.objects.some((object) => object.id === id))
						if (!found) return
						selectAnnotation(imagesState, documentKey, { jobId: found.jobId, id })
						const object = annotation.centerSelected ? found.objects.find((e) => e.id === id) : undefined
						const point = object && pointAt(found.solution, object.rightAscension, object.declination)
						if (point) centerImageView(imagesState, documentKey, point)
					}}
				/>
			)}
			{results.length > 0 && <SelectedObject object={selected} observationTime={context?.observation?.time} />}
			{bodies}
			{results.length > 0 && <Display annotation={annotation} onChange={edit} />}
		</>
	)
}

// Returns a count in words with its nouns: "No objects", "1 object", "11 objects".
function countOf(count: number, [one, many]: readonly [string, string]) {
	return count === 0 ? `No ${many}` : count === 1 ? `1 ${one}` : `${count} ${many}`
}

// Returns how many objects a completed job found: the stars and deep-sky objects of a local annotation, or the bodies of
// the groups a solar-system search listed.
function foundCount(job: Pick<AnnotationJob, 'request' | 'summary'>) {
	const counts = job.summary?.counts
	return counts ? countedLayers(job).reduce((sum, layer) => sum + counts[layer], 0) : 0
}

// Returns the groups a job counts: the stars and deep-sky objects of a local annotation, or only the groups a
// solar-system search listed, so a group never searched is never shown as zero.
function countedLayers(job: Pick<AnnotationJob, 'request'>): readonly AnnotationLayer[] {
	if (job.request.kind === 'local') return LOCAL_LAYERS
	const bodies = requestedBodies(job.request)
	return BODY_LAYERS.map(([layer]) => layer).filter((layer) => bodies[layer])
}

// Returns the outcome of a job in words with the tone that tints it: what it found once completed, else its state.
function jobStatus(job: Pick<AnnotationJob, 'state' | 'request' | 'summary'>): { readonly label: string; readonly tone: StatusTone } {
	switch (job.state) {
		case 'queued':
			return { label: 'Queued', tone: 'default' }
		case 'running':
			return { label: 'Running', tone: 'default' }
		case 'completed':
			return { label: countOf(foundCount(job), job.request.kind === 'local' ? ['object', 'objects'] : ['body', 'bodies']), tone: 'default' }
		case 'failed':
			return { label: 'Failed', tone: 'danger' }
		case 'cancelled':
			return { label: 'Cancelled', tone: 'default' }
	}
}

interface JobStatusProps {
	// Latest job of the kind, whatever its state.
	readonly latest: AnnotationJob
	// Completed job whose result is shown, which may be older than the latest.
	readonly shown?: AnnotationJob
	// What the kind runs, in the sentence that says which result stays: "analysis", "search".
	readonly noun: string
}

// State and time of the latest job of a kind, its failure, and, when it ended without becoming the result shown, which
// result stays.
function JobStatus({ latest, shown, noun }: JobStatusProps) {
	const active = isActive(latest)
	const now = useNow(active)
	const timeZone = useActiveTimeZone()
	const status = jobStatus(latest)
	const kept = shown !== undefined && shown.jobId !== latest.jobId ? formatClockTime(shown.queuedAt, timeZone, { seconds: true, named: true }) : undefined

	return (
		<>
			<DataList>
				<DataRow label="Status" tone={status.tone}>
					{status.label}
				</DataRow>
				<DataRow label={active ? 'Elapsed' : 'Duration'}>{formatDuration(analysisElapsed(latest, now) / 1000)}</DataRow>
			</DataList>
			{latest.state === 'failed' && latest.error && <Notice error>{latest.error}</Notice>}
			{kept &&
				(active ? (
					<Notice>
						A new {noun} is running; the result of {kept} stays shown until it completes.
					</Notice>
				) : (
					<Notice>The result of {kept} stays shown.</Notice>
				))}
		</>
	)
}

interface AnalysisProps {
	// Key of the document, whose Plate Solving tool opens when it has no WCS.
	readonly documentKey: string
	// Server id of the image; absent until the document has one.
	readonly imageId?: string
	// Why no analysis can run yet.
	readonly unavailable?: string
	// Request Run Analysis sends.
	readonly request: AnnotationRequest
	// Observation date and site the image header gives, once fetched.
	readonly context?: AnnotationImageContext
	// Local annotation of the image: its latest job and the one shown.
	readonly view: AnnotationResultView
	// Whether the image has a WCS to annotate with: the plate solution shown or its header's.
	readonly wcsAvailable: boolean
	// Why the latest submission failed.
	readonly submitError?: string
}

// Run Analysis and Cancel Analysis, each saying why while disabled, with the outcome of the latest local annotation of
// the image. Run Analysis is disabled while the result shown already answers the request, since a brighter magnitude
// limit only hides objects of it. An image without a WCS offers its Plate Solving tool; nothing is solved implicitly.
function Analysis({ documentKey, imageId, request, context, view, wcsAvailable, submitError, unavailable }: AnalysisProps) {
	const { latest, job: shown } = view
	const active = isActive(latest)
	const answered = shown !== undefined && annotationAnswers(shown, request)
	const reason =
		imageId === undefined
			? (unavailable ?? 'The document has no image yet.')
			: !wcsAvailable
				? 'This image has no WCS; solve it with Plate Solving first.'
				: active
					? 'An analysis of this image is running.'
					: answered
						? 'This result already covers these settings; raise the magnitude limit or change the WCS to run again.'
						: undefined

	return (
		<CollapsibleSection id="images.annotation.analysis" title="Analysis" summary={latest && jobStatus(latest).label}>
			<Actions>
				<Button className="max-sm:min-h-12.5" disabled={reason !== undefined} title={reason} onClick={() => imageId !== undefined && void runAnnotation(annotationsState, imageId, request)}>
					Run Analysis
				</Button>
				<Button variant="secondary" className="max-sm:min-h-12.5" disabled={!active} title={active ? undefined : 'No analysis of this image is running.'} onClick={() => latest && void cancelAnnotation(latest.jobId)}>
					Cancel Analysis
				</Button>
			</Actions>
			{unavailable && <Notice>{unavailable}</Notice>}
			{!unavailable && imageId !== undefined && !wcsAvailable && (
				<>
					<Notice>This image has no WCS, so nothing can be identified in it until it is solved.</Notice>
					<Button variant="secondary" className="self-start max-sm:min-h-12.5" onClick={() => selectImageTool(imagesState, documentKey, 'plate-solver')}>
						Open Plate Solving
					</Button>
				</>
			)}
			{context && !context.observation && <Notice>The header has no observation date, so the stars are placed at the current time and no solar-system body can be searched.</Notice>}
			{submitError && <Notice error>{submitError}</Notice>}
			{latest ? <JobStatus latest={latest} shown={shown} noun="analysis" /> : imageId !== undefined && wcsAvailable && <Notice>No analysis of this image yet.</Notice>}
			{shown && !active && !answered && <Notice warning>The WCS changed or the magnitude limit was raised since this result; run the analysis again to apply them.</Notice>}
		</CollapsibleSection>
	)
}

interface AnalysisSettingsProps {
	// Section identifier, one per state of the panel so each keeps its own expanded state.
	readonly id: string
	// Whether the section starts expanded.
	readonly defaultOpen: boolean
	// WCS the next run uses: the plate solution shown, the image header's, or none.
	readonly wcs?: 'solution' | 'header'
	// Observation date and site the image header gives, once fetched.
	readonly context?: AnnotationImageContext
	// Faintest magnitude kept.
	readonly magnitudeLimit: number
	// Changes the magnitude limit.
	readonly onMagnitudeLimitChange: (magnitudeLimit: number) => void
}

// What the next run annotates with, summarized while collapsed: the WCS, the observation date and site of the image
// header with where each came from, and the magnitude limit, which hides fainter stars and deep-sky objects of the
// result at once and needs a new run only when raised.
function AnalysisSettings({ id, defaultOpen, wcs, context, magnitudeLimit, onMagnitudeLimitChange }: AnalysisSettingsProps) {
	const timeZone = useActiveTimeZone()
	const observation = context?.observation
	const wcsLabel = wcs === 'solution' ? 'Plate solution' : wcs === 'header' ? 'Image header' : 'No WCS'

	return (
		<CollapsibleSection id={id} title="Analysis Settings" summary={`Mag ≤ ${magnitudeLimit} · ${wcsLabel}`} defaultOpen={defaultOpen}>
			<DataList>
				<DataRow label="WCS">{wcsLabel}</DataRow>
				<DataRow label={observation?.start !== undefined ? 'Mid-exposure' : 'Observation'}>{observation ? `${formatZonedDateTime(observation.time, timeZone)}${observation.approximate ? ' (approximate)' : ''}` : context ? TIME_ORIGIN_LABELS.now : MISSING}</DataRow>
				{observation && <DataRow label="Time from">{TIME_ORIGIN_LABELS[observation.origin]}</DataRow>}
				<DataRow label="Seen from">{context?.site ? formatSite(context.site) : context ? 'Center of the Earth' : MISSING}</DataRow>
				{context?.site && <DataRow label="Site from">{SITE_SOURCE_LABELS[context.site.source]}</DataRow>}
			</DataList>
			<NumberInput label="Magnitude limit" value={magnitudeLimit} min={-2} max={30} step={0.5} suffix="mag" onChange={onMagnitudeLimitChange} />
			<Notice>A brighter limit hides fainter stars and deep-sky objects at once; a fainter one needs a new analysis. The catalog is not complete to any magnitude.</Notice>
		</CollapsibleSection>
	)
}

interface SolarSystemBodiesProps {
	// Server id of the image.
	readonly imageId: string
	// Why no search can run yet.
	readonly unavailable?: string
	// Request Find Bodies Online sends, with the groups it lists.
	readonly request: AnnotationRequest
	// Observation date and site the image header gives, once fetched.
	readonly context?: AnnotationImageContext
	// Solar-system search of the image: its latest job and the one shown.
	readonly view: AnnotationResultView
	// Whether the image has a WCS to search with.
	readonly wcsAvailable: boolean
	// Why the latest submission failed.
	readonly submitError?: string
	// Changes the groups the next search lists.
	readonly onBodiesChange: (bodies: Partial<Record<AnnotationBodyLayer, boolean>>) => void
}

// What a solar-system search waits on: why the document has no image, the WCS, the header being read, its observation
// date, a group chosen, a search running, or a result that already lists the groups chosen.
interface SearchConditions {
	// Why the document has no image yet.
	readonly unavailable?: string
	// Whether the image has a WCS to search with.
	readonly wcsAvailable: boolean
	// Observation date and site of the image header, once fetched.
	readonly context?: AnnotationImageContext
	// Whether at least one group of bodies is chosen.
	readonly chosen: boolean
	// Whether a search of the image is waiting or running.
	readonly active: boolean
	// Whether the result shown already lists the groups chosen.
	readonly answered: boolean
}

// Returns why Find Bodies Online cannot run, the first condition that fails, or undefined when it can.
function searchBlocked({ unavailable, wcsAvailable, context, chosen, active, answered }: SearchConditions): string | undefined {
	if (unavailable !== undefined) return unavailable
	if (!wcsAvailable) return 'This image has no WCS; solve it with Plate Solving first.'
	if (!context) return 'The observation date of the image is being read.'
	if (!context.observation) return 'The header has no observation date to search at.'
	if (!chosen) return 'Choose at least one group of bodies to search for.'
	if (active) return 'A search of this image is running.'
	if (answered) return 'This result already lists the groups chosen; choose another group or change the WCS to search again.'
	return undefined
}

// Optional search of the Sun, Moon, planets, satellites, asteroids, and comets of the field, the groups chosen, with
// the IMCCE SkyBoT service at the observation date of the image header, seen from the site of the header (geocentric
// positions corrected for its parallax) or else from the center of the Earth; collapsed and summarized by its outcome.
// An image without an observation date cannot be searched. It never runs on its own, it is disabled while the result
// shown already lists the groups chosen, and its failure leaves the local annotation as it is. The standing notes on
// the service and the site give way to the warnings of a result, which say the same of that result.
function SolarSystemBodies({ imageId, request, context, view, wcsAvailable, submitError, unavailable, onBodiesChange }: SolarSystemBodiesProps) {
	const { latest, job: shown, result, resultError } = view
	const active = isActive(latest)
	const answered = shown !== undefined && annotationAnswers(shown, request)
	const observation = context?.observation
	const bodies = requestedBodies(request)
	const chosen = bodies.solarSystem || bodies.satellite || bodies.minorBody
	const reason = searchBlocked({ unavailable, wcsAvailable, context, chosen, active, answered })

	return (
		<CollapsibleSection id="images.annotation.solar-system-bodies" title="Solar System Bodies" summary={latest ? jobStatus(latest).label : 'Not searched'} defaultOpen={false}>
			<SectionHeading>Search for</SectionHeading>
			{BODY_LAYERS.map(([layer]) => (
				<Checkbox key={layer} label={LAYER_LABELS[layer]} checked={bodies[layer]} onChange={(listed) => onBodiesChange({ [layer]: listed })} />
			))}
			{wcsAvailable && observation && <DataRow label="Positions">{CENTER_LABELS[observation.center]}</DataRow>}
			<Actions>
				<Button variant="secondary" className="max-sm:min-h-12.5" disabled={reason !== undefined} title={reason ?? SKYBOT_NOTE} onClick={() => void runAnnotation(annotationsState, imageId, request)}>
					Find Bodies Online
				</Button>
				<Button variant="secondary" className="max-sm:min-h-12.5" disabled={!active} title={active ? undefined : 'No search of this image is running.'} onClick={() => latest && void cancelAnnotation(latest.jobId)}>
					Cancel Search
				</Button>
			</Actions>
			{!result && <Notice>Online · IMCCE SkyBoT · predictions, not detections</Notice>}
			{observation && !context.site && !result && <Notice>The header locates no site, so the bodies are geocentric: the Moon may be up to a degree off.</Notice>}
			{submitError && <Notice error>{submitError}</Notice>}
			{latest && <JobStatus latest={latest} shown={shown} noun="search" />}
			{shown && !active && !answered && <Notice warning>The WCS changed or more groups were chosen since this result; search again to apply them.</Notice>}
			{result?.warnings.map((warning) => (
				<Notice key={warning}>{warning}</Notice>
			))}
			{resultError && <Notice error>{resultError}</Notice>}
		</CollapsibleSection>
	)
}

// Formats a site: "23.5500° S, 46.6300° W, 760 m".
function formatSite({ latitude, longitude, elevation }: AnnotationSite): string {
	return `${formatGeographic(latitude, longitude)}, ${formatElevation(elevation)}`
}

interface ObjectsProps {
	// Local annotation of the image: its latest job, the one shown, and its result.
	readonly local: AnnotationResultView
	// Solar-system search of the image: its latest job, the one shown, and its result.
	readonly solar: AnnotationResultView
	// Objects of the shown results: the local annotation and the solar-system search.
	readonly objects: readonly AnnotationObject[]
	// Annotation state of the document, whose groups and magnitude limit filter the list.
	readonly annotation: ImageAnnotationState
	// Id of the selected object.
	readonly selected?: string
	// Selects an object by id.
	readonly onSelect: (id: string) => void
	// Changes whether an object selected in the list is centered in the viewer.
	readonly onCenterSelectedChange: (centerSelected: boolean) => void
}

// Option of the type filter that keeps every type.
const ANY_TYPE = ''

// Returns the count of each group the shown jobs found, in the order they are listed: the local annotation's, then the
// groups the solar-system search listed.
function groupCounts(jobs: readonly (AnnotationJob | undefined)[]): readonly (readonly [AnnotationLayer, number])[] {
	return jobs.flatMap((job) => {
		const counts = job?.summary?.counts
		return job && counts ? countedLayers(job).map((layer) => [layer, counts[layer]] as const) : []
	})
}

// Answer of the panel: how many objects the shown results found as its one Readout, how many of each group, then the
// list of the objects drawn, solar-system bodies included, searched by name or designation and filtered by type.
// Selecting one in the list centers it in the viewer when asked.
function Objects({ local, solar, objects, annotation, selected, onSelect, onCenterSelectedChange }: ObjectsProps) {
	const [type, setType] = useState(ANY_TYPE)
	const counts = groupCounts([local.job, solar.job])
	const total = counts.reduce((sum, [, count]) => sum + count, 0)
	const tally = counts.map(([layer, count]) => countOf(count, LAYER_NOUNS[layer])).join(' · ')
	const drawn = objects.filter((object) => isAnnotationShown(annotation, object))
	const types = [ANY_TYPE, ...new Set(drawn.map((object) => object.typeName).sort())]
	// A type no drawn object has any more, after another result or layer change, keeps every type.
	const chosen = types.includes(type) ? type : ANY_TYPE
	const shown = chosen === ANY_TYPE ? drawn : drawn.filter((object) => object.typeName === chosen)

	return (
		<CollapsibleSection id="images.annotation.objects-in-field" title="Objects in Field" summary={tally}>
			<div className="flex flex-wrap items-baseline justify-between gap-x-3">
				<SectionHeading>Objects</SectionHeading>
				<span className="ml-auto text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-100 tabular-nums">{total}</span>
			</div>
			<DataList>
				{counts.map(([layer, count]) => (
					<DataRow key={layer} label={LAYER_LABELS[layer]}>
						{count}
					</DataRow>
				))}
			</DataList>
			{local.result?.warnings.map((warning) => (
				<Notice key={warning}>{warning}</Notice>
			))}
			{local.resultError && <Notice error>{local.resultError}</Notice>}
			{types.length > 2 && <Select label="Type" options={types} value={chosen} format={(option) => (option === ANY_TYPE ? 'All types' : option)} onChange={setType} />}
			<Checkbox label="Center the selected object" checked={annotation.centerSelected} onChange={onCenterSelectedChange} />
			{/* Every drawn object is listed, however many, in a frame of at most 280 px that draws only the rows in view. */}
			<VirtualList
				items={shown}
				itemKey={objectKey}
				title={objectName}
				description={objectType}
				meta={objectMagnitude}
				selected={selected}
				onSelect={(object) => onSelect(object.id)}
				search={objectSearchText}
				searchPlaceholder="Name or designation"
				emptyText={objects.length > 0 ? 'No object is drawn; check the layers under Display and the magnitude limit.' : 'No catalog object in this field.'}
				className="max-h-80"
			/>
		</CollapsibleSection>
	)
}

interface SelectedObjectProps {
	// Object selected in the list or the viewer.
	readonly object?: AnnotationObject
	// Observation instant of the image, Unix milliseconds (UTC); absent when its header gives no date.
	readonly observationTime?: number
}

// Details of the object selected in the list or the viewer, summarized while collapsed, and its links to the Sky
// workspace, which move the Sky simulation clock to the current time or to the observation instant of the image first.
// A minor body SkyBoT listed has no SPK-ID, so it is looked up in SBDB first and opens only when SBDB knows exactly one
// body by its designation; a satellite other than the Moon is not known to the Sky workspace. The position angle is
// shown only for an elongated object, whose orientation means something.
function SelectedObject({ object, observationTime }: SelectedObjectProps) {
	// Why the SBDB lookup of the selected minor body failed, by object id, and the object being looked up.
	const [lookup, setLookup] = useState<{ readonly id: string; readonly error?: string }>()
	// Id of the object shown while this panel is mounted, so a lookup answering after the selection moved on, or after the
	// panel went away, opens nothing.
	const shown = useRef<string>(undefined)

	useEffect(() => {
		shown.current = object?.id
		return () => {
			shown.current = undefined
		}
	}, [object?.id])
	// The Sky observes from the active profile's site; the image keeps the site of its own header.
	const observer = useActiveSite()

	// Moves the Sky simulation clock to an instant (Unix milliseconds, UTC), or to the real current time when absent,
	// then selects an object of a group in the Sky workspace and opens it; the clock moves first since the selection
	// reads it. A satellite other than the Moon has no ref and never opens. The group is a parameter rather than read
	// from an asserted `object!`, which the React Compiler of the executable reads during the render to memoize this
	// closure, throwing while nothing is selected.
	function openInSky(time: number | undefined, layer: AnnotationLayer, ref: SkySelectionRef, name: string, minorBody?: MinorBody) {
		if (time === undefined) setSkyTimeNow(skyClock)
		else setSkyTime(skyClock, time)
		selectSkyObject(skyState, { ref, source: 'search', name, category: layer === 'satellite' ? 'solarSystem' : layer, ...(minorBody && { minorBody }) }, observer)
		navigate(routeState, { workspace: 'sky' })
	}

	// Opens the selected object in the Sky workspace at an instant (Unix milliseconds, UTC), or at the current time when
	// absent; a minor body without a ref is looked up in SBDB first and opens when found.
	async function open(target: AnnotationObject, time?: number) {
		if (target.ref) return openInSky(time, target.layer, target.ref, target.name)
		setLookup({ id: target.id })
		const body = await resolveMinorBody(target)
		if (shown.current !== target.id) return setLookup((current) => (current?.id === target.id ? undefined : current))
		if (typeof body === 'string') setLookup({ id: target.id, error: body })
		else openInSky(time, target.layer, { kind: 'minorBody', spkId: body.spkId, designation: body.designation }, body.name, body)
	}

	const opens = object !== undefined && (object.ref !== undefined || object.layer === 'minorBody')
	const looking = object !== undefined && lookup?.id === object.id && lookup.error === undefined
	const lookingReason = looking ? 'Looking the body up in SBDB.' : undefined
	const designations = object ? object.designations.filter((e) => !object.name.includes(e)) : []
	const elongated = object?.majorAxis !== undefined && object.minorAxis !== undefined && object.minorAxis < object.majorAxis

	return (
		<CollapsibleSection id="images.annotation.selected-object" title="Selected Object" summary={object && `${object.name} · ${object.typeName}`}>
			{object ? (
				<>
					<DataList>
						<DataRow label="Name">{object.name}</DataRow>
						{designations.length > 0 && <DataRow label="Designations">{designations.join(' · ')}</DataRow>}
						<DataRow label="Type">{object.typeName}</DataRow>
						<DataRow label="Magnitude">{object.magnitude === undefined ? MISSING : formatMagnitude(object.magnitude)}</DataRow>
						<DataRow label="Right ascension (J2000)">{formatRightAscension(object.rightAscension)}</DataRow>
						<DataRow label="Declination (J2000)">{formatDeclination(object.declination)}</DataRow>
						{object.majorAxis !== undefined && <DataRow label="Size">{object.minorAxis === undefined ? formatApparentSize(object.majorAxis) : `${formatApparentSize(object.majorAxis)} × ${formatApparentSize(object.minorAxis)}`}</DataRow>}
						{elongated && object.orientation !== undefined && <DataRow label="Position angle">{formatDegrees(object.orientation)}</DataRow>}
						{object.positionError !== undefined && <DataRow label="Position uncertainty">{formatUncertainty(object.positionError)}</DataRow>}
						{object.center && <DataRow label="Position">{CENTER_LABELS[object.center]}</DataRow>}
					</DataList>
					{opens ? (
						<Actions>
							<Button variant="secondary" className="max-sm:min-h-12.5" disabled={looking} title={lookingReason} onClick={() => void open(object)}>
								Open in Sky Now
							</Button>
							{observationTime !== undefined && (
								<Button variant="secondary" className="max-sm:min-h-12.5" disabled={looking} title={lookingReason} onClick={() => void open(object, observationTime)}>
									Open in Sky at Image Time
								</Button>
							)}
						</Actions>
					) : (
						<Notice>This satellite cannot be opened in the Sky workspace.</Notice>
					)}
					{lookup?.id === object.id && lookup.error && <Notice error>{lookup.error}</Notice>}
				</>
			) : (
				<Notice>Click a marker in the image or an object in the list to inspect it.</Notice>
			)}
		</CollapsibleSection>
	)
}

// Formats a position uncertainty in radians as arcseconds with two significant digits: "0.026″", "45″".
function formatUncertainty(angle: number): string {
	return `${Number(toArcsec(angle).toPrecision(2))}″`
}

interface DisplayProps {
	// Annotation state of the document.
	readonly annotation: ImageAnnotationState
	// Changes how the document draws its annotation, and the profile for the documents opened next.
	readonly onChange: (patch: Parameters<typeof setAnnotationView>[2]) => void
}

// Returns every layer toggle set to shown or hidden.
function allLayers(shown: boolean): AnnotationLayers {
	return { stars: shown, deepSky: shown, solarSystem: shown, satellites: shown, minorBodies: shown, constellations: shown, constellationLabels: shown }
}

// How the overlay is drawn, collapsed and summarized: which groups show, with one action to show or hide them all, and
// the labels and marks. Showing, hiding, or restyling never runs an analysis.
function Display({ annotation, onChange }: DisplayProps) {
	const shownLayers = LAYER_TOGGLES.filter(([toggle]) => annotation.layers[toggle]).length
	const all = shownLayers === LAYER_TOGGLES.length
	const labels = annotation.labels ? `${DENSITY_LABELS[annotation.density]} labels` : 'No labels'

	return (
		<CollapsibleSection id="images.annotation.display" title="Display" summary={`${shownLayers} of ${LAYER_TOGGLES.length} layers · ${labels}`} defaultOpen={false}>
			<SectionHeading>Layers</SectionHeading>
			{LAYER_TOGGLES.map(([toggle, label]) => (
				<Checkbox key={toggle} label={label} checked={annotation.layers[toggle]} onChange={(checked) => onChange({ layers: { [toggle]: checked } })} />
			))}
			<Button variant="secondary" className="self-start max-sm:min-h-12.5" onClick={() => onChange({ layers: allLayers(!all) })}>
				{all ? 'Hide All Layers' : 'Show All Layers'}
			</Button>
			<Group title="Labels and Marks">
				<Checkbox label="Labels" checked={annotation.labels} onChange={(checked) => onChange({ labels: checked })} />
				<SegmentedControl
					label="Label density"
					options={['minimal', 'balanced', 'detailed'] as const}
					value={annotation.density}
					format={(density) => DENSITY_LABELS[density]}
					disabled={!annotation.labels}
					disabledReason={() => (annotation.labels ? undefined : 'The labels are hidden.')}
					onChange={(density) => onChange({ density })}
				/>
				<Checkbox label="Outlines of extended objects" checked={annotation.outlines} onChange={(outlines) => onChange({ outlines })} />
				<Checkbox label="Motion during the exposure" checked={annotation.motion} onChange={(motion) => onChange({ motion })} />
			</Group>
		</CollapsibleSection>
	)
}

// Titled group of controls inside a section, below a divider.
function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
	return (
		<div className="mt-1 flex flex-col gap-2 border-t border-line-100 pt-3">
			<SectionHeading>{title}</SectionHeading>
			{children}
		</div>
	)
}
