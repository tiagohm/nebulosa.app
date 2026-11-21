import type { PointingActivation, PointingFitStrategy, PointingModelDetail, PointingModelSummary, PointingRevision } from 'api'
import { cn } from 'cn'
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { DeviceLink } from '../../equipment-control/DeviceLink'
import { useRoleDevice } from '../../equipment/useEquipment'
import { formatArcsec, formatDate, MISSING } from '../../format'
import { imagesState, selectImage, selectImageTool } from '../../images/images'
import { useActiveTimeZone } from '../../location/useLocation'
import { activatePointingModel, deactivatePointingModel, deletePointingModel, fitPointingModel, importPointingModel, mountPointingRuntime, patchPointingModel, pointingModelExportUrl, selectPointingModel } from '../../mountpointing/mountpointing'
import { PIER_SIDE_WORDS, PointingDiagnostics, PointingMeasures, PointingSampleInspector, PointingVerdict } from '../../mountpointing/PointingDiagnostics'
import { PointingMap, PointingMapLegend, type PointingMapVectors } from '../../mountpointing/PointingMap'
import { shownRevision } from '../../mountpointing/skymap'
import { formatPixelScale } from '../../platesolving/coordinates'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { navigate, routeState } from '../../shell/route'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { formatDeclination, formatRightAscension } from '../../sky/format'
import { Actions } from '../../ui/Actions'
import { Button, buttonClassName } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, SortHeader, Table } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import { ACQUISITION_STATE_LABELS, buildTarget, draftFrom, type FitDraft, FIT_STRATEGIES, FIT_STRATEGY_LABELS, type FitForm, fitRequest, listedModels, openingRevision, revisionNumber, ROBUST_METHOD_LABELS, ROBUST_METHODS, type SampleOrder, sampleRows } from './library'

// Mount Pointing Model tool: the library of the models of the MOUNT of the active equipment setup. It lists and inspects
// models revision by revision, refits them with other options or without some samples, and imports, exports, renames, and
// deletes them, without any camera tab. A model opens on the revision in force on its mount, else on its latest, and the
// map, the measures, the samples, the validation, and the activation all follow the revision chosen. A refit always adds
// a revision: a revision that was fitted never changes. The fit form and the samples left out are a draft of this tab,
// started from the revision shown and kept per model while the tab is open, until Fit asks for a revision; every request
// carries the revision of the model it was made from, and the revision a fit of this tab adds is then shown with how it
// compares with the one it started from. The model and every verdict are the server's. Build New Model is the only way
// from here to the Images workspace, and acquisition happens there: this tool starts no exposure and moves no mount.

// Choices of the arrows of the map, in control order.
const VECTORS: readonly PointingMapVectors[] = ['raw', 'residual', 'none']

// Label of each choice of the arrows.
const VECTOR_LABELS: Readonly<Record<PointingMapVectors, string>> = { raw: 'Raw Errors', residual: 'Left by Model', none: 'No Arrows' }

// Label of each outcome of the offline quality gate.
const GATE_LABELS: Readonly<Record<PointingRevision['gate'], string>> = { unusable: 'Unusable', failed: 'Failed', passed: 'Passed' }

// Columns of the table of samples that do not order it.
const SIDE_COLUMN = 'Side'

// What this tab holds of one model while it is open.
interface ModelViewState {
	// Revision chosen; absent for the one the model opens on.
	readonly revisionId?: string
	// Draft of the next fit once edited; it holds only while its revision is the one shown.
	readonly draft?: FitDraft
	// Sample selected on the map or in the table.
	readonly sampleId?: string
	// Fit this tab asked for and whose revision has not arrived yet: how many revisions there were, and the one shown.
	readonly fitFrom?: { readonly revisionCount: number; readonly revisionId?: string }
	// Revision the latest fit of this tab added, and the revision it started from.
	readonly added?: { readonly revisionId: string; readonly previousId?: string }
}

