import { cn } from 'cn'
import type { HipsSurvey } from 'nebulosa/src/adapters/sky/hips2fits'
import { type KeyboardEvent, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import hipsSurveys from '../../../assets/hips.surveys.json.gz' with { type: 'file' }
import { controlRuntime } from '../../equipment-control/control'
import { formatFixed } from '../../format'
import { createFraming, editFraming, framingsState } from '../../framing/framings'
import { isFraming } from '../../framing/geometry'
import { fieldSummary } from '../../framing/OpticsFields'
import { frameSwatch, nextFrameColor } from '../../framing/palette'
import { EQUIPMENT_FRAMING_ID, isSetupFraming, missingCameraName, type ResolvedFraming, useResolvedFramings } from '../../framing/resolve'
import { DEFAULT_SURVEY, loadHipsSurveys, surveyName, surveyRegime } from '../../framing/surveys'
import { catalogTarget } from '../../platesolving/measurement'
import { AngleField } from '../../platesolving/PlateSolveControls'
import { routeState } from '../../shell/route'
import { useWorkspacePanel, WorkspaceLayout, type WorkspacePanelState } from '../../shell/WorkspaceLayout'
import { mountPoint, mountRuntime, mountView } from '../../sky/mount'
import { skyState } from '../../sky/sky'
import { Button } from '../../ui/Button'
import { IconButton } from '../../ui/IconButton'
import { moveIndex } from '../../ui/navigation'
import { Notice } from '../../ui/Notice'
import { SectionHeading } from '../../ui/SectionHeading'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { VirtualSelect } from '../../ui/VirtualSelect'
import { CenterSearch } from './CenterSearch'
import { framingPreviewState, mountCenter, newFramingDocument, newFramingName, type PreviewFit, type PreviewSource, setFramingHidden, setPreviewCenter, showFraming } from './framing'
import { FramingEditor, RotationInput, SaveStatus } from './FramingEditor'
import { FramingPreview } from './FramingPreview'

// Framing tool: the framings every tool chooses its field of view from, one catalog shared by every profile, planned on
// one preview around a J2000 center that no framing holds (an object searched in the catalog, typed coordinates, the
// object selected in Sky, the mount's position, or a point clicked on the preview). The preview is the editor of the
// framing shown: its rotation handle turns it, and the strip under it holds its rotation and opens its details; the
// legend beside it (below it on narrower screens) names every framing in its colour with its field, chooses the one
// shown, and hides any from the preview with the eye at its right, and the contextual panel edits its exact values (the
// URL names it). The Mini-Sky is drawn offline and a survey
// image over it once downloaded; nothing waits on a download. Nothing here moves a device or changes the profile.

// Backgrounds in menu order.
const SOURCES: readonly PreviewSource[] = ['sky', 'survey']

// Fits in menu order.
const FITS: readonly PreviewFit[] = ['all', 'selected']

// Regime of the surveys offered until every wavelength is asked for: visible light, what an astrophotographer frames.
const OPTICAL = 'optical'

// Framing tool.
export function FramingView() {
	const framings = useResolvedFramings()
	const { route } = useSnapshot(routeState)
	const preview = useSnapshot(framingPreviewState)
	const { framings: saved, loaded } = useSnapshot(framingsState)
	const panel = useWorkspacePanel('tools')
	const [error, setError] = useState<string>()
	const selectedId = (route.workspace === 'tools' && route.framing) || EQUIPMENT_FRAMING_ID
	const selected = framings.find((framing) => framing.id === selectedId) ?? framings[0]
	const editable = !isSetupFraming(selected.id)

	// Creates a framing from the Equipment Setup when it gives a field, else from the default optics, and shows it.
	async function create() {
		setError(undefined)

		try {
			const setup = framings[0]
			const document = newFramingDocument(newFramingName(Object.values(framingsState.framings).map((framing) => framing.name)), nextFrameColor(Object.values(framingsState.framings).map((framing) => framing.color)), isFraming(setup.field) ? setup.optics : undefined)
			showFraming(await createFraming(framingsState, document))
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure))
		}
	}

	// Sets the rotation of the framing shown.
	function rotate(rotation: number) {
		editFraming(framingsState, selected.id, (document) => ({ ...document, rotation }))
	}

	const actions = <Button onClick={() => void create()}>New Framing</Button>

	return (
		<WorkspaceLayout workspace="tools" title="Framing" actions={actions} panelState={panel} panel={{ title: selected.name, actions: editable ? <SaveStatus id={selected.id} /> : undefined, content: <FramingEditor key={selected.id} framing={selected} /> }}>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
					{error && <Notice error>{error}</Notice>}
					<CenterControls />
					<ViewControls />
					<div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
						<div className="flex min-w-0 flex-col gap-2">
							<div className="aspect-4/3 max-h-[70vh] min-h-64 lg:aspect-auto lg:h-[min(68vh,46rem)]">
								{preview.center ? (
									<FramingPreview
										framings={framings.filter((framing) => !preview.hidden.includes(framing.id))}
										selectedId={selected.id}
										center={preview.center}
										source={preview.source}
										survey={preview.survey}
										fit={preview.fit}
										onCenter={(center) => setPreviewCenter(framingPreviewState, center)}
										onRotate={editable ? rotate : undefined}
										onShowMiniSky={() => (framingPreviewState.source = 'sky')}
									/>
								) : (
									<div className="flex h-full flex-col items-center justify-center gap-2 rounded-sm border border-line-100 bg-base-100 p-6 text-center">
										<p className="m-0 text-sm leading-5 font-medium text-ink-100">No center yet</p>
										<p className="m-0 max-w-md text-sm leading-5 text-ink-300">Search an object above, type its coordinates, or use the object selected in Sky, and every framing is drawn around it.</p>
									</div>
								)}
							</div>
							<SelectionStrip framing={selected} panel={panel} onRotate={rotate} />
							<BackgroundNote />
						</div>
						<FramingLegend framings={framings} selectedId={selected.id} hidden={preview.hidden} empty={(loaded || Object.keys(saved).length > 0) && framings.every((framing) => isSetupFraming(framing.id))} />
					</div>
				</div>
			</div>
		</WorkspaceLayout>
	)
}

