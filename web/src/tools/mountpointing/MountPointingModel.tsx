import type { PointingFitStrategy, PointingModelDetail, PointingModelSummary, PointingRevision } from 'api'
import { cn } from 'cn'
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { DeviceLink } from '../../equipment-control/DeviceLink'
import { Actions, ConfirmButton, Notice } from '../../equipment-control/parts'
import { useRoleDevice } from '../../equipment/useEquipment'
import { imagesState, selectImage, selectImageTool } from '../../images/images'
import { activatePointingModel, deactivatePointingModel, deletePointingModel, fitPointingModel, importPointingModel, mountPointingRuntime, patchPointingModel, pointingModelExportUrl, selectPointingModel } from '../../mountpointing/mountpointing'
import { formatArcsec, PointingDiagnostics, PointingMeasures, PointingSampleInspector } from '../../mountpointing/PointingDiagnostics'
import { PointingMap, type PointingMapVectors } from '../../mountpointing/PointingMap'
import { shownRevision } from '../../mountpointing/skymap'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { navigate, routeState } from '../../shell/route'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { buildTarget, DEFAULT_FIT_FORM, FIT_STRATEGIES, FIT_STRATEGY_LABELS, type FitForm, fitRequest, listedModels, ROBUST_METHOD_LABELS, ROBUST_METHODS } from './library'

// Mount Pointing Model tool: the library of the models of the MOUNT of the active equipment setup. It lists and inspects
// models, refits them with other options or without some samples, and imports, exports, renames, and deletes them, without
// any camera tab. A refit always adds a revision: a revision that was fitted never changes. The form is a draft of this tab
// until Fit asks for a revision, and every request carries the revision of the file it was made from. The model and every
// verdict are the server's. Build New Model is the only way from here to the Images workspace, and acquisition happens
// there: this tool starts no exposure and moves no mount.

// Choices of the arrows of the map, in control order.
const VECTORS: readonly PointingMapVectors[] = ['raw', 'residual', 'none']

// Label of each choice of the arrows.
const VECTOR_LABELS: Readonly<Record<PointingMapVectors, string>> = { raw: 'Raw Errors', residual: 'Left by Model', none: 'No Arrows' }

// Label of each outcome of the offline quality gate.
const GATE_LABELS: Readonly<Record<PointingRevision['gate'], string>> = { unusable: 'Unusable', failed: 'Failed', passed: 'Passed' }

// Mount Pointing Model tool.
export function MountPointingModel() {
	const mount = useRoleDevice('MOUNT')
	const camera = useRoleDevice('MAIN_CAMERA')
	const runtime = useSnapshot(mountPointingRuntime)
	const images = useSnapshot(imagesState)
	const [all, setAll] = useState(false)
	const [importError, setImportError] = useState<string>()
	const input = useRef<HTMLInputElement>(null)
	const hardwareId = mount.device?.hardwareId
	const models = useMemo(() => listedModels(runtime.models as Record<string, PointingModelSummary>, hardwareId, all), [runtime.models, hardwareId, all])
	const selected = models.find((model) => model.modelId === runtime.selectedModelId)
	const target = buildTarget(images.documents, camera.device)

	// Follows a model until the operator picks another, so the page never opens empty.
	useEffect(() => {
		if (!selected && models.length > 0) selectPointingModel(mountPointingRuntime, models[0].modelId)
	}, [selected, models])

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
			setImportError('The file is not a pointing model.')
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
		<WorkspaceLayout workspace="tools" title="Mount Pointing Model" actions={actions} panel={selected ? { title: 'Model', content: <ModelPanel key={selected.modelId} summary={selected} /> } : undefined}>
			<div className="flex h-full flex-col gap-3 overflow-y-auto bg-base-000 p-3">
				<div className="flex flex-wrap items-center gap-3">
					<span className="text-xs text-ink-300">Mount</span>
					<DeviceLink device={mount.device} fallback="Not assigned" />
					<Checkbox label="Every mount" checked={all} onChange={setAll} />
				</div>
				{'reason' in target && <Notice>{target.reason}</Notice>}
				{importError && <Notice error>{importError}</Notice>}
				{runtime.unavailable.length > 0 && <Notice error>{`${runtime.unavailable.length} model file(s) cannot be used: ${runtime.unavailable.map((each) => `${each.modelId} (${each.reason === 'newerVersion' ? 'newer version' : 'corrupt'})`).join(', ')}.`}</Notice>}
				{models.length === 0 ? (
					<EmptyState title="No models" description="Build a model from the Main Camera, or import one." />
				) : (
					<>
						<ModelList models={models} selected={selected?.modelId} />
						{selected && <ModelView summary={selected} />}
					</>
				)}
			</div>
		</WorkspaceLayout>
	)
}