// What the main view and the panel share of the model shown.
interface ModelContext {
	// Summary of the model.
	readonly summary: PointingModelSummary
	// Complete record, once loaded.
	readonly model?: PointingModelDetail
	// Revision shown.
	readonly revision?: PointingRevision
	// Draft of the next fit.
	readonly draft: FitDraft
	// State of the model in this tab.
	readonly view: ModelViewState
	// Model in force on the mount of the model.
	readonly activation?: PointingActivation
	// Changes the state of the model in this tab.
	readonly update: (patch: Partial<ModelViewState>) => void
}

// Mount Pointing Model tool.
export function MountPointingModel() {
	const mount = useRoleDevice('MOUNT')
	const camera = useRoleDevice('MAIN_CAMERA')
	const runtime = useSnapshot(mountPointingRuntime)
	const images = useSnapshot(imagesState)
	const [all, setAll] = useState(false)
	const [importError, setImportError] = useState<string>()
	const [views, setViews] = useState<Readonly<Record<string, ModelViewState>>>({})
	const input = useRef<HTMLInputElement>(null)
	const hardwareId = mount.device?.hardwareId
	const models = useMemo(() => listedModels(runtime.models as Record<string, PointingModelSummary>, hardwareId, all), [runtime.models, hardwareId, all])
	const selected = models.find((model) => model.modelId === runtime.selectedModelId)
	const target = buildTarget(images.documents, camera.device)
	const context = selected && modelContext(selected, runtime.details[selected.modelId], runtime.activations[selected.mount.hardwareId], views[selected.modelId] ?? {}, (patch) => setViews((current) => ({ ...current, [selected.modelId]: { ...current[selected.modelId], ...patch } })))
	const revisionCount = context?.model?.revisions.length

	// Follows a model until the operator picks another, so the page never opens empty.
	useEffect(() => {
		if (!selected && models.length > 0) selectPointingModel(mountPointingRuntime, models[0].modelId)
	}, [selected, models])

	// Shows the revision a fit of this tab added as soon as it arrives.
	useEffect(() => {
		const fitFrom = context?.view.fitFrom
		const latest = context?.model?.revisions.at(-1)
		if (!fitFrom || !latest || revisionCount === undefined || revisionCount <= fitFrom.revisionCount) return
		context.update({ fitFrom: undefined, revisionId: latest.revisionId, draft: undefined, added: { revisionId: latest.revisionId, previousId: fitFrom.revisionId } })
	}, [context, revisionCount])

	function build() {
		if (!('key' in target)) return
		selectImage(imagesState, target.key)
		selectImageTool(imagesState, target.key, 'pointing-model-builder')
		navigate(routeState, { workspace: 'images' })
	}

	async function importFile({ target: { files } }: ChangeEvent<HTMLInputElement>) {
		const file = files?.[0]
		if (input.current) input.current.value = ''
		if (!file) return

		try {
			setImportError(await importPointingModel(JSON.parse(await file.text()) as never))
		} catch {
			setImportError('The file is not a Nebulosa pointing model export (JSON). Export a model from this tool and import that file.')
		}
	}

	const actions = (
		<Actions>
			<Button disabled={!('key' in target)} title={'reason' in target ? target.reason : undefined} onClick={build}>
				Build New Model
			</Button>
			<Button variant="secondary" onClick={() => input.current?.click()}>
				Import
			</Button>
			<input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importFile(event)} />
		</Actions>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Mount Pointing Model" actions={actions} panel={context ? { title: 'Model', content: <ModelPanel key={context.summary.modelId} context={context} /> } : undefined}>
			<div className="flex h-full flex-col gap-3 overflow-y-auto bg-base-000 p-3">
				<div className="flex flex-wrap items-center gap-3">
					<span className="text-xs text-ink-300">Mount</span>
					<DeviceLink device={mount.device} fallback="Not assigned" />
					<Checkbox label="Every mount" checked={all || !mount.device} onChange={setAll} disabled={!mount.device} title={mount.device ? 'List the models of every mount, which can be read but never used on this one.' : 'No Mount is assigned in Equipment Setup, so every model is listed.'} />
				</div>
				{'reason' in target && <Notice>{target.reason}</Notice>}
				{importError && <Notice error>{importError}</Notice>}
				{models.length === 0 ? (
					<EmptyState title="No models" description="Build a model from the Main Camera, or import one." />
				) : (
					<>
						<ModelList models={models} selected={selected?.modelId} />
						{context && <ModelView context={context} />}
					</>
				)}
			</div>
		</WorkspaceLayout>
	)
}

