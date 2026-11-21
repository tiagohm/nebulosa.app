import type { StackingJobSummary, StackingProductSummary, StackingRecipe } from 'api'
import { nanoid } from 'nanoid'
import { type ReactNode, useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize, formatDuration, formatZonedDateTime, MISSING } from '../../format'
import { imagesState, openImage } from '../../images/images'
import { useActiveTimeZone } from '../../location/useLocation'
import { navigate, routeState } from '../../shell/route'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SectionHeading } from '../../ui/SectionHeading'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { byFilter, INTERPOLATION_LABELS, INTERPOLATIONS, memoryText, METHOD_LABELS, METHODS, NORMALIZATION_LABELS, NORMALIZATIONS, PRODUCT_LABELS, PRODUCT_TONES, recipeText, REJECTION_METHODS, REJECTION_MIN_FRAMES, samplesText, SIGMA_METHODS, WEIGHTING_LABELS, WEIGHTINGS } from './format'
import { JobProgress } from './JobProgress'
import { cancelStackingRun, deleteStackingProduct, editStackingDraft, imageStackingRuntime, type IntegrationDraft, jobEnded, loadStackingPreflight, loadStackingProduct, startStackingRun } from './projects'

// Integration of an Image Stacking project and the masters it published. The recipe an operator edits is kept for the
// project while the tab lives, and a new one starts from the recipe of its newest ready master; while a run works, the
// form shows the recipe and memory that run works with, read from its job. What a run would do (frames, memory, disk,
// reuse) is shown as the server answers; runs start, show their progress, and cancel here. The masters are listed by
// filter with the recipe that made them, opened or their coverage opened in Images, and deleted. The server decides what
// is integrated, reused, or refused; this view never computes it.

// Recipe a project starts from without a master, the default of the server.
const DEFAULT_RECIPE: StackingRecipe = { method: 'weighted-sigma-clip', weighting: 'quality', normalization: 'background-scale', interpolation: 'bilinear', minimumCoverage: 0.5, sigmaLower: 3, sigmaUpper: 3 }

// Default memory of an integration, in GiB.
const DEFAULT_MEMORY_GIB = 2

// Opens a file of the server in Images.
function openInImages(path: string) {
	void openImage(imagesState, path)
	navigate(routeState, { workspace: 'images' })
}

// Returns the latest run of a project this tab has seen as a job.
export function latestRun(jobs: Readonly<Record<string, StackingJobSummary>>, projectId: string) {
	let latest: StackingJobSummary | undefined
	for (const job of Object.values(jobs)) if (job.type === 'integration' && job.projectId === projectId && (!latest || job.createdAt > latest.createdAt)) latest = job
	return latest
}

// Labelled group of fields of the recipe.
function FieldGroup({ title, children }: { readonly title: string; readonly children: ReactNode }) {
	return (
		<div className="flex flex-col gap-2">
			<SectionHeading>{title}</SectionHeading>
			<div className="flex flex-wrap items-end gap-3">{children}</div>
		</div>
	)
}

