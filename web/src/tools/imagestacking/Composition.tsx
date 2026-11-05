import type { StackingCompositeSummary, StackingComposition, StackingJobSummary, StackingProductSummary } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { imagesState, openImage } from '../../images/images'
import { navigate, routeState } from '../../shell/route'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { Slider } from '../../ui/Slider'
import { StatusBadge } from '../../ui/StatusBadge'
import { bytesText } from '../calibrationlibrary/library'
import { PRODUCT_LABELS, PRODUCT_TONES } from './format'
import { COMPOSITION_PRESETS, CUSTOM_PRESET, resolvePreset, weightOf, withoutSource, withWeight } from './presets'
// oxfmt-ignore
import { cancelStackingComposition, deleteStackingComposite, imageStackingRuntime, jobEnded, loadCompositionPreview, loadCompositionValidation, loadStackingComposite, startStackingComposition } from './projects'
import { formatPercent } from '../../format'
import { Actions } from '../../ui/Actions'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { Notice } from '../../ui/Notice'
import { Cell, Row, Table } from './Table'

// Color composition of an Image Stacking project: a preset or a hand-edited mix of its linear masters into RGB, with an
// optional luminance, previewed as the server stretches it, validated by the server, and composed into a linear
// composite. No light frame is read; changing the mix never integrates again. Composites are listed with their state,
// opened in Images, and deleted.

// Output channels, in the order of the weight columns.
const CHANNELS = ['red', 'green', 'blue'] as const

// Delay before a changed composition is previewed, in milliseconds, so editing a weight sends one request.
const PREVIEW_DELAY = 400

// Labels of the planes of a color master.
const PLANE_LABELS = ['Red', 'Green', 'Blue'] as const

// Opens a file of the server in Images.
function openInImages(path: string) {
	void openImage(imagesState, path)
	navigate(routeState, { workspace: 'images' })
}

// Returns the latest composition of a project this tab has seen as a job.
function latestComposition(jobs: Readonly<Record<string, StackingJobSummary>>, projectId: string) {
	let latest: StackingJobSummary | undefined
	for (const job of Object.values(jobs)) if (job.type === 'composition' && job.projectId === projectId && (!latest || job.createdAt > latest.createdAt)) latest = job
	return latest
}

// Text of a master in a choice list.
function masterLabel(product: StackingProductSummary) {
	return `${product.name} · ${new Date(product.createdAt).toISOString().slice(0, 16).replace('T', ' ')}`
}