// Returns what the main view and the panel share of a model: the revision shown (the one chosen while it exists, else the
// one the model opens on) and the draft of the next fit (the one edited while it started from that revision, else one
// started from it).
function modelContext(summary: PointingModelSummary, model: PointingModelDetail | undefined, activation: PointingActivation | undefined, view: ModelViewState, update: ModelContext['update']): ModelContext {
	const revision = model && shownRevision(model, model.revisions.some((each) => each.revisionId === view.revisionId) ? view.revisionId : openingRevision(model, activation))
	const draft = view.draft !== undefined && view.draft.revisionId === revision?.revisionId ? view.draft : draftFrom(revision, model?.samples ?? [])
	return { summary, model, revision, draft, view, activation, update }
}

// The models listed, to choose from. Below 640 px only the name and whether a model is in force remain.
function ModelList({ models, selected }: { readonly models: readonly PointingModelSummary[]; readonly selected?: string }) {
	const runtime = useSnapshot(mountPointingRuntime)
	const timeZone = useActiveTimeZone()

	return (
		<ul className="m-0 flex list-none flex-wrap gap-2 p-0">
			{models.map(({ modelId, label, createdAt, mount, acceptedCount, plannedCount, revisionCount, latest, acquisition }) => (
				<li key={modelId}>
					<button
						type="button"
						onClick={() => selectPointingModel(mountPointingRuntime, modelId)}
						className={cn('flex cursor-pointer flex-col gap-0.5 rounded-md border bg-base-100 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', modelId === selected ? 'border-accent' : 'border-line-200 hover:border-ink-300')}
					>
						<span className="flex items-center gap-2 text-ink-100">
							{label}
							{runtime.activations[mount.hardwareId]?.modelId === modelId && (runtime.activations[mount.hardwareId]?.state === 'active' ? <StatusBadge tone="success" label="In Force" /> : <StatusBadge tone="danger" label="Suspended" />)}
						</span>
						<span className="block text-xs text-ink-300 tabular-nums max-sm:hidden">{`${formatDate(createdAt, timeZone)} · ${acceptedCount} of ${plannedCount} samples · ${revisionCount} ${revisionCount === 1 ? 'revision' : 'revisions'} · ${latest ? FIT_STRATEGY_LABELS[latest.strategy] : ACQUISITION_STATE_LABELS[acquisition.state]}`}</span>
					</button>
				</li>
			))}
		</ul>
	)
}

// Returns the name of a revision in a list of revisions: its number, its strategy, its offline gate, whether the sky
// confirmed it, and whether it is the one in force.
function revisionLabel(model: PointingModelDetail, revision: PointingRevision, activation: PointingActivation | undefined) {
	const verified = revision.verifications.at(-1)
	const words = [
		`Revision ${revisionNumber(model, revision.revisionId)}`,
		FIT_STRATEGY_LABELS[revision.fitted.strategy],
		GATE_LABELS[revision.gate],
		verified ? (verified.passed ? 'Verified' : 'Verification Failed') : undefined,
		activation?.modelId === model.modelId && activation.revisionId === revision.revisionId ? 'In Force' : undefined,
	]
	return words.filter((word) => word !== undefined).join(' · ')
}

