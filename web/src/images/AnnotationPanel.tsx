import type { AnnotationJob, AnnotationLayer, AnnotationObject, AnnotationRequest, AnnotationResult, ImageInfo } from 'api'
import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { isAnnotationShown } from '../annotations/AnnotationOverlay'
import { annotationPlateSolveJobId, annotationsState, cancelAnnotation, isActive, runAnnotation, sameAnnotationRequest } from '../annotations/annotations'
import { useAnnotationResult } from '../annotations/useAnnotationResult'
import { Actions, Notice } from '../equipment-control/parts'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { activeProfile, profileState } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { navigate, routeState } from '../shell/route'
import { EmptyState } from '../shell/WorkspaceLayout'
import { formatAngularSize, formatDeclination, formatDegrees, formatMagnitude, formatRightAscension } from '../sky/format'
import { selectSkyObject, skyState } from '../sky/sky'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { List, ListItem } from '../ui/List'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { TextInput } from '../ui/TextInput'
import { useNow } from '../useNow'
import { holdCameraFrame } from './cameratabs'
import { type AnnotationDensity, type ImageAnnotationState, imagesState, imageUnavailableReason, selectAnnotation, setAnnotationView } from './images'
import type { ImageToolPanelProps } from './tools'

// Annotation tool of the Images workspace: identifies the catalog stars, deep-sky objects, constellations, and
// solar-system bodies in the field of the active document from its WCS, on the server, and shows the outcome, the
// groups and appearance of the overlay, the objects in the field, and the object selected in the list or the viewer,
// which opens in the Sky workspace. The WCS is the plate solution shown when it is a completed job of the image, else
// the WCS of its header; nothing is solved implicitly. Run Analysis is the only action that queries the catalog:
// showing, hiding, or restyling the overlay never does. A result always belongs to the image it annotated.

// Text shown for a value the result does not have.
const MISSING = '—'

// Objects listed at most; the overlay still draws every one.
const MAX_LISTED = 300

// Display names of the job states.
const STATE_LABELS: Readonly<Record<AnnotationJob['state'], string>> = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' }

// Display names of the groups.
const LAYER_LABELS: Readonly<Record<AnnotationLayer, string>> = { star: 'Stars', deepSky: 'Deep-sky objects', solarSystem: 'Solar system' }

// Display names of the label densities.
const DENSITY_LABELS: Readonly<Record<AnnotationDensity, string>> = { minimal: 'Minimal', balanced: 'Balanced', detailed: 'Detailed' }