// The models listed, to choose from.
function ModelList({ models, selected }: { readonly models: readonly PointingModelSummary[]; readonly selected?: string }) {
	return (
		<ul className="m-0 flex list-none flex-wrap gap-2 p-0">
			{models.map(({ modelId, label, createdAt, acceptedCount, plannedCount, revisionCount, latest, acquisition }) => (
				<li key={modelId}>
					<button
						type="button"
						onClick={() => selectPointingModel(mountPointingRuntime, modelId)}
						className={cn('cursor-pointer rounded-md border bg-base-100 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', modelId === selected ? 'border-accent' : 'border-line-200 hover:border-ink-300')}
					>
						<span className="block text-ink-100">{label}</span>
						<span className="block text-xs text-ink-300 tabular-nums">{`${new Date(createdAt).toISOString().slice(0, 10)} · ${acceptedCount}/${plannedCount} samples · ${revisionCount} rev · ${latest ? FIT_STRATEGY_LABELS[latest.strategy] : acquisition.state}`}</span>
					</button>
				</li>
			))}
		</ul>
	)
}

// Map, measures, and samples of a model.
function ModelView({ summary }: { readonly summary: PointingModelSummary }) {
	const runtime = useSnapshot(mountPointingRuntime)
	const model = runtime.details[summary.modelId] as PointingModelDetail | undefined
	const [vectors, setVectors] = useState<PointingMapVectors>('raw')
	const [selected, setSelected] = useState<string>()

	if (!model) return <p className="m-0 text-xs text-ink-300">Loading…</p>

	const revision = shownRevision(model)
	const sample = model.samples.find((each) => each.id === selected)

	return (
		<div className="flex min-h-0 flex-wrap gap-4">
			<div className="aspect-square w-full max-w-md flex-none">
				<PointingMap model={model} residuals={revision?.residuals} vectors={vectors} selected={selected} onSelect={setSelected} />
			</div>
			<div className="flex min-w-64 flex-1 flex-col gap-3">
				<PointingMeasures model={model} revision={revision} />
				<SegmentedControl options={VECTORS} value={vectors} format={(option) => VECTOR_LABELS[option]} onChange={setVectors} />
				{sample ? <PointingSampleInspector sample={sample} revision={revision} /> : <Notice>Select a point of the map to see its sample.</Notice>}
				<PointingDiagnostics model={model} revision={revision} />
			</div>
		</div>
	)
}