// Map, verdict, measures, and the sample selected of the revision shown, with the choice of the revision.
function ModelView({ context }: { readonly context: ModelContext }) {
	const { model, revision, draft, view, activation, update } = context
	const [vectors, setVectors] = useState<PointingMapVectors>('raw')

	if (!model) return <Notice>Loading the model…</Notice>

	const sample = model.samples.find((each) => each.id === view.sampleId)
	const choices = model.revisions.map((each) => each.revisionId).toReversed()

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-end gap-3">
				{revision && <Select label="Revision" options={choices} value={revision.revisionId} format={(revisionId) => revisionLabel(model, model.revisions.find((each) => each.revisionId === revisionId) ?? revision, activation)} onChange={(revisionId) => update({ revisionId, added: undefined })} />}
				<SegmentedControl label="Arrows" options={VECTORS} value={vectors} format={(option) => VECTOR_LABELS[option]} onChange={setVectors} />
			</div>
			{view.added && view.added.revisionId === revision?.revisionId && <AddedRevision model={model} added={view.added} />}
			<PointingVerdict model={model} revision={revision} />
			<div className="flex min-h-0 flex-wrap gap-4">
				<div className="flex w-full max-w-md flex-none flex-col gap-2">
					<div className="aspect-square w-full">
						<PointingMap model={model} residuals={revision?.residuals} vectors={vectors} selected={view.sampleId} onSelect={(sampleId) => update({ sampleId })} excluded={draft.excluded} />
					</div>
					<PointingMapLegend model={model} excluded={draft.excluded} />
				</div>
				<div className="flex min-w-64 flex-1 flex-col gap-4">
					{sample ? <PointingSampleInspector sample={sample} revision={revision} excluded={draft.excluded.has(sample.id)} onExclude={(excluded) => update({ draft: withExclusion(draft, sample.id, excluded) })} /> : <Notice>Select a point of the map, or a row of Samples, to see its sample.</Notice>}
					<PointingMeasures model={model} revision={revision} />
					<PointingDiagnostics model={model} revision={revision} />
				</div>
			</div>
		</div>
	)
}

// Returns a draft with a sample left out of the next fit, or put back.
function withExclusion(draft: FitDraft, sampleId: string, excluded: boolean): FitDraft {
	const next = new Set(draft.excluded)
	if (excluded) next.add(sampleId)
	else next.delete(sampleId)
	return { ...draft, excluded: next }
}

// What the revision a fit of this tab added changed: its offline gate and the error on unseen sky (or on the samples
// fitted, when nothing was withheld) against the revision it started from.
function AddedRevision({ model, added }: { readonly model: PointingModelDetail; readonly added: NonNullable<ModelViewState['added']> }) {
	const revision = model.revisions.find((each) => each.revisionId === added.revisionId)
	const previous = model.revisions.find((each) => each.revisionId === added.previousId)
	if (!revision) return null

	const unseen = revision.offline.heldOutRms !== undefined && previous?.offline.heldOutRms !== undefined
	const measure = unseen ? 'Withheld RMS' : 'Fit Residual'
	const value = (each: PointingRevision) => formatArcsec(unseen ? each.offline.heldOutRms : each.offline.trainingRms)

	return (
		<p className="m-0 text-sm text-ink-200 tabular-nums">
			<span className="font-medium text-ink-100">{`Revision ${revisionNumber(model, revision.revisionId)} added`}</span>
			{previous ? ` · ${measure} ${value(revision)}, Revision ${revisionNumber(model, previous.revisionId)} had ${value(previous)} · ${GATE_LABELS[revision.gate]}, was ${GATE_LABELS[previous.gate]}` : ` · ${measure} ${value(revision)} · ${GATE_LABELS[revision.gate]}`}
		</p>
	)
}