// Preset, mix, preview, and the composites of the project.
export function CompositionView({ projectId }: { readonly projectId: string }) {
	const { products, composites, composition: validation, jobs, pending, errors } = useSnapshot(imageStackingRuntime)
	const masters = (products ?? []) as readonly StackingProductSummary[]
	const items = (composites ?? []) as readonly StackingCompositeSummary[]
	const [chosen, setPreset] = useState<string>()
	// Preset shown: the one chosen, or the first whose filters have masters.
	const preset = chosen ?? COMPOSITION_PRESETS.find((item) => 'composition' in resolvePreset(item, masters))?.name ?? COMPOSITION_PRESETS[0].name
	const [composition, setComposition] = useState<StackingComposition>()
	const [preview, setPreview] = useState<string>()
	const job = latestComposition(jobs, projectId)
	const running = job !== undefined && !jobEnded(job)
	const resolution =
		preset === CUSTOM_PRESET
			? undefined
			: resolvePreset(
					COMPOSITION_PRESETS.find((item) => item.name === preset)!,
					masters,
				)
	const differs = items.length > 0 && validation !== undefined && items[0].fingerprint !== validation.fingerprint

	// Resolves the preset chosen against the masters, again when they change; Custom keeps the composition shown.
	useEffect(() => {
		if (preset === CUSTOM_PRESET) return
		const resolved = resolvePreset(
			COMPOSITION_PRESETS.find((item) => item.name === preset)!,
			masters,
		)
		setComposition('composition' in resolved ? resolved.composition : undefined)
	}, [preset, masters])

	// Validates the composition shown, again whenever the project changes.
	useEffect(() => {
		void loadCompositionValidation(imageStackingRuntime, projectId, composition)
	}, [projectId, composition, items])

	// Previews the composition shown once it stops changing; a newer one aborts the request of this one.
	useEffect(() => {
		if (!composition) {
			setPreview(undefined)
			return
		}

		const controller = new AbortController()
		let url: string | undefined

		const timer = setTimeout(() => {
			void loadCompositionPreview(projectId, composition, controller.signal).then((blob) => {
				if (!blob || controller.signal.aborted) return
				url = URL.createObjectURL(blob)
				setPreview(url)
			})
		}, PREVIEW_DELAY)

		return () => {
			clearTimeout(timer)
			controller.abort()
			if (url) URL.revokeObjectURL(url)
		}
	}, [projectId, composition])

	function edit(next: StackingComposition) {
		setPreset(CUSTOM_PRESET)
		setComposition({ ...next, preset: CUSTOM_PRESET })
	}

	function addSource() {
		const master = masters.find((product) => product.status !== 'unavailable')
		if (!master) return
		const base = composition ?? { preset: CUSTOM_PRESET, sources: [], mix: { red: [], green: [], blue: [] } }
		edit({ ...base, sources: [...base.sources, { productId: master.productId, plane: 0, gain: 1, offset: 0 }] })
	}

	function setSource(index: number, patch: Partial<StackingComposition['sources'][number]>) {
		if (!composition) return
		edit({ ...composition, sources: composition.sources.map((source, other) => (other === index ? { ...source, ...patch } : source)) })
	}

	async function open(compositeId: string) {
		const detail = await loadStackingComposite(compositeId)
		if (detail) openInImages(detail.path)
	}

	if (masters.length === 0) return <EmptyState title="No masters" description="Integrate the project first: a composite mixes its linear masters." />

	return (
		<>
			<div className="flex flex-wrap items-end gap-3">
				<Select label="Preset" className="w-36" options={[...COMPOSITION_PRESETS.map((item) => item.name), CUSTOM_PRESET]} value={preset} onChange={setPreset} />
				<Button variant="secondary" onClick={addSource}>
					Add Master
				</Button>
			</div>
			{resolution && 'missing' in resolution && <Notice error>{`${preset} needs a mono master of ${resolution.missing.join(', ')}. Integrate those filters, or choose another preset.`}</Notice>}
			{composition && composition.sources.length > 0 && (
				<Table className="shrink-0" headers={['Master', 'Channel', 'Gain', 'Red', 'Green', 'Blue', '']}>
					{composition.sources.map((source, index) => {
						const master = masters.find((product) => product.productId === source.productId)

						return (
							<Row key={`${index}:${source.productId}`}>
								<Cell>
									<Select
										className="w-56"
										options={masters.map((product) => product.productId)}
										value={source.productId}
										format={(id) => {
											const product = masters.find((item) => item.productId === id)
											return product ? masterLabel(product) : 'Unknown master'
										}}
										onChange={(productId) => setSource(index, { productId, plane: 0 })}
									/>
								</Cell>
								<Cell>
									{master && master.channels > 1 ? (
										<Select className="w-28" options={PLANE_LABELS.slice(0, master.channels).map((_, plane) => String(plane))} value={String(source.plane)} format={(plane) => PLANE_LABELS[Number(plane)]} onChange={(plane) => setSource(index, { plane: Number(plane) })} />
									) : (
										'Mono'
									)}
								</Cell>
								<Cell>
									<NumberInput className="w-28" value={source.gain} min={0.05} max={20} step={0.05} onChange={(gain) => setSource(index, { gain })} />
								</Cell>
								{CHANNELS.map((channel) => (
									<Cell key={channel}>
										<NumberInput className="w-28" value={weightOf(composition, channel, index)} min={0} max={10} step={0.1} onChange={(weight) => edit(withWeight(composition, channel, index, weight))} />
									</Cell>
								))}
								<Cell>
									<Button variant="secondary" onClick={() => edit(withoutSource(composition, index))}>
										Remove
									</Button>
								</Cell>
							</Row>
						)
					})}
				</Table>
			)}
			{composition && composition.sources.length > 0 && (
				<div className="flex flex-wrap items-end gap-3">
					<Select
						label="Luminance"
						className="w-56"
						options={['', ...composition.sources.map((_, index) => String(index))]}
						value={composition.luminance === undefined ? '' : String(composition.luminance.source)}
						format={(option) => {
							if (option === '') return 'None'
							const master = masters.find((product) => product.productId === composition.sources[Number(option)].productId)
							return master ? masterLabel(master) : 'Unknown master'
						}}
						onChange={(option) => {
							const { luminance, ...rest } = composition
							edit(option === '' ? rest : { ...rest, luminance: { source: Number(option), alpha: luminance?.alpha ?? 1, match: luminance?.match ?? 'robustLinear' } })
						}}
					/>
					{composition.luminance && (
						<>
							<Slider label={`Luminance weight ${formatPercent(composition.luminance.alpha)}`} className="w-56" value={composition.luminance.alpha} min={0} max={1} step={0.05} onChange={(alpha) => edit({ ...composition, luminance: { ...composition.luminance!, alpha } })} />
							<Select
								label="Match"
								className="w-44"
								options={['robustLinear', 'off'] as const}
								value={composition.luminance.match}
								format={(match) => (match === 'off' ? 'As Integrated' : 'Background and Scale')}
								onChange={(match) => edit({ ...composition, luminance: { ...composition.luminance!, match } })}
							/>
						</>
					)}
				</div>
			)}
			<Notice>Each channel is the weighted mean of its masters after their gain. A luminance master replaces the luminance of the mix by its weight and keeps the color ratios. The composite stays linear and is cropped to the pixels every master covers; the preview alone is stretched.</Notice>
			{validation?.issues.map((issue) => (
				<Notice key={`${issue.code}:${issue.message}`} error={issue.severity === 'blocker'}>
					{issue.message}
				</Notice>
			))}
			{preview && composition && <img src={preview} alt="" className="max-h-96 w-fit max-w-full self-start rounded-md border border-line-100" />}
			{running ? (
				<div className="flex flex-wrap items-center gap-3">
					<Notice>{`Composing · ${job.rowsCombined ?? 0} of ${job.rowsTotal ?? 0} rows`}</Notice>
					<Button variant="secondary" disabled={pending[`compose:${job.jobId}`] === true} onClick={() => void cancelStackingComposition(imageStackingRuntime, job.jobId)}>
						Cancel
					</Button>
				</div>
			) : (
				<Actions>
					<Button disabled={!composition || !validation?.ready || validation.reusedCompositeId !== undefined || pending.compose === true} onClick={() => composition && void startStackingComposition(imageStackingRuntime, projectId, composition)}>
						Compose
					</Button>
					{validation?.reusedCompositeId !== undefined && <Notice>This composition is already published below.</Notice>}
					{differs && validation.reusedCompositeId === undefined && <StatusBadge tone="neutral" label="Differs From The Latest Composite" />}
				</Actions>
			)}
			{errors.compose && <Notice error>{errors.compose}</Notice>}
			{job?.state === 'failed' && job.error && <Notice error>{job.error}</Notice>}
			{items.length > 0 && (
				<Table className="shrink-0" headers={['Composite', 'Size', 'Grid', 'Published', 'State', '']}>
					{items.map((composite) => (
						<Row key={composite.compositeId}>
							<Cell>{composite.composition.preset}</Cell>
							<Cell>{bytesText(composite.bytes)}</Cell>
							<Cell>{`${composite.width}×${composite.height} at ${composite.left}, ${composite.top}`}</Cell>
							<Cell>{new Date(composite.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</Cell>
							<Cell>
								<StatusBadge tone={PRODUCT_TONES[composite.status]} label={PRODUCT_LABELS[composite.status]} />
							</Cell>
							<Cell>
								<div className="flex items-center gap-2">
									<Button disabled={composite.status === 'unavailable'} onClick={() => void open(composite.compositeId)}>
										Open
									</Button>
									<ConfirmButton title="Delete this composite?" message="Its file is deleted. The masters it mixed stay." confirmLabel="Delete" disabled={pending[`composite:${composite.compositeId}`] === true} onConfirm={() => void deleteStackingComposite(imageStackingRuntime, composite.compositeId)}>
										Delete
									</ConfirmButton>
								</div>
							</Cell>
						</Row>
					))}
				</Table>
			)}
		</>
	)
}
