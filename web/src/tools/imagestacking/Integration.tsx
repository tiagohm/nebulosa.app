import type { StackingJobSummary, StackingProductSummary, StackingRecipe } from 'api'
import { nanoid } from 'nanoid'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { imagesState, openImage } from '../../images/images'
import { navigate, routeState } from '../../shell/route'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { bytesText } from '../calibrationlibrary/library'
// oxfmt-ignore
import { INTERPOLATION_LABELS, INTERPOLATIONS, memoryText, METHOD_LABELS, METHODS, NORMALIZATION_LABELS, NORMALIZATIONS, PRODUCT_LABELS, PRODUCT_TONES, SIGMA_METHODS, WEIGHTING_LABELS, WEIGHTINGS } from './format'
// oxfmt-ignore
import { cancelStackingRun, deleteStackingProduct, imageStackingRuntime, jobEnded, loadStackingPreflight, loadStackingProduct, startStackingRun } from './projects'
import { MISSING, formatDuration } from '../../format'
import { Actions } from '../../ui/Actions'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { Notice } from '../../ui/Notice'
import { Cell, Row, Table } from './Table'

// Integration and results of an Image Stacking project. Integration edits the recipe, shows what a run would do with it
// (frames, memory, spill, reuse) as the server answers, starts and cancels runs, and follows the one working. Results
// lists the masters of the project with their state, opens them or their coverage in Images, and deletes them; runs are
// not kept, so a failed or cancelled one is only reported while it is the job shown. The server decides what is integrated, reused, or refused; this view never computes it.

// Recipe a new view starts from, the default of the server.
const DEFAULT_RECIPE: StackingRecipe = { method: 'weighted-sigma-clip', weighting: 'quality', normalization: 'background-scale', interpolation: 'bilinear', minimumCoverage: 0.5, sigmaLower: 3, sigmaUpper: 3 }

// Default memory of an integration, in GiB.
const DEFAULT_MEMORY_GIB = 2

// Opens a file of the server in Images.
function openInImages(path: string) {
	void openImage(imagesState, path)
	navigate(routeState, { workspace: 'images' })
}

// Returns the latest run of a project this tab has seen as a job.
function latestRun(jobs: Readonly<Record<string, StackingJobSummary>>, projectId: string) {
	let latest: StackingJobSummary | undefined
	for (const job of Object.values(jobs)) if (job.type === 'integration' && job.projectId === projectId && (!latest || job.createdAt > latest.createdAt)) latest = job
	return latest
}

