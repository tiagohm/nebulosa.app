import type { ExternalToolCheckStatus, ExternalToolConfigStatus, ExternalToolState } from 'api'
import { tv } from 'tailwind-variants'

// Status badges of an external program: the state of its saved settings and the outcome of its check,
// kept apart because a configured program is not necessarily available. The text label always
// accompanies the color.

// State of a check as shown: its outcome, not tested yet, or in progress in this tab.
export type CheckDisplay = ExternalToolCheckStatus | 'notTested' | 'checking'

// Label of each state of the saved settings.
export const CONFIG_LABELS: Readonly<Record<ExternalToolConfigStatus, string>> = {
	notConfigured: 'Not Configured',
	configured: 'Configured',
	invalid: 'Invalid Configuration',
}

// Label of each state of a check.
export const CHECK_LABELS: Readonly<Record<CheckDisplay, string>> = {
	notTested: 'Not Tested',
	checking: 'Checking',
	available: 'Available',
	unavailable: 'Unavailable',
	failed: 'Test Failed',
}

// Tone of a badge.
type Tone = 'muted' | 'neutral' | 'active' | 'success' | 'danger'

// Tone of each state of the saved settings.
const CONFIG_TONES: Readonly<Record<ExternalToolConfigStatus, Tone>> = { notConfigured: 'muted', configured: 'neutral', invalid: 'danger' }

// Tone of each state of a check.
const CHECK_TONES: Readonly<Record<CheckDisplay, Tone>> = { notTested: 'muted', checking: 'active', available: 'success', unavailable: 'danger', failed: 'danger' }

// Text color of each tone, for list items.
export const TONE_TEXT: Readonly<Record<Tone, string>> = { muted: 'text-ink-300', neutral: 'text-ink-200', active: 'text-accent', success: 'text-success', danger: 'text-danger' }

// Styles of a status badge for each tone.
const badge = tv({
	slots: {
		root: 'inline-flex h-6 flex-none items-center gap-1.5 rounded-full border px-2.5 text-xs leading-none whitespace-nowrap',
		dot: 'size-1.5 rounded-full',
	},
	variants: {
		tone: {
			muted: { root: 'border-dashed border-line-100 text-ink-300', dot: 'hidden' },
			neutral: { root: 'border-line-100 text-ink-200', dot: 'border border-ink-200' },
			active: { root: 'border-accent/50 text-accent', dot: 'animate-pulse bg-accent' },
			success: { root: 'border-success/50 text-success', dot: 'bg-success' },
			danger: { root: 'border-danger/60 text-danger', dot: 'bg-danger' },
		},
	},
})

// Badge of a tone and label.
function Badge({ tone, label }: { readonly tone: Tone; readonly label: string }) {
	const { root, dot } = badge({ tone })
	return (
		<span className={root()}>
			<span className={dot()} />
			{label}
		</span>
	)
}

// Badge of the state of the saved settings.
export function ConfigBadge({ status }: { readonly status: ExternalToolConfigStatus }) {
	return <Badge tone={CONFIG_TONES[status]} label={CONFIG_LABELS[status]} />
}

// Badge of the state of a check.
export function CheckBadge({ status }: { readonly status: CheckDisplay }) {
	return <Badge tone={CHECK_TONES[status]} label={CHECK_LABELS[status]} />
}

// One-line summary of a program for its list item: the state of the settings until they are saved, then
// the outcome of their latest check, with the text color of its tone.
export function summaryOf(tool: ExternalToolState): { readonly label: string; readonly className: string } {
	if (tool.status !== 'configured') return { label: CONFIG_LABELS[tool.status], className: TONE_TEXT[CONFIG_TONES[tool.status]] }
	const status = tool.lastCheck?.status ?? 'notTested'
	return { label: CHECK_LABELS[status], className: TONE_TEXT[CHECK_TONES[status]] }
}