// Center of the preview: an object searched in the catalog, typed coordinates, the Sky selection, or the mount.
function CenterControls() {
	const preview = useSnapshot(framingPreviewState)
	const sky = useSnapshot(skyState)
	const target = catalogTarget(sky.selection)
	const mount = mountView(useSnapshot(mountRuntime), useSnapshot(controlRuntime))
	const pointing = mountPoint(mount, true)
	const mountName = mount.target?.name || 'Mount'
	// Coordinates typed; the center is set once both are, so a right ascension alone never puts it on the equator.
	const [rightAscension, setRightAscension] = useState(preview.center?.rightAscension)
	const [declination, setDeclination] = useState(preview.center?.declination)

	// Follows a center set elsewhere: a search, the Sky, the mount, or a click on the preview.
	useEffect(() => {
		if (!preview.center) return
		setRightAscension(preview.center.rightAscension)
		setDeclination(preview.center.declination)
	}, [preview.center?.rightAscension, preview.center?.declination])

	// Sets the coordinates typed, centering the preview once both are known and clearing it when one is emptied.
	function type(nextRightAscension: number | undefined, nextDeclination: number | undefined) {
		setRightAscension(nextRightAscension)
		setDeclination(nextDeclination)
		setPreviewCenter(framingPreviewState, nextRightAscension === undefined || nextDeclination === undefined ? undefined : { rightAscension: nextRightAscension, declination: nextDeclination })
	}

	return (
		<section className="flex flex-col gap-2">
			<SectionHeading as="h2">Center</SectionHeading>
			<div className="flex flex-wrap items-start gap-3">
				<div className="w-full sm:w-56">
					<CenterSearch onPick={(center, name) => setPreviewCenter(framingPreviewState, center, name)} />
				</div>
				<div className="w-[calc(50%-0.375rem)] sm:w-44">
					<AngleField label="RA (J2000)" hour value={rightAscension} placeholder="Such as 05h 35m 17s" onChange={(value) => type(value, declination)} />
				</div>
				<div className="w-[calc(50%-0.375rem)] sm:w-44">
					<AngleField label="Dec (J2000)" value={declination} placeholder="Such as −05° 23′" onChange={(value) => type(rightAscension, value)} />
				</div>
				<div className="flex flex-wrap gap-2 self-end">
					<Button
						variant="secondary"
						className="max-sm:min-h-12.5"
						disabled={typeof target === 'string'}
						title={typeof target === 'string' ? target : `Centers the preview on ${target.source === 'sky' ? target.name : 'the selection'}.`}
						onClick={() => typeof target !== 'string' && target.source === 'sky' && setPreviewCenter(framingPreviewState, target, target.name)}
					>
						Use Sky Selection
					</Button>
					<Button
						variant="secondary"
						className="max-sm:min-h-12.5"
						disabled={!pointing}
						title={pointing ? `Centers the preview where ${mountName} points now.` : mount.target ? `${mountName} is not connected.` : 'The profile has no mount on an open connection: assign one in the Equipment Setup.'}
						onClick={() => pointing && setPreviewCenter(framingPreviewState, mountCenter(pointing, Date.now()), mountName)}
					>
						Use Mount Position
					</Button>
				</div>
			</div>
			{preview.center && <p className="m-0 text-sm leading-5 text-ink-300">{preview.centerName ? `Centered on ${preview.centerName}.` : 'Centered on the coordinates typed or clicked.'}</p>}
		</section>
	)
}