// Sections of the contextual panel of a model.
function ModelPanel({ context }: { readonly context: ModelContext }) {
	const runtime = useSnapshot(mountPointingRuntime)
	const { summary, model, revision, draft, update } = context
	const { modelId, revision: fileRevision } = summary
	const fit = runtime.fits[modelId]
	const pending = runtime.pending[modelId] === true
	const error = runtime.errors[modelId]
	const [label, setLabel] = useState(summary.label)
	const edit = (patch: Partial<FitForm>) => update({ draft: { ...draft, form: { ...draft.form, ...patch } } })
	const number = model && revision ? revisionNumber(model, revision.revisionId) : undefined

	function startFit() {
		update({ fitFrom: { revisionCount: model?.revisions.length ?? 0, revisionId: revision?.revisionId } })
		void fitPointingModel(mountPointingRuntime, modelId, fitRequest(fileRevision, draft.form, draft.excluded))
	}

	return (
		<>
			<CollapsibleSection id="tools.mount-pointing-model.model" title="Model">
				<TextInput label="Name" value={label} onChange={(event) => setLabel(event.target.value)} />
				<DataList>
					<DataRow label="Mount">{summary.mount.name}</DataRow>
					<DataRow label="Camera">{summary.optics.cameraName}</DataRow>
					<DataRow label="Image Scale">{summary.optics.scale === undefined ? MISSING : formatPixelScale(summary.optics.scale)}</DataRow>
					<DataRow label="Origin">{summary.origin === 'import' ? 'Imported' : 'Measured'}</DataRow>
					<DataRow label="Acquisition">{ACQUISITION_STATE_LABELS[summary.acquisition.state]}</DataRow>
				</DataList>
				{summary.origin === 'import' && <Notice>An imported model cannot prove the mount and the optics it was measured on.</Notice>}
				<Actions>
					<Button variant="secondary" disabled={pending || label.trim() === '' || label === summary.label} onClick={() => void patchPointingModel(mountPointingRuntime, modelId, { expectedRevision: fileRevision, label: label.trim() })}>
						Rename
					</Button>
					<a href={pointingModelExportUrl(modelId)} download className={buttonClassName({ variant: 'secondary' })}>
						Export
					</a>
					<ConfirmButton title="Delete the model" confirmLabel="Delete" destructive disabled={pending} onConfirm={() => void deletePointingModel(mountPointingRuntime, modelId)} message={`"${summary.label}" and all its samples and revisions will be deleted. This cannot be undone.`}>
						Delete
					</ConfirmButton>
				</Actions>
				{error && <Notice error>{error}</Notice>}
			</CollapsibleSection>
			{model ? (
				<>
					<CollapsibleSection id="tools.mount-pointing-model.fit" title="Fit & Strategy" summary={FIT_STRATEGY_LABELS[draft.form.strategy]}>
						<Select label="Strategy" options={FIT_STRATEGIES} value={draft.form.strategy} format={(strategy: PointingFitStrategy) => FIT_STRATEGY_LABELS[strategy]} onChange={(strategy) => edit({ strategy })} />
						<Select label="Robust Regression" options={ROBUST_METHODS} value={draft.form.robust} format={(method) => ROBUST_METHOD_LABELS[method]} onChange={(robust) => edit({ robust })} />
						<Checkbox label="Altitude terms" checked={draft.form.altitudeTerms} onChange={(altitudeTerms) => edit({ altitudeTerms })} />
						<Checkbox label="Hour angle terms" checked={draft.form.hourAngleTerms} onChange={(hourAngleTerms) => edit({ hourAngleTerms })} />
						<Checkbox label="Declination terms" checked={draft.form.declinationTerms} onChange={(declinationTerms) => edit({ declinationTerms })} />
						<Button variant="secondary" disabled={pending || fit?.running === true} onClick={startFit}>
							{fit?.running ? 'Fitting…' : 'Fit'}
						</Button>
						<Notice>
							{number === undefined
								? 'A fit adds the first revision of the model.'
								: `Starts from Revision ${number} as it was fitted, with ${draft.excluded.size === 0 ? 'every sample' : `${draft.excluded.size} ${draft.excluded.size === 1 ? 'sample' : 'samples'} left out`}. A fit adds a revision and leaves the earlier ones as they were.`}
						</Notice>
						{fit?.error && <Notice error>{fit.error}</Notice>}
					</CollapsibleSection>
					<SamplesSection context={context} />
					<CollapsibleSection id="tools.mount-pointing-model.validation" title="Validation" summary={revision ? GATE_LABELS[revision.gate] : 'Not fitted'}>
						{revision ? <ValidationRows model={model} revision={revision} /> : <Notice>The model has no fit yet.</Notice>}
						<Notice>Offline quality comes from samples the fit never saw. It is not a measure of a corrected GoTo; On Sky is.</Notice>
					</CollapsibleSection>
					<SoftwareCorrection context={context} pending={pending} />
				</>
			) : (
				<Notice>Loading the model…</Notice>
			)}
		</>
	)
}