// Display names of where the observation instant came from.
const TIME_ORIGIN_LABELS = { request: 'Set by hand', dateObs: 'DATE-OBS', dateEnd: 'DATE-END and exposure' } as const

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
	const { submitErrors } = useSnapshot(annotationsState)
	const solution = usePlateSolution(imageId, selectedSolution)
	const plateSolveJobId = annotationPlateSolveJobId(solution)
	const wcsAvailable = plateSolveJobId !== undefined || solution.header !== undefined
	const request: AnnotationRequest = { kind: 'local', magnitudeLimit: annotation.magnitudeLimit, ...(plateSolveJobId !== undefined && { plateSolveJobId }) }
	const selected = result && annotation.selected?.jobId === result.jobId ? result.objects.find((e) => e.id === annotation.selected!.id) : undefined
	const edit = (patch: Parameters<typeof setAnnotationView>[2]) => setAnnotationView(imagesState, documentKey, patch)

	return (
		<>
			<Analysis documentKey={documentKey} imageId={imageId} request={request} job={job} wcsAvailable={wcsAvailable} submitError={imageId === undefined ? undefined : submitErrors[imageId]} unavailable={unavailable} />
			<PanelSection title="Layers">
				<Checkbox label="Deep-sky objects" checked={annotation.layers.deepSky} onChange={(deepSky) => edit({ layers: { deepSky } })} />
				<Checkbox label="Stars" checked={annotation.layers.stars} onChange={(stars) => edit({ layers: { stars } })} />
				<Checkbox label="Solar system" checked={annotation.layers.solarSystem} onChange={(solarSystem) => edit({ layers: { solarSystem } })} />
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
				<Notice>A lower limit hides fainter objects at once; a higher one applies to the next analysis. Deep-sky objects of the classic catalogs without a magnitude are always kept.</Notice>
			</PanelSection>
			{imageId !== undefined && (
				<>
					<Objects job={job} result={result} resultError={resultError} annotation={annotation} selected={selected?.id} onSelect={(id) => result && selectAnnotation(imagesState, documentKey, { jobId: result.jobId, id })} />
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
	// Latest job of the image.
	readonly job?: AnnotationJob
	// Whether the image has a WCS to annotate with: the plate solution shown or its header's.
	readonly wcsAvailable: boolean
	// Why the latest submission failed.
	readonly submitError?: string
}

// Run and Cancel, the WCS and observation context, and the state of the latest job. Running holds the frame a camera
// tab shows first, so the frame annotated stays shown.
function Analysis({ documentKey, imageId, request, job, wcsAvailable, submitError, unavailable }: AnalysisProps) {
	const active = isActive(job)
	const now = useNow(active)
	const changed = job && !sameAnnotationRequest(job.request, request)
	const observation = job?.observation

	return (
		<PanelSection title="Source & Status">
			<Property label="WCS">{request.plateSolveJobId !== undefined ? 'Plate solution shown' : wcsAvailable ? 'Image header' : 'None'}</Property>
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
			{submitError && <Notice error>{submitError}</Notice>}
			{job ? (
				<>
					<Property label="Status">{STATE_LABELS[job.state]}</Property>
					<Property label="Elapsed">{formatSeconds(elapsedOf(job, now))}</Property>
					<Property label="Observation">{observation ? new Date(observation.time).toISOString().replace('.000Z', 'Z') : 'Unknown'}</Property>
					{observation && <Property label="Time from">{`${TIME_ORIGIN_LABELS[observation.origin]}${observation.approximate ? ' (approximate)' : ''}`}</Property>}
					{observation && <Property label="Seen from">{observation.center === 'topocentric' ? 'Observer' : 'Center of the Earth'}</Property>}
					{job.error && <Notice error>{job.error}</Notice>}
					{changed && <Notice>The WCS or the magnitude limit changed since this analysis; run it again to apply them.</Notice>}
				</>
			) : (
				imageId !== undefined && <Notice>No analysis of this image yet.</Notice>
			)}
		</PanelSection>
	)
}

interface ObjectsProps {
	// Latest job of the image.
	readonly job?: AnnotationJob
	// Its result, once fetched.
	readonly result?: AnnotationResult
	// Why its result could not be fetched.
	readonly resultError?: string
	// Annotation state of the document, whose groups and magnitude limit filter the list.
	readonly annotation: ImageAnnotationState
	// Id of the selected object.
	readonly selected?: string
	// Selects an object by id.
	readonly onSelect: (id: string) => void
}

// Counts of the latest completed job and the list of the objects shown, filtered by name.
function Objects({ job, result, resultError, annotation, selected, onSelect }: ObjectsProps) {
	const [filter, setFilter] = useState('')
	const summary = job?.summary
	const text = filter.trim().toLowerCase()
	const shown = result?.objects.filter((object) => isAnnotationShown(annotation, object) && (!text || object.name.toLowerCase().includes(text) || object.designations.some((e) => e.toLowerCase().includes(text))))

	return (
		<PanelSection title="Objects in Field">
			{summary ? (
				<>
					{(Object.keys(LAYER_LABELS) as AnnotationLayer[]).map((layer) => (
						<Property key={layer} label={LAYER_LABELS[layer]}>
							{summary.counts[layer]}
						</Property>
					))}
					<Property label="Duration">{formatSeconds(summary.elapsed)}</Property>
					{result?.warnings.map((warning) => (
						<Notice key={warning}>{warning}</Notice>
					))}
					{resultError && <Notice error>{resultError}</Notice>}
					{result && shown && (
						<>
							<TextInput label="Filter" value={filter} placeholder="Name or designation" onChange={(event) => setFilter(event.currentTarget.value)} />
							<List emptyText={result.objects.length > 0 ? 'No object matches.' : 'No catalog object in this field.'} className="max-h-80 overflow-y-auto">
								{shown.slice(0, MAX_LISTED).map((object) => (
									<ListItem key={object.id} title={object.name} description={object.typeName} meta={object.magnitude === undefined ? undefined : formatMagnitude(object.magnitude)} selected={object.id === selected} onClick={() => onSelect(object.id)} />
								))}
							</List>
							{shown.length > MAX_LISTED && <Notice>{`${shown.length - MAX_LISTED} more objects are drawn but not listed; filter by name to find them.`}</Notice>}
						</>
					)}
				</>
			) : (
				<Notice>{job && isActive(job) ? 'Annotating…' : 'No results.'}</Notice>
			)}
		</PanelSection>
	)
}

// Details of the object selected in the list or the viewer, and its link to the Sky workspace.
function SelectedObject({ object }: { readonly object?: AnnotationObject }) {
	const profiles = useSnapshot(profileState)

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
					<Button
						variant="secondary"
						className="self-start"
						onClick={() => {
							selectSkyObject(skyState, { ref: object.ref, source: 'search', name: object.name, category: object.layer }, activeProfile(profiles).settings.sky.observer)
							navigate(routeState, { workspace: 'sky' })
						}}
					>
						Open in Sky
					</Button>
					<Notice>The Sky workspace keeps its own time: it shows the object now, not at the time of this image.</Notice>
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
			<span className="flex-none text-right text-ink-100 tabular-nums">{children}</span>
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