// Recipe, what a run would do, the run working, and the masters of the project.
export function IntegrationView({ projectId }: { readonly projectId: string }) {
	const { preflight, jobs, pending, errors, changes, drafts, products } = useSnapshot(imageStackingRuntime)
	const job = latestRun(jobs, projectId)
	const running = job !== undefined && !jobEnded(job)
	const newest = products?.find((product) => product.status === 'ready')
	const draft: IntegrationDraft = drafts[projectId] ?? { recipe: newest?.recipe ?? DEFAULT_RECIPE, memory: DEFAULT_MEMORY_GIB }
	// The recipe and memory shown: those the running job works with, or the draft.
	const recipe = running && job.recipe ? job.recipe : draft.recipe
	const memory = running && job.memoryBudget ? job.memoryBudget / 1024 ** 3 : draft.memory
	const memoryBudget = Math.round(memory * 1024 ** 3)
	const plan = preflight
	// Whether a run would integrate nothing: every filter reuses its master, or there is no filter.
	const current = !plan || plan.groups.every((group) => group.reusedProductId !== undefined)
	// Filters a run would integrate with too few frames for its rejection to find outliers.
	const few = REJECTION_METHODS.has(recipe.method) ? (plan?.groups.filter((group) => group.reusedProductId === undefined && group.frames < REJECTION_MIN_FRAMES).map((group) => group.name) ?? []) : []
	const reason = !plan ? 'Working out what a run would do' : plan.problems.length > 0 ? plan.problems[0] : current ? 'Every filter already has a master of these frames and recipe' : undefined

	// Asks the server what a run would do, again whenever the recipe or the project changes.
	useEffect(() => {
		void loadStackingPreflight(imageStackingRuntime, projectId, { recipe, memoryBudget })
	}, [projectId, recipe, memoryBudget, changes])

	function edit(patch: Partial<StackingRecipe>) {
		editStackingDraft(imageStackingRuntime, projectId, { ...draft, recipe: { ...draft.recipe, ...patch } })
	}

	return (
		<>
			<div className="flex flex-wrap gap-x-7 gap-y-3">
				<FieldGroup title="Combination">
					<Select label="Method" className="w-56 flex-none" options={METHODS} value={recipe.method} disabled={running} format={(method) => METHOD_LABELS[method]} onChange={(method) => edit({ method })} />
					{SIGMA_METHODS.has(recipe.method) && (
						<>
							<NumberInput label="Sigma Low" className="w-40 min-w-0 flex-none" value={recipe.sigmaLower} min={0.5} max={10} step={0.5} suffix="σ" disabled={running} onChange={(sigmaLower) => edit({ sigmaLower })} />
							<NumberInput label="Sigma High" className="w-40 min-w-0 flex-none" value={recipe.sigmaUpper} min={0.5} max={10} step={0.5} suffix="σ" disabled={running} onChange={(sigmaUpper) => edit({ sigmaUpper })} />
						</>
					)}
				</FieldGroup>
				<FieldGroup title="Weights">
					<Select label="Weighting" className="w-36 flex-none" options={WEIGHTINGS} value={recipe.weighting} disabled={running} format={(weighting) => WEIGHTING_LABELS[weighting]} onChange={(weighting) => edit({ weighting })} />
					<Select label="Normalization" className="w-48 flex-none" options={NORMALIZATIONS} value={recipe.normalization} disabled={running} format={(normalization) => NORMALIZATION_LABELS[normalization]} onChange={(normalization) => edit({ normalization })} />
				</FieldGroup>
				<FieldGroup title="Grid">
					<Select label="Interpolation" className="w-36 flex-none" options={INTERPOLATIONS} value={recipe.interpolation} disabled={running} format={(interpolation) => INTERPOLATION_LABELS[interpolation]} onChange={(interpolation) => edit({ interpolation })} />
					<NumberInput label="Minimum Coverage" className="w-40 min-w-0 flex-none" value={Math.round(recipe.minimumCoverage * 100)} min={1} max={100} suffix="%" disabled={running} onChange={(value) => edit({ minimumCoverage: value / 100 })} />
				</FieldGroup>
				<FieldGroup title="Resources">
					<NumberInput label="Memory" className="w-44 min-w-0 flex-none" value={memory} min={0.25} max={64} step={0.25} suffix="GiB" disabled={running} onChange={(value) => editStackingDraft(imageStackingRuntime, projectId, { ...draft, memory: value })} />
				</FieldGroup>
			</div>
			{running && job.recipe && <Notice>The fields show the recipe and memory of the run working; changes wait for it to end.</Notice>}
			{few.length > 0 && <Notice warning className="max-w-prose">{`${few.join(', ')} ${few.length === 1 ? 'has' : 'have'} fewer than ${REJECTION_MIN_FRAMES} frames, too few for ${METHOD_LABELS[recipe.method]} to tell an outlier from the signal.`}</Notice>}
			<Notice className="max-w-prose">Each filter is calibrated, registered onto the project grid, normalized to the reference of its filter, and combined into a linear master. Pixels covered by fewer frames than the minimum coverage hold no data. A filter whose inputs did not change reuses its master.</Notice>
			{plan && plan.groups.length > 0 && (
				<Table className="shrink-0" columns={['Filter', 'Frames', 'Exposure', 'Combined', 'Memory', 'Disk', 'Plan']}>
					{plan.groups.map((group) => (
						<Row key={group.groupKey}>
							<Cell>{group.name}</Cell>
							<Cell>{group.frames}</Cell>
							<Cell className="whitespace-nowrap">{formatDuration(group.exposure)}</Cell>
							<Cell>{samplesText(group.plan)}</Cell>
							<Cell className="whitespace-nowrap">{memoryText(group.plan.memoryBytes)}</Cell>
							<Cell className="whitespace-nowrap">{group.plan.diskBytes > 0 ? memoryText(group.plan.diskBytes) : MISSING}</Cell>
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
				<JobProgress job={job} cancelLabel="Cancel Integration" cancelling={pending[`run:${job.jobId}`] === true} onCancel={() => void cancelStackingRun(imageStackingRuntime, job.jobId)} />
			) : (
				<div className="flex flex-wrap items-center gap-3">
					<Button disabled={reason !== undefined || pending.run === true} title={reason} onClick={() => void startStackingRun(imageStackingRuntime, projectId, { token: nanoid(), recipe, memoryBudget })}>
						Integrate
					</Button>
					{plan && plan.groups.length > 0 && current && <Notice>Every filter already has a master of these frames and recipe.</Notice>}
				</div>
			)}
			{errors.run && <Notice error>{errors.run}</Notice>}
			{errors[`run:${job?.jobId}`] && <Notice error>{errors[`run:${job?.jobId}`]}</Notice>}
			{job?.state === 'failed' && job.error && <Notice error>{job.error}</Notice>}
			{job?.state === 'cancelled' && <Notice>The run was cancelled; the masters it published stay below.</Notice>}
			{job?.state === 'completed' && <Notice>{`The run ended: ${job.published ?? 0} ${job.published === 1 ? 'master' : 'masters'} published.`}</Notice>}
			<SectionHeading as="h2" className="mt-2">
				Masters
			</SectionHeading>
			<MastersList />
		</>
	)
}

// Masters of the project, by filter, with the recipe of each.
function MastersList() {
	const timeZone = useActiveTimeZone()
	const { products, pending, errors } = useSnapshot(imageStackingRuntime)
	const items = byFilter((products ?? []) as readonly StackingProductSummary[])

	async function open(productId: string, coverage: boolean) {
		const detail = await loadStackingProduct(productId)
		if (detail) openInImages(coverage ? detail.coveragePath : detail.path)
	}

	return (
		<>
			{items.length === 0 ? (
				<EmptyState title="No masters" description="Integrate the project to publish a linear master of each filter." />
			) : (
				<Table className="shrink-0" columns={['Filter', 'Frames', 'Exposure', 'Recipe', 'Grid', 'Size', 'Published', 'State', '']}>
					{items.map((product) => (
						<Row key={product.productId}>
							<Cell>{product.name}</Cell>
							<Cell>{product.frames}</Cell>
							<Cell className="whitespace-nowrap">{formatDuration(product.exposure)}</Cell>
							<Cell>{recipeText(product.recipe)}</Cell>
							<Cell className="whitespace-nowrap">{`${product.width}×${product.height}×${product.channels}`}</Cell>
							<Cell className="whitespace-nowrap">{formatByteSize(product.bytes)}</Cell>
							<Cell className="whitespace-nowrap">{formatZonedDateTime(product.createdAt, timeZone, false)}</Cell>
							<Cell>
								<StatusBadge tone={PRODUCT_TONES[product.status]} label={PRODUCT_LABELS[product.status]} />
							</Cell>
							<Cell>
								<div className="flex items-center gap-2">
									<Button variant="secondary" disabled={product.status === 'unavailable'} title={product.status === 'unavailable' ? 'Its file is missing' : undefined} onClick={() => void open(product.productId, false)}>
										Open
									</Button>
									<Button variant="secondary" disabled={product.status === 'unavailable'} title={product.status === 'unavailable' ? 'Its file is missing' : 'Opens how many frames cover each pixel'} onClick={() => void open(product.productId, true)}>
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
			{items.flatMap((product) => (product.staleReasons?.length ? [<Notice key={product.productId} warning className="max-w-prose">{`${product.name}: ${product.staleReasons.join('; ')}. Integrate again for a master of the frames as they are now.`}</Notice>] : []))}
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