// Offline quality and test on the sky of a revision.
function ValidationRows({ model, revision }: { readonly model: PointingModelDetail; readonly revision: PointingRevision }) {
	const verification = revision.verifications.at(-1)

	return (
		<DataList>
			<DataRow label="Revision">{`${revisionNumber(model, revision.revisionId)} of ${model.revisions.length}, ${FIT_STRATEGY_LABELS[revision.fitted.strategy]}`}</DataRow>
			<DataRow label="Offline Quality" tone={revision.gate === 'passed' ? 'success' : 'danger'}>
				{GATE_LABELS[revision.gate]}
			</DataRow>
			<DataRow label="Withheld Samples">{revision.offline.heldOutCount}</DataRow>
			<DataRow label="On Sky" tone={verification ? (verification.passed ? 'success' : 'danger') : undefined}>
				{verification ? (verification.passed ? 'Passed' : 'Failed') : 'Not verified'}
			</DataRow>
			{verification && <DataRow label="Corrected RMS">{formatArcsec(verification.correctedRms)}</DataRow>}
			{verification && <DataRow label="Uncorrected RMS">{formatArcsec(verification.uncorrectedRms)}</DataRow>}
		</DataList>
	)
}

// The accepted samples of a model as a table to curate: whether each goes into the next fit, its pier side, and the error
// the revision shown leaves on it, ordered by point or by that error. A row selects its sample on the map.
function SamplesSection({ context }: { readonly context: ModelContext }) {
	const { model, revision, draft, view, update } = context
	const [order, setOrder] = useState<SampleOrder>('point')
	const rows = useMemo(() => sampleRows(model?.samples ?? [], revision, order), [model?.samples, revision, order])
	const included = rows.length - rows.filter((row) => draft.excluded.has(row.sample.id)).length
	const columns = [
		{
			key: 'point',
			label: (
				<SortHeader direction={order === 'point' ? 'up' : undefined} title="Order by point of the plan" onClick={() => setOrder('point')}>
					Point
				</SortHeader>
			),
		},
		SIDE_COLUMN,
		{
			key: 'error',
			numeric: true,
			label: (
				<SortHeader direction={order === 'error' ? 'down' : undefined} title="Order by the error the revision shown leaves, largest first" onClick={() => setOrder('error')}>
					Left by Model
				</SortHeader>
			),
		},
	]

	return (
		<CollapsibleSection id="tools.mount-pointing-model.samples" title="Samples" summary={`${included} of ${rows.length}`} defaultOpen={false}>
			<Table columns={columns} className="max-h-72">
				{rows.map(({ sample, error }) => (
					<Row key={sample.id} selected={sample.id === view.sampleId} onSelect={() => update({ sampleId: sample.id })}>
						<Cell>
							<Checkbox label={`${sample.waypoint + 1}${sample.role === 'heldOut' ? ' Withheld' : ''}`} title="In the next fit" checked={!draft.excluded.has(sample.id)} onChange={(include) => update({ draft: withExclusion(draft, sample.id, !include) })} className="text-xs" />
						</Cell>
						<Cell>{PIER_SIDE_WORDS[sample.pierSide]}</Cell>
						<Cell numeric>{formatArcsec(error)}</Cell>
					</Row>
				))}
			</Table>
			<Notice>An unchecked sample is left out of the next fit; the sample itself stays in the model.</Notice>
		</CollapsibleSection>
	)
}

