import type { StackingJobSummary } from 'api'
import { formatPercent } from '../../format'
import { Button } from '../../ui/Button'
import { ProgressBar } from '../../ui/ProgressBar'
import { jobProgress } from './format'

// Progress of a running analysis, run, or composition of Image Stacking, the same in every step that starts one: the
// stage in words with its counts, the share done as a percentage and a bar (a pulsing bar while it is not known), and the
// command that cancels it.

export interface JobProgressProps {
	// Running job.
	readonly job: StackingJobSummary
	// Label of the cancel command, which names what it stops.
	readonly cancelLabel: string
	// Whether the cancel command is on its way to the server.
	readonly cancelling: boolean
	// Cancels the job.
	readonly onCancel: () => void
}

// Running job with its cancel command.
export function JobProgress({ job, cancelLabel, cancelling, onCancel }: JobProgressProps) {
	const { label, fraction } = jobProgress(job)

	return (
		<div className="flex max-w-3xl flex-col gap-2">
			<div className="flex items-baseline justify-between gap-3 text-xs leading-4 text-ink-200 tabular-nums">
				<span>{label}</span>
				{fraction !== undefined && <span className="flex-none">{formatPercent(fraction)}</span>}
			</div>
			<ProgressBar fraction={fraction} />
			<div>
				<Button variant="secondary" disabled={cancelling} onClick={onCancel}>
					{cancelLabel}
				</Button>
			</div>
		</div>
	)
}