// Background, survey, and fit of the preview.
function ViewControls() {
	const preview = useSnapshot(framingPreviewState)
	const [surveys, setSurveys] = useState<readonly HipsSurvey[]>()
	const [surveysError, setSurveysError] = useState<string>()

	// Loads the bundled survey catalog once the Survey background is chosen.
	useEffect(() => {
		if (preview.source !== 'survey' || surveys) return
		loadHipsSurveys(hipsSurveys).then(setSurveys, (failure: unknown) => setSurveysError(failure instanceof Error ? failure.message : String(failure)))
	}, [preview.source, surveys])

	// The optical surveys, with the one chosen.
	const options = surveys?.map((survey) => survey.id) ?? []
	const surveyOf = (id: string) => surveys?.find((survey) => survey.id === id)

	return (
		<div className="flex flex-wrap items-end gap-3">
			<SegmentedControl label="Background" options={SOURCES} value={preview.source} onChange={(source) => (framingPreviewState.source = source)} format={(source) => (source === 'sky' ? 'Mini-Sky' : 'Survey')} />
			{preview.source === 'survey' &&
				(surveysError ? (
					<Notice error>{surveysError}</Notice>
				) : surveys && surveys.length === 0 ? (
					<Notice>The survey catalog is empty; run bun make:surveys to download it.</Notice>
				) : (
					<>
						<VirtualSelect
							label="Survey"
							searchable
							searchPlaceholder="Survey or wavelength…"
							className="w-full flex-none sm:w-72"
							options={options.length > 0 ? options : [preview.survey]}
							value={options.includes(preview.survey) ? preview.survey : (options[0] ?? DEFAULT_SURVEY)}
							disabled={!surveys}
							onChange={(survey) => (framingPreviewState.survey = survey)}
							format={(id) => {
								const survey = surveyOf(id)
								return survey ? surveyName(survey) : id
							}}
							group={(id) => {
								const survey = surveyOf(id)
								return survey ? surveyRegime(survey) : 'Surveys'
							}}
						/>
					</>
				))}
			<SegmentedControl label="Fit" options={FITS} value={preview.fit} onChange={(fit) => (framingPreviewState.fit = fit)} format={(fit) => (fit === 'all' ? 'Every' : 'Selected')} />
		</div>
	)
}

// Props of the strip of the framing shown.
interface SelectionStripProps {
	// Framing shown in the panel.
	readonly framing: ResolvedFraming
	// Visibility of the contextual panel.
	readonly panel: WorkspacePanelState
	// Sets the rotation of the framing shown, in degrees.
	readonly onRotate: (rotation: number) => void
}

// Strip under the preview while the panel is not docked beside it: the framing shown, its rotation, and the way to its
// details, so a phone or tablet turns it while watching its outline.
function SelectionStrip({ framing, panel, onRotate }: SelectionStripProps) {
	if (panel.docked && panel.open) return null
	const editable = !isSetupFraming(framing.id)

	return (
		<div className="flex flex-wrap items-end gap-3 rounded-sm border border-line-100 bg-base-100 p-3">
			<div className="flex min-w-0 flex-1 basis-48 items-start gap-2 self-center">
				<span className={cn('mt-1.5 size-3 flex-none rounded-full', frameSwatch(framing.color))} />
				<span className="flex min-w-0 flex-col">
					<span className="text-sm leading-5 font-medium wrap-break-word text-ink-100">{framing.name}</span>
					<span className="text-xs leading-5 text-ink-300">{fieldSummary(framing.field, missingCameraName(framing.camera))}</span>
				</span>
			</div>
			{editable && <RotationInput className="w-48" value={framing.optics.rotation} onChange={onRotate} />}
			<Button variant="secondary" className="max-sm:min-h-12.5" onClick={() => panel.setOpen(true)}>
				{editable ? 'Edit Framing' : 'Show Details'}
			</Button>
		</div>
	)
}

