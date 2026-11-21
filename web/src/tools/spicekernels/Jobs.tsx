import type { SpiceKernelJob } from 'api'
import { useSnapshot } from 'valtio'
import { formatByteSize } from '../../format'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { ProgressBar } from '../../ui/ProgressBar'
import { JOB_STATE_LABELS } from './format'
import { LibrarySection } from './LibrarySection'
import { cancelSpiceKernelJob, jobActive, spiceKernelsState } from './spicekernels'

// Acquisitions of the SPICE Kernel Library: a download, a generation, or an integration with its state and progress,
// its Cancel while it runs, why it failed, and the way to the kernel it added. Shown both where it was started and in the
// list of the server's acquisitions, since a job outlives the view and the tab that started it.

interface JobItemProps {
	readonly job: SpiceKernelJob
	// Shows the kernel the job added in Installed.
	readonly onShowKernel: (id: string) => void
}

// One acquisition.
export function JobItem({ job, onShowKernel }: JobItemProps) {
	const state = useSnapshot(spiceKernelsState)
	const active = jobActive(job)
	const fraction = job.bytes !== undefined && job.totalBytes ? job.bytes / job.totalBytes : undefined
	const outcome = job.state === 'completed' && job.alreadyInstalled ? 'Already installed' : job.state === 'running' && job.unit === 'objects' ? 'Integrating' : JOB_STATE_LABELS[job.state]
	const progress = job.state === 'running' && job.bytes !== undefined ? ` · ${job.unit === 'objects' ? `${job.bytes} of ${job.totalBytes ?? '?'} objects` : `${formatByteSize(job.bytes)}${job.totalBytes ? ` of ${formatByteSize(job.totalBytes)}` : ''}`}` : ''
	const kernel = job.kernelId !== undefined && state.snapshot?.kernels.some((e) => e.id === job.kernelId) ? job.kernelId : undefined

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
				<span className="min-w-0 truncate text-ink-100" title={job.label}>
					{job.label}
				</span>
				<span className="flex items-center gap-3">
					<span className={job.state === 'failed' ? 'text-danger' : job.state === 'completed' ? 'text-success' : 'text-ink-300'}>
						{outcome}
						{progress}
					</span>
					{active && (
						<Button variant="secondary" disabled={state.pending[`job:${job.jobId}`]} onClick={() => void cancelSpiceKernelJob(spiceKernelsState, job.jobId)}>
							Cancel
						</Button>
					)}
					{kernel && (
						<Button variant="secondary" onClick={() => onShowKernel(kernel)}>
							Show in Installed
						</Button>
					)}
				</span>
			</div>
			{active && <ProgressBar fraction={job.state === 'running' ? fraction : undefined} />}
			{job.error && <Notice error>{job.error}</Notice>}
			{state.errors[`job:${job.jobId}`] && <Notice error>{state.errors[`job:${job.jobId}`]}</Notice>}
		</div>
	)
}

interface JobsProps {
	// Shows the kernel a job added in Installed.
	readonly onShowKernel: (id: string) => void
}

// Acquisitions of the server: the active ones with their progress, then the latest ended ones; nothing without any.
export function Jobs({ onShowKernel }: JobsProps) {
	const state = useSnapshot(spiceKernelsState)
	const jobs = state.snapshot?.jobs ?? []
	if (jobs.length === 0) return null

	return (
		<LibrarySection title="Acquisitions">
			<ul className="m-0 flex list-none flex-col gap-3 p-0">
				{jobs.map((job) => (
					<li key={job.jobId}>
						<JobItem job={job} onShowKernel={onShowKernel} />
					</li>
				))}
			</ul>
		</LibrarySection>
	)
}