// Sections of the contextual panel of a model.
function ModelPanel({ summary }: { readonly summary: PointingModelSummary }) {
	const runtime = useSnapshot(mountPointingRuntime)
	const { modelId, revision: fileRevision } = summary
	const model = runtime.details[modelId] as PointingModelDetail | undefined
	const fit = runtime.fits[modelId]
	const pending = runtime.pending[modelId] === true
	const error = runtime.errors[modelId]
	const [form, setForm] = useState<FitForm>(DEFAULT_FIT_FORM)
	const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
	const [label, setLabel] = useState(summary.label)
	const revision = model && shownRevision(model)
	const accepted = model?.samples.filter((sample) => sample.status === 'accepted') ?? []
	const edit = (patch: Partial<FitForm>) => setForm({ ...form, ...patch })

	function toggle(sampleId: string, included: boolean) {
		const next = new Set(excluded)
		if (included) next.delete(sampleId)
		else next.add(sampleId)
		setExcluded(next)
	}

	return (
		<>
			<CollapsibleSection id="tools.mount-pointing-model.model" title="Model">
				<TextInput label="Name" value={label} onChange={(event) => setLabel(event.target.value)} />
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
					<dt className="text-ink-300">Mount</dt>
					<dd className="m-0 truncate text-right">{summary.mount.name}</dd>
					<dt className="text-ink-300">Camera</dt>
					<dd className="m-0 truncate text-right">{summary.optics.cameraName}</dd>
					<dt className="text-ink-300">Image Scale</dt>
					<dd className="m-0 text-right tabular-nums">{summary.optics.scale === undefined ? '—' : `${formatArcsec(summary.optics.scale)}/px`}</dd>
					<dt className="text-ink-300">Origin</dt>
					<dd className="m-0 text-right">{summary.origin === 'import' ? 'Imported' : 'Measured'}</dd>
					<dt className="text-ink-300">Acquisition</dt>
					<dd className="m-0 text-right capitalize">{summary.acquisition.state}</dd>
				</dl>
				{summary.origin === 'import' && <Notice>An imported model cannot prove the mount and the optics it was measured on.</Notice>}
				<Actions>
					<Button variant="secondary" disabled={pending || label.trim() === '' || label === summary.label} onClick={() => void patchPointingModel(mountPointingRuntime, modelId, { expectedRevision: fileRevision, label: label.trim() })}>
						Rename
					</Button>
					<a href={pointingModelExportUrl(modelId)} download className="text-xs text-accent">
						Export
					</a>
					<ConfirmButton variant="ghost" title="Delete the model" confirmLabel="Delete" disabled={pending} onConfirm={() => void deletePointingModel(mountPointingRuntime, modelId)} message={`"${summary.label}" and all its samples and revisions will be deleted.`}>
						Delete
					</ConfirmButton>
				</Actions>
				{error && <Notice error>{error}</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="tools.mount-pointing-model.fit" title="Fit & Strategy" summary={FIT_STRATEGY_LABELS[form.strategy]}>
				<Select label="Strategy" options={FIT_STRATEGIES} value={form.strategy} format={(strategy: PointingFitStrategy) => FIT_STRATEGY_LABELS[strategy]} onChange={(strategy) => edit({ strategy })} />
				<Select label="Robust Regression" options={ROBUST_METHODS} value={form.robust} format={(method) => ROBUST_METHOD_LABELS[method]} onChange={(robust) => edit({ robust })} />
				<Checkbox label="Altitude terms" checked={form.altitudeTerms} onChange={(altitudeTerms) => edit({ altitudeTerms })} />
				<Checkbox label="Hour angle terms" checked={form.hourAngleTerms} onChange={(hourAngleTerms) => edit({ hourAngleTerms })} />
				<Checkbox label="Declination terms" checked={form.declinationTerms} onChange={(declinationTerms) => edit({ declinationTerms })} />
				<Button disabled={pending || fit?.running === true || !model} onClick={() => void fitPointingModel(mountPointingRuntime, modelId, fitRequest(fileRevision, form, excluded))}>
					{fit?.running ? 'Fitting…' : 'Fit'}
				</Button>
				<Notice>A fit adds a revision of the model and leaves the earlier ones as they were.</Notice>
				{fit?.error && <Notice error>{fit.error}</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="tools.mount-pointing-model.samples" title="Samples" summary={`${accepted.length - excluded.size} of ${accepted.length}`} defaultOpen={false}>
				<ul className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto p-0">
					{accepted.map((sample) => (
						<li key={sample.id}>
							<Checkbox label={`Point ${sample.waypoint + 1}${sample.role === 'heldOut' ? ' (withheld)' : ''}, ${sample.pierSide}`} checked={!excluded.has(sample.id)} onChange={(included) => toggle(sample.id, included)} />
						</li>
					))}
				</ul>
				<Notice>Leaving a sample out applies to the next fit; the sample itself stays in the model.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="tools.mount-pointing-model.validation" title="Validation" summary={revision ? GATE_LABELS[revision.gate] : 'Not fitted'}>
				{revision ? (
					<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
						<dt className="text-ink-300">Revision</dt>
						<dd className="m-0 text-right tabular-nums">{`${model?.revisions.length}, ${FIT_STRATEGY_LABELS[revision.fitted.strategy]}`}</dd>
						<dt className="text-ink-300">Offline Quality</dt>
						<dd className={cn('m-0 text-right', revision.gate === 'passed' ? 'text-success' : 'text-danger')}>{GATE_LABELS[revision.gate]}</dd>
						<dt className="text-ink-300">Withheld Samples</dt>
						<dd className="m-0 text-right tabular-nums">{revision.offline.heldOutCount}</dd>
					</dl>
				) : (
					<Notice>The model has no fit yet.</Notice>
				)}
				<Notice>Offline quality comes from samples the fit never saw. It is not a measure of a corrected GoTo.</Notice>
			</CollapsibleSection>
			<SoftwareCorrection summary={summary} revision={revision} pending={pending} />
		</>
	)
}

interface SoftwareCorrectionProps {
	// Model shown.
	readonly summary: PointingModelSummary
	// Revision shown.
	readonly revision?: PointingRevision
	// Whether a command of the model waits for the server.
	readonly pending: boolean
}

// What corrects the GoTos of the mount, and the explicit steps to change it. A revision is offered only once it passed on the
// sky; the server checks everything again with the values of that moment.
function SoftwareCorrection({ summary, revision, pending }: SoftwareCorrectionProps) {
	const mount = useRoleDevice('MOUNT')
	const runtime = useSnapshot(mountPointingRuntime)
	const [acknowledged, setAcknowledged] = useState(false)
	const { device } = mount
	const activation = device ? runtime.activations[device.hardwareId] : undefined
	const own = activation?.modelId === summary.modelId
	const shownActive = own && activation?.revisionId === revision?.revisionId
	const mine = device?.hardwareId === summary.mount.hardwareId
	const verified = revision?.verifications.at(-1)?.passed === true
	const blocker = !mine ? 'This model belongs to another mount.' : revision?.gate !== 'passed' ? 'The revision did not pass its offline quality.' : !verified ? 'Verify the revision on the sky from the Pointing Model Builder first.' : undefined
	const mountDevice = device && { connectionId: device.connectionId, deviceId: device.id }

	return (
		<CollapsibleSection id="tools.mount-pointing-model.software-correction" title="Software Correction" summary={activation ? (activation.state === 'active' ? 'Active' : 'Suspended') : 'Inactive'}>
			{activation ? (
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
					<dt className="text-ink-300">State</dt>
					<dd className={cn('m-0 text-right', activation.state === 'active' ? 'text-success' : 'text-danger')}>{activation.state === 'active' ? 'Correcting GoTos' : 'Suspended'}</dd>
					<dt className="text-ink-300">Model</dt>
					<dd className="m-0 truncate text-right">{activation.label}</dd>
					{activation.last && (
						<>
							<dt className="text-ink-300">Latest GoTo</dt>
							<dd className="m-0 text-right">{activation.last.refused ? 'Refused' : 'Corrected'}</dd>
						</>
					)}
				</dl>
			) : (
				<Notice>No model corrects the GoTos of this mount.</Notice>
			)}
			{activation?.reason && <Notice error>{`${activation.reason}. GoTos go uncorrected until a model is activated again.`}</Notice>}
			{activation?.last?.pierSideMismatch && <Notice error>The mount took another pier side than the one the latest correction was made for.</Notice>}
			{!shownActive && !blocker && <Checkbox label="No native pointing model corrects the same error, and this mount is equatorial" checked={acknowledged} onChange={setAcknowledged} />}
			{!shownActive && (
				<ConfirmButton
					variant="primary"
					disabled={blocker !== undefined || !acknowledged || pending || !mountDevice || !revision}
					title="Activate the model"
					confirmLabel="Activate"
					onConfirm={() => revision && mountDevice && void activatePointingModel(mountPointingRuntime, summary.modelId, { revisionId: revision.revisionId, mount: mountDevice, nativeModelAcknowledged: acknowledged })}
					message={`Every GoTo Nebulosa sends to ${summary.mount.name} will be corrected by this revision, until it is deactivated, suspended, or the server restarts. Programs talking to the driver directly are not corrected.`}
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