// Recipe, what a run would do, and the run working.
export function IntegrationView({ projectId }: { readonly projectId: string }) {
	const { preflight, jobs, pending, errors, changes } = useSnapshot(imageStackingRuntime)
	const [recipe, setRecipe] = useState(DEFAULT_RECIPE)
	const [memory, setMemory] = useState(DEFAULT_MEMORY_GIB)
	const job = latestRun(jobs, projectId)
	const running = job !== undefined && !jobEnded(job)
	const memoryBudget = Math.round(memory * 1024 ** 3)
	const plan = preflight
	// Whether a run would integrate nothing: every filter reuses its master, or there is no filter.
	const current = !plan || plan.groups.every((group) => group.reusedProductId !== undefined)

	// Asks the server what a run would do, again whenever the recipe or the project changes.
	useEffect(() => {
		void loadStackingPreflight(imageStackingRuntime, projectId, { recipe, memoryBudget })
	}, [projectId, recipe, memoryBudget, changes])

	function edit(patch: Partial<StackingRecipe>) {
		setRecipe({ ...recipe, ...patch })
	}

	return (
		<>
			<div className="flex flex-wrap items-end gap-3">
				<Select label="Combination" className="w-52" options={METHODS} value={recipe.method} format={(method) => METHOD_LABELS[method]} onChange={(method) => edit({ method })} />
				<Select label="Weighting" className="w-36" options={WEIGHTINGS} value={recipe.weighting} format={(weighting) => WEIGHTING_LABELS[weighting]} onChange={(weighting) => edit({ weighting })} />
				<Select label="Normalization" className="w-48" options={NORMALIZATIONS} value={recipe.normalization} format={(normalization) => NORMALIZATION_LABELS[normalization]} onChange={(normalization) => edit({ normalization })} />
				<Select label="Interpolation" className="w-36" options={INTERPOLATIONS} value={recipe.interpolation} format={(interpolation) => INTERPOLATION_LABELS[interpolation]} onChange={(interpolation) => edit({ interpolation })} />
			</div>
			<div className="flex flex-wrap items-end gap-3">
				<NumberInput label="Minimum Coverage" className="w-36" value={Math.round(recipe.minimumCoverage * 100)} min={1} max={100} suffix="%" onChange={(value) => edit({ minimumCoverage: value / 100 })} />
				{SIGMA_METHODS.has(recipe.method) && (
					<>
						<NumberInput label="Sigma Low" className="w-28" value={recipe.sigmaLower} min={0.5} max={10} step={0.5} onChange={(sigmaLower) => edit({ sigmaLower })} />
						<NumberInput label="Sigma High" className="w-28" value={recipe.sigmaUpper} min={0.5} max={10} step={0.5} onChange={(sigmaUpper) => edit({ sigmaUpper })} />
					</>
				)}
				<NumberInput label="Memory" className="w-28" value={memory} min={0.25} max={64} step={0.25} suffix="GiB" onChange={setMemory} />
			</div>
			<Notice>Every filter is calibrated, registered onto the project grid, normalized to the reference of its filter, and combined into a linear master. Pixels covered by fewer frames than the minimum coverage hold no data. A filter whose inputs did not change reuses its master.</Notice>
			{plan && plan.groups.length > 0 && (
				<Table className="shrink-0" headers={['Filter', 'Frames', 'Exposure', 'Samples', 'Memory', 'Spill', 'Plan']}>
					{plan.groups.map((group) => (
						<Row key={group.groupKey}>
							<Cell>{group.name}</Cell>
							<Cell>{group.frames}</Cell>
							<Cell>{formatDuration(group.exposure)}</Cell>
							<Cell>{group.plan.mode === 'online' ? 'In memory' : `Strips of ${group.plan.stripRows} rows`}</Cell>
							<Cell>{memoryText(group.plan.memoryBytes)}</Cell>
							<Cell>{group.plan.diskBytes > 0 ? memoryText(group.plan.diskBytes) : MISSING}</Cell>
							<Cell>{group.reusedProductId !== undefined ? <StatusBadge tone="neutral" label="Reuses Master" /> : group.plan.fits ? <StatusBadge tone="success" label="Integrates" /> : <StatusBadge tone="danger" label="Does Not Fit" />}</Cell>
						</Row>
					))}
				</Table>
			)}
			{plan?.problems.map((problem) => (
				<Notice key={problem} error>
					{problem}
				</Notice>
			))}
			{running ? (
				<div className="flex flex-wrap items-center gap-3">
					<Notice>{`Integrating ${job.group ?? '…'} · ${job.measured ?? 0} of ${job.found} frames read · ${job.rowsCombined ?? 0} of ${job.rowsTotal ?? 0} rows · ${job.published ?? 0} published`}</Notice>
					<Button variant="secondary" disabled={pending[`run:${job.jobId}`] === true} onClick={() => void cancelStackingRun(imageStackingRuntime, job.jobId)}>
						Cancel
					</Button>
				</div>
			) : (
				<Actions>
					<Button disabled={!plan || plan.problems.length > 0 || current || pending.run === true} onClick={() => void startStackingRun(imageStackingRuntime, projectId, { token: nanoid(), recipe, memoryBudget })}>
						Integrate
					</Button>
					{plan && plan.groups.length > 0 && current && <Notice>Every filter already has a master of these frames and recipe.</Notice>}
				</Actions>
			)}
			{errors.run && <Notice error>{errors.run}</Notice>}
			{job?.state === 'failed' && job.error && <Notice error>{job.error}</Notice>}
			{job?.state === 'cancelled' && <Notice>The run was cancelled; the masters it published stay in Results.</Notice>}
			{job?.state === 'completed' && <Notice>{`The run ended: ${job.published ?? 0} masters published.`}</Notice>}
		</>
	)
}

// Masters of the project.
export function ResultsView() {
	const { products, pending, errors } = useSnapshot(imageStackingRuntime)
	const items = (products ?? []) as readonly StackingProductSummary[]

	async function open(productId: string, coverage: boolean) {
		const detail = await loadStackingProduct(productId)
		if (detail) openInImages(coverage ? detail.coveragePath : detail.path)
	}

	return (
		<>
			{items.length === 0 ? (
				<EmptyState title="No masters" description="Integrate the project to publish a linear master of each filter." />
			) : (
				<Table className="shrink-0" headers={['Filter', 'Frames', 'Exposure', 'Size', 'Grid', 'Published', 'State', '']}>
					{items.map((product) => (
						<Row key={product.productId}>
							<Cell>{product.name}</Cell>
							<Cell>{product.frames}</Cell>
							<Cell>{formatDuration(product.exposure)}</Cell>
							<Cell>{bytesText(product.bytes)}</Cell>
							<Cell>{`${product.width}×${product.height}×${product.channels}`}</Cell>
							<Cell>{new Date(product.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</Cell>
							<Cell>
								<StatusBadge tone={PRODUCT_TONES[product.status]} label={PRODUCT_LABELS[product.status]} />
							</Cell>
							<Cell>
								<div className="flex items-center gap-2">
									<Button disabled={product.status === 'unavailable'} onClick={() => void open(product.productId, false)}>
										Open
									</Button>
									<Button variant="secondary" disabled={product.status === 'unavailable'} onClick={() => void open(product.productId, true)}>
										Coverage
									</Button>
									<ConfirmButton
										title="Delete this master?"
										message="Its files are deleted. The frames stay, and the next run integrates this filter again."
										confirmLabel="Delete"
										disabled={pending[`product:${product.productId}`] === true}
										onConfirm={() => void deleteStackingProduct(imageStackingRuntime, product.productId)}
									>
										Delete
									</ConfirmButton>
								</div>
							</Cell>
						</Row>
					))}
				</Table>
			)}
			{items.flatMap((product) => (product.staleReasons?.length ? [<Notice key={product.productId}>{`${product.name}: ${product.staleReasons.join('; ')}. Integrate again for a master of the frames as they are now.`}</Notice>] : []))}
			{Object.entries(errors).flatMap(([key, error]) =>
				key.startsWith('product:')
					? [
							<Notice key={key} error>
								{error}
							</Notice>,
						]
					: [],
			)}
		</>
	)
}
