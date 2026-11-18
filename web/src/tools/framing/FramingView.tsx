import { cn } from 'cn'
import type { HipsSurvey } from 'nebulosa/src/adapters/sky/hips2fits'
import { useCallback, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import hipsSurveys from '../../../assets/hips.surveys.json.gz' with { type: 'file' }
import { controlRuntime } from '../../equipment-control/control'
import { formatFixed } from '../../format'
import { createFraming, framingsState } from '../../framing/framings'
import { fieldSummary } from '../../framing/OpticsFields'
import { frameSwatch } from '../../framing/palette'
import { EQUIPMENT_FRAMING_ID, type ResolvedFraming, useResolvedFramings } from '../../framing/resolve'
import { DEFAULT_SURVEY, loadHipsSurveys, surveyName, surveyRegime } from '../../framing/surveys'
import { catalogTarget } from '../../platesolving/measurement'
import { AngleField } from '../../platesolving/PlateSolveControls'
import { routeState } from '../../shell/route'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { mountPoint, mountRuntime, mountView } from '../../sky/mount'
import { skyState } from '../../sky/sky'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { SectionHeading } from '../../ui/SectionHeading'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { framingPreviewState, mountCenter, newFramingDocument, newFramingName, type PreviewSource, setPreviewCenter, showFraming } from './framing'
import { FramingEditor } from './FramingEditor'
import { FramingPreview } from './FramingPreview'

// Framing tool: the framings every tool chooses its field of view from, one catalog shared by every profile, compared in
// one preview around a J2000 center that no framing holds. The list names each framing with its colour and field, the
// panel edits the one chosen (the URL names it), and the preview draws every framing over the Mini-Sky of the catalog or a
// hips2fits survey cutout, never both; while a cutout downloads, the inputs of the tool are locked, and choosing the
// Mini-Sky again cancels it. Nothing here moves a device or changes the profile.

// Backgrounds in menu order.
const SOURCES: readonly PreviewSource[] = ['sky', 'survey']

// Framing tool.
export function FramingView() {
	const framings = useResolvedFramings()
	const { route } = useSnapshot(routeState)
	const preview = useSnapshot(framingPreviewState)
	const { framings: saved } = useSnapshot(framingsState)
	const [error, setError] = useState<string>()
	const selectedId = (route.workspace === 'tools' && route.framing) || EQUIPMENT_FRAMING_ID
	const selected = framings.find((framing) => framing.id === selectedId) ?? framings[0]
	const locked = preview.downloading
	const onDownloading = useCallback((downloading: boolean) => (framingPreviewState.downloading = downloading), [])

	async function create() {
		setError(undefined)

		try {
			showFraming(await createFraming(framingsState, newFramingDocument(newFramingName(Object.values(framingsState.framings).map((framing) => framing.name)))))
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure))
		}
	}

	const actions = (
		<Button disabled={locked} onClick={() => void create()}>
			New Framing
		</Button>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Framing" actions={actions} panel={{ title: selected.name, content: <FramingEditor key={selected.id} framing={selected} locked={locked} /> }}>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
					{error && <Notice error>{error}</Notice>}
					<CenterControls locked={locked} />
					<div className="h-[min(65vh,44rem)] min-h-72">
						{preview.center ? (
							<FramingPreview framings={framings.map((framing, position) => ({ framing, position }))} selectedId={selected.id} center={preview.center} source={preview.source} survey={preview.survey} onDownloading={onDownloading} onShowMiniSky={() => (framingPreviewState.source = 'sky')} />
						) : (
							<div className="flex h-full items-center justify-center rounded-sm border border-line-100 bg-base-100 p-6 text-center text-sm leading-5 text-ink-300">Enter a center, or use the object selected in Sky, to compare the framings on the sky.</div>
						)}
					</div>
					<BackgroundNote />
					<FramingList framings={framings} selectedId={selected.id} loaded={Object.keys(saved).length > 0 || framingsState.loaded} />
				</div>
			</div>
		</WorkspaceLayout>
	)
}