// Note under the preview: what it shows, how to work it, and whom the survey image credits.
function BackgroundNote() {
	const preview = useSnapshot(framingPreviewState)
	const [survey, setSurvey] = useState<HipsSurvey>()

	useEffect(() => {
		if (preview.source !== 'survey') return
		loadHipsSurveys(hipsSurveys).then(
			(surveys) => setSurvey(surveys.find((each) => each.id === preview.survey)),
			() => setSurvey(undefined),
		)
	}, [preview.source, preview.survey])

	const usage = 'North is up and east to the left; the triangle marks the top of each sensor. Click the sky to center it there, and drag the ring of the framing shown to turn it.'
	if (preview.source === 'sky') return <Notice>{usage} Mini-Sky: the stars and deep-sky objects of the sky catalog, drawn without the internet.</Notice>

	return (
		<Notice>
			{usage} Survey image through the CDS hips2fits service{survey ? `: ${surveyName(survey)}` : ''}
			{survey?.copyright ? ` (${survey.copyright})` : ''}, drawn over the Mini-Sky once downloaded.
		</Notice>
	)
}

// Props of the legend.
interface FramingLegendProps {
	// Framings in list order, the Equipment Setup's Main Camera and Guide Camera first.
	readonly framings: readonly ResolvedFraming[]
	// Id of the framing shown.
	readonly selectedId: string
	// Ids of the framings hidden from the preview.
	readonly hidden: readonly string[]
	// Whether no framing was created yet.
	readonly empty: boolean
}

// Moves the focus, and the framing shown, between the legend's framings on an arrow key, Home, or End.
function navigate(event: KeyboardEvent<HTMLUListElement>) {
	const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-framing]')]
	const index = buttons.indexOf(event.target as HTMLButtonElement)
	if (index < 0) return
	const next = moveIndex(index, buttons.length, event.key)
	if (next === undefined) return
	event.preventDefault()
	buttons[next].focus()
	buttons[next].click()
}

// Legend of the preview: every framing with its colour, field, and rotation, choosing the one shown, each with the eye
// that hides it from the preview or shows it again.
function FramingLegend({ framings, selectedId, hidden, empty }: FramingLegendProps) {
	return (
		<section className="flex min-w-0 flex-col gap-2 xl:max-h-[min(68vh,46rem)]">
			<SectionHeading as="h2">Framings</SectionHeading>
			<ul onKeyDown={navigate} className="m-0 grid min-h-0 list-none grid-cols-1 gap-1.5 overflow-y-auto p-0 sm:grid-cols-2 xl:grid-cols-1">
				{framings.map((framing) => {
					const selected = framing.id === selectedId
					const off = hidden.includes(framing.id)

					return (
						<li key={framing.id} className={cn('flex items-center rounded-sm border transition-colors duration-150 motion-reduce:transition-none', selected ? 'border-accent bg-accent-subtle' : 'border-line-100 bg-base-100 hover:bg-base-300')}>
							<button
								type="button"
								data-framing={framing.id}
								tabIndex={selected ? 0 : -1}
								onClick={() => showFraming(framing.id)}
								className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-sm border-0 bg-transparent py-2 pr-1 pl-3 text-left font-mono focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent max-sm:min-h-12.5"
							>
								<span className={cn('mt-1.5 size-3 flex-none rounded-full', frameSwatch(framing.color), off && 'opacity-40')} />
								<span className="flex min-w-0 flex-1 flex-col">
									<span className={cn('text-sm leading-5 font-medium wrap-break-word', selected ? 'text-accent' : off ? 'text-ink-300' : 'text-ink-100')}>{framing.name}</span>
									<span className="text-xs leading-5 text-ink-300">
										{off ? 'Hidden · ' : ''}
										{fieldSummary(framing.field, missingCameraName(framing.camera))}
										{isFraming(framing.field) && !isSetupFraming(framing.id) ? ` · PA ${formatFixed(framing.optics.rotation, 1)}°` : ''}
									</span>
								</span>
							</button>
							<IconButton icon={off ? 'eyeOff' : 'eye'} label={off ? `Show ${framing.name} on the preview` : `Hide ${framing.name} from the preview`} onClick={() => setFramingHidden(framingPreviewState, framing.id, !off)} className="mr-1.5 flex-none max-sm:size-12.5" />
						</li>
					)
				})}
			</ul>
			{empty && <Notice>No framing yet: New Framing starts one from the Equipment Setup, to change its optics or turn its sensor.</Notice>}
		</section>
	)
}