// What corrects the GoTos of the mount, and the explicit steps to change it, for the revision shown. A revision is offered
// only once it passed on the sky; the server checks everything again with the values of that moment.
function SoftwareCorrection({ context, pending }: { readonly context: ModelContext; readonly pending: boolean }) {
	const mount = useRoleDevice('MOUNT')
	const runtime = useSnapshot(mountPointingRuntime)
	const [acknowledged, setAcknowledged] = useState(false)
	const { summary, model, revision } = context
	const { device } = mount
	const activation = device ? (runtime.activations[device.hardwareId] as PointingActivation | undefined) : undefined
	const own = activation?.modelId === summary.modelId
	const shownActive = own && activation?.revisionId === revision?.revisionId
	const mine = device?.hardwareId === summary.mount.hardwareId
	const verified = revision?.verifications.at(-1)?.passed === true
	const blocker = !device ? 'No Mount is assigned in Equipment Setup.' : !mine ? 'This model belongs to another mount.' : revision?.gate !== 'passed' ? 'The revision shown did not pass its offline quality.' : !verified ? 'Verify the revision shown on the sky from the Pointing Model Builder first.' : undefined
	const mountDevice = device && { connectionId: device.connectionId, deviceId: device.id }
	const inForce = own && model ? revisionNumber(model, activation.revisionId) : undefined
	const replaces = activation && !shownActive ? (own ? ` It replaces Revision ${inForce}, in force now.` : ` It replaces "${activation.label}", in force now.`) : ''
	const last = activation?.last

	return (
		<CollapsibleSection id="tools.mount-pointing-model.software-correction" title="Software Correction" summary={activation ? (activation.state === 'active' ? 'Active' : 'Suspended') : 'Inactive'}>
			{activation ? (
				<DataList>
					<DataRow label="State" tone={activation.state === 'active' ? 'success' : 'danger'}>
						{activation.state === 'active' ? 'Correcting GoTos' : 'Suspended'}
					</DataRow>
					<DataRow label="Model">{inForce === undefined ? activation.label : `${activation.label}, Revision ${inForce}`}</DataRow>
					{last && (
						<>
							<DataRow label="Latest GoTo" tone={last.refused ? 'danger' : undefined}>
								{last.refused ? 'Refused' : 'Corrected'}
							</DataRow>
							<DataRow label="Asked For">{`${formatRightAscension(last.requested.rightAscension)} ${formatDeclination(last.requested.declination)}`}</DataRow>
							{last.command && <DataRow label="Sent">{`${formatRightAscension(last.command.rightAscension)} ${formatDeclination(last.command.declination)}`}</DataRow>}
						</>
					)}
				</DataList>
			) : (
				<Notice>No model corrects the GoTos of this mount.</Notice>
			)}
			{activation?.reason && <Notice error>{`${activation.reason}. GoTos go uncorrected until a model is activated again.`}</Notice>}
			{last?.pierSideMismatch && <Notice error>The mount took another pier side than the one the latest correction was made for.</Notice>}
			{!shownActive && !blocker && <Checkbox label="No native pointing model corrects the same error, and this mount is equatorial" checked={acknowledged} onChange={setAcknowledged} />}
			{!shownActive && (
				<ConfirmButton
					variant="primary"
					disabled={blocker !== undefined || !acknowledged || pending || !mountDevice || !revision}
					title={blocker ?? 'Activate the revision shown'}
					confirmLabel="Activate"
					onConfirm={() => revision && mountDevice && void activatePointingModel(mountPointingRuntime, summary.modelId, { revisionId: revision.revisionId, mount: mountDevice, nativeModelAcknowledged: acknowledged })}
					message={`Every GoTo Nebulosa sends to ${summary.mount.name} will be corrected by Revision ${model && revision ? revisionNumber(model, revision.revisionId) : MISSING}, until it is deactivated, suspended, or the server restarts.${replaces} Programs talking to the driver directly are not corrected.`}
				>
					Activate
				</ConfirmButton>
			)}
			{activation && own && mountDevice && (
				<Button variant="secondary" disabled={pending} onClick={() => void deactivatePointingModel(mountPointingRuntime, summary.modelId, mountDevice)}>
					Deactivate
				</Button>
			)}
			{blocker && !shownActive && <Notice>{blocker}</Notice>}
			<Notice>A correction applies to the GoTos of Nebulosa, Mount Remote Control included. It never changes tracking, Sync, or manual motion, and a restart leaves it inactive.</Notice>
		</CollapsibleSection>
	)
}