// Center and background of the preview.
function CenterControls({ locked }: { readonly locked: boolean }) {
	const preview = useSnapshot(framingPreviewState)
	const sky = useSnapshot(skyState)
	const target = catalogTarget(sky.selection)
	const mount = mountView(useSnapshot(mountRuntime), useSnapshot(controlRuntime))
	const pointing = mountPoint(mount, true)
	const mountName = mount.target?.name || 'Mount'
	const [surveys, setSurveys] = useState<readonly HipsSurvey[]>()
	const [surveysError, setSurveysError] = useState<string>()

	// Loads the bundled survey catalog once the Survey background is chosen.
	useEffect(() => {
		if (preview.source !== 'survey' || surveys) return
		loadHipsSurveys(hipsSurveys).then(setSurveys, (failure: unknown) => setSurveysError(failure instanceof Error ? failure.message : String(failure)))
	}, [preview.source, surveys])

	const options = surveys?.map((survey) => survey.id) ?? []
	const surveyOf = (id: string) => surveys?.find((survey) => survey.id === id)

	return (
		<div className="flex flex-wrap items-end gap-3">
			<div className="w-44">
				<AngleField
					label="RA (J2000)"
					hour
					value={preview.center?.rightAscension}
					placeholder="Such as 05h 35m 17s"
					disabled={locked}
					onChange={(rightAscension) => setPreviewCenter(framingPreviewState, rightAscension === undefined ? undefined : { rightAscension, declination: preview.center?.declination ?? 0 })}
				/>
			</div>
			<div className="w-44">
				<AngleField label="Dec (J2000)" value={preview.center?.declination} placeholder="Such as −05° 23′" disabled={locked} onChange={(declination) => setPreviewCenter(framingPreviewState, declination === undefined ? undefined : { rightAscension: preview.center?.rightAscension ?? 0, declination })} />
			</div>
			<Button
				variant="secondary"
				disabled={locked || typeof target === 'string'}
				title={typeof target === 'string' ? target : `Centers the preview on ${target.source === 'sky' ? target.name : 'the selection'}.`}
				onClick={() => typeof target !== 'string' && target.source === 'sky' && setPreviewCenter(framingPreviewState, target, target.name)}
			>
				Use Sky Selection
			</Button>
			<Button
				variant="secondary"
				disabled={locked || !pointing}
				title={pointing ? `Centers the preview where ${mountName} points now.` : mount.target ? `${mountName} is not connected.` : 'The profile has no mount on an open connection: assign one in the Equipment Setup.'}
				onClick={() => pointing && setPreviewCenter(framingPreviewState, mountCenter(pointing, Date.now()), mountName)}
			>
				Use Mount Position
			</Button>
			<SegmentedControl label="Background" options={SOURCES} value={preview.source} onChange={(source) => (framingPreviewState.source = source)} format={(source) => (source === 'sky' ? 'Mini-Sky' : 'Survey')} />
			{preview.source === 'survey' &&
				(surveysError ? (
					<Notice error>{surveysError}</Notice>
				) : surveys && surveys.length === 0 ? (
					<Notice>The survey catalog is empty; run bun make:surveys to download it.</Notice>
				) : (
					<Select
						label="Survey"
						className="w-72 flex-none"
						options={options.length > 0 ? options : [preview.survey]}
						value={options.includes(preview.survey) ? preview.survey : (options[0] ?? DEFAULT_SURVEY)}
						disabled={locked || !surveys}
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
				))}
			{preview.center && preview.centerName && <p className="m-0 pb-2 text-sm leading-5 text-ink-300">Centered on {preview.centerName}</p>}
		</div>
	)
}

// Note under the preview: what the background shows and whom it credits.
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

	if (preview.source === 'sky') return <Notice>North is up and east to the left. Mini-Sky: the stars and deep-sky objects of the sky catalog, drawn without the internet; the thick side of each outline is the top of its sensor.</Notice>

	return (
		<Notice>
			{preview.downloading ? 'Downloading the survey image from hips2fits… ' : ''}North is up and east to the left. Survey image through the CDS hips2fits service{survey ? `: ${surveyName(survey)}` : ''}
			{survey?.copyright ? ` (${survey.copyright})` : ''}.
		</Notice>
	)
}

// Props of the list of framings.
interface FramingListProps {
	// Framings in list order, the Equipment Setup's first.
	readonly framings: readonly ResolvedFraming[]
	// Id of the framing shown in the panel.
	readonly selectedId: string
	// Whether the framings of the server were read.
	readonly loaded: boolean
}

// Framings with their colour and field, choosing the one the panel edits.
function FramingList({ framings, selectedId, loaded }: FramingListProps) {
	return (
		<section className="flex flex-col gap-2">
			<SectionHeading as="h2">Framings</SectionHeading>
			<ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2 xl:grid-cols-3">
				{framings.map((framing, position) => (
					<li key={framing.id}>
						<button
							type="button"
							onClick={() => showFraming(framing.id)}
							className={cn(
								'flex w-full cursor-pointer items-start gap-3 rounded-sm border px-3 py-2 text-left font-mono transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none',
								framing.id === selectedId ? 'border-accent bg-accent-subtle' : 'border-line-100 bg-base-100 hover:bg-base-300',
							)}
						>
							<span className={cn('mt-1.5 size-3 flex-none rounded-full', frameSwatch(position))} />
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className={cn('text-sm leading-5 font-medium wrap-break-word', framing.id === selectedId ? 'text-accent' : 'text-ink-100')}>{framing.name}</span>
								<span className="text-xs leading-5 text-ink-200">{fieldSummary(framing.field)}</span>
								<span className="text-xs leading-5 wrap-break-word text-ink-300">
									{framing.telescope.label} · {framing.camera.label} · PA {formatFixed(framing.optics.rotation, 1)}°
								</span>
							</span>
						</button>
					</li>
				))}
			</ul>
			{loaded && framings.length === 1 && <Notice>No framing yet: New Framing creates one, from the Equipment Setup, the Equipment Catalog, an AstroBin model, or values typed by hand.</Notice>}
		</section>
	)
}
