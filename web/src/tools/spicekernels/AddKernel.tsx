import type { MinorBody, SpiceCatalogItem, SpiceKernelJob } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize } from '../../format'
import { searchMinorBodies } from '../../sky/sky'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { ProgressBar } from '../../ui/ProgressBar'
import { TextInput } from '../../ui/TextInput'
import { epochDate, JOB_STATE_LABELS } from './format'
import { activeJobs, cancelSpiceKernelJob, downloadSpiceKernel, fetchSpiceCatalog, generateSpiceKernel, spiceKernelsState } from './spicekernels'

// Add Kernel section of the SPICE Kernel Library tool: the curated NAIF downloads, the Horizons generation of a
// small-body kernel over an interval, and the acquisitions of the server with their progress. Nothing is downloaded or
// generated without a click here.

// Years of the interval suggested for a new generation, from today.
const SUGGESTED_YEARS = 10

// Today and SUGGESTED_YEARS later, as UTC dates (YYYY-MM-DD).
function suggestedInterval() {
	const now = new Date()
	const end = new Date(Date.UTC(now.getUTCFullYear() + SUGGESTED_YEARS, now.getUTCMonth(), now.getUTCDate()))
	return { start: now.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

// Add Kernel section.
export function AddKernel() {
	return (
		<>
			<Curated />
			<SmallBody />
			<Jobs />
		</>
	)
}

// Curated NAIF downloads.
function Curated() {
	const state = useSnapshot(spiceKernelsState)
	const [catalog, setCatalog] = useState<readonly SpiceCatalogItem[]>([])

	useEffect(() => {
		const controller = new AbortController()
		void fetchSpiceCatalog(controller.signal).then((items) => !controller.signal.aborted && setCatalog(items))
		return () => controller.abort()
	}, [state.revision])

	return (
		<section className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
			<h2 className="m-0 text-sm font-semibold text-ink-100">Planetary kernels from NASA/NAIF</h2>
			{catalog.map((item) => {
				const key = `download:${item.id}`
				const running = activeJobs(state.snapshot).some((e) => e.key === key)

				return (
					<div key={item.id} className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex min-w-0 flex-col gap-1">
							<span className="text-sm text-ink-100">
								{item.name} · {formatByteSize(item.bytes)}
							</span>
							<span className="text-xs leading-4 text-ink-300">{item.description}</span>
						</div>
						<Button variant={item.kernelId ? 'secondary' : 'primary'} disabled={!!item.kernelId || running || state.pending[key]} onClick={() => void downloadSpiceKernel(spiceKernelsState, item.id)}>
							{item.kernelId ? 'Installed' : running ? 'Downloading…' : 'Download'}
						</Button>
					</div>
				)
			})}
			{catalog.map(
				(item) =>
					state.errors[`download:${item.id}`] && (
						<Notice key={item.id} error>
							{state.errors[`download:${item.id}`]}
						</Notice>
					),
			)}
		</section>
	)
}

// Generation of a small-body kernel: an SBDB search that resolves the body to its SPK-ID, then an interval.
function SmallBody() {
	const state = useSnapshot(spiceKernelsState)
	const [query, setQuery] = useState('')
	const [searching, setSearching] = useState(false)
	const [message, setMessage] = useState<string>()
	const [matches, setMatches] = useState<readonly { readonly designation: string; readonly name: string }[]>([])
	const [body, setBody] = useState<MinorBody>()
	const [interval, setInterval] = useState(suggestedInterval)
	const start = Date.parse(`${interval.start}T00:00:00Z`)
	const end = Date.parse(`${interval.end}T00:00:00Z`)
	const valid = Number.isFinite(start) && Number.isFinite(end) && start < end
	const installed = body ? state.snapshot?.kernels.filter((e) => e.targets.includes(Number(body.spkId))) : undefined

	async function search(text: string) {
		if (!text.trim()) return
		setSearching(true)
		setMessage(undefined)
		setMatches([])

		try {
			const result = await searchMinorBodies(text.trim(), AbortSignal.timeout(30_000))
			if (result.kind === 'found') setBody(result.body)
			else if (result.kind === 'ambiguous') setMatches(result.matches)
			else setMessage(result.message)
		} catch (error) {
			setMessage(Error.isError(error) ? error.message : 'SBDB could not be reached.')
		} finally {
			setSearching(false)
		}
	}

	return (
		<section className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
			<h2 className="m-0 text-sm font-semibold text-ink-100">Asteroid or comet from JPL Horizons</h2>
			<form
				onSubmit={(event) => {
					event.preventDefault()
					void search(query)
				}}
				className="flex flex-wrap items-end gap-2"
			>
				<TextInput label="Asteroid or comet" className="w-72" value={query} placeholder="Ceres, 433, 1P/Halley…" onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
				<Button type="submit" variant="secondary" disabled={searching || !query.trim()}>
					{searching ? 'Searching…' : 'Search SBDB'}
				</Button>
			</form>
			{message && <Notice>{message}</Notice>}
			{matches.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{matches.map((match) => (
						<Button
							key={match.designation}
							variant="secondary"
							onClick={() => {
								setQuery(match.name)
								void search(match.designation)
							}}
						>
							{match.name}
						</Button>
					))}
				</div>
			)}
			{body && (
				<>
					<p className="m-0 text-sm text-ink-100">
						{body.name} · SPK-ID {body.spkId}
					</p>
					{installed && installed.length > 0 && <Notice>Already covered by {installed.map((e) => `${e.name}${e.start !== undefined && e.end !== undefined ? ` (${epochDate(e.start)} – ${epochDate(e.end)})` : ''}`).join(', ')}.</Notice>}
					<div className="flex flex-wrap items-end gap-2">
						<TextInput label="Start (UTC)" type="date" className="w-40" value={interval.start} onChange={(e) => setInterval({ ...interval, start: e.target.value })} />
						<TextInput label="End (UTC)" type="date" className="w-40" value={interval.end} onChange={(e) => setInterval({ ...interval, end: e.target.value })} />
						<Button disabled={!valid || state.pending.generate} onClick={() => void generateSpiceKernel(spiceKernelsState, { spkId: body.spkId, name: body.name, start, end })}>
							Generate
						</Button>
					</div>
					<Notice>Horizons integrates the current orbit of the body over the interval, usually within 1600 to 2500; the kernel is relative to the Sun, so positions also need a planetary kernel.</Notice>
				</>
			)}
			{state.errors.generate && <Notice error>{state.errors.generate}</Notice>}
		</section>
	)
}

// Acquisitions of the server: the active ones with their progress, then the latest ended ones.
function Jobs() {
	const state = useSnapshot(spiceKernelsState)
	const jobs = state.snapshot?.jobs ?? []
	if (jobs.length === 0) return null

	return (
		<section className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
			<h2 className="m-0 text-sm font-semibold text-ink-100">Acquisitions</h2>
			<ul className="m-0 flex list-none flex-col gap-3 p-0">
				{jobs.map((job) => (
					<JobItem key={job.jobId} job={job} />
				))}
			</ul>
		</section>
	)
}

// One acquisition.
function JobItem({ job }: { readonly job: SpiceKernelJob }) {
	const state = useSnapshot(spiceKernelsState)
	const active = job.state !== 'completed' && job.state !== 'failed' && job.state !== 'cancelled'
	const fraction = job.bytes !== undefined && job.totalBytes ? job.bytes / job.totalBytes : undefined
	const outcome = job.state === 'completed' && job.alreadyInstalled ? 'Already installed' : JOB_STATE_LABELS[job.state]

	return (
		<li className="flex flex-col gap-1">
			<div className="flex items-center justify-between gap-3 text-sm">
				<span className="min-w-0 truncate text-ink-100">{job.label}</span>
				<span className="flex items-center gap-3">
					<span className={job.state === 'failed' ? 'text-danger' : 'text-ink-300'}>
						{outcome}
						{job.state === 'running' && job.bytes !== undefined ? ` · ${formatByteSize(job.bytes)}` : ''}
					</span>
					{active && (
						<Button variant="secondary" disabled={state.pending[`job:${job.jobId}`]} onClick={() => void cancelSpiceKernelJob(spiceKernelsState, job.jobId)}>
							Cancel
						</Button>
					)}
				</span>
			</div>
			{active && <ProgressBar fraction={job.state === 'running' ? fraction : undefined} />}
			{job.error && <Notice error>{job.error}</Notice>}
		</li>
	)
}
