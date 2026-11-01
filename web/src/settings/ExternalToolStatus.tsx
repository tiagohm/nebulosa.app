import type { ExternalToolCheckStatus, ExternalToolConfigStatus, ExternalToolState } from 'api'
import { StatusBadge, type StatusTone, TONE_TEXT } from '../ui/StatusBadge'

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

// Tone of each state of the saved settings.
const CONFIG_TONES: Readonly<Record<ExternalToolConfigStatus, StatusTone>> = { notConfigured: 'muted', configured: 'neutral', invalid: 'danger' }

// Tone of each state of a check.
const CHECK_TONES: Readonly<Record<CheckDisplay, StatusTone>> = { notTested: 'muted', checking: 'active', available: 'success', unavailable: 'danger', failed: 'danger' }

// Badge of the state of the saved settings.
export function ConfigBadge({ status }: { readonly status: ExternalToolConfigStatus }) {
	return <StatusBadge tone={CONFIG_TONES[status]} label={CONFIG_LABELS[status]} />
}

// Badge of the state of a check.
export function CheckBadge({ status }: { readonly status: CheckDisplay }) {
	return <StatusBadge tone={CHECK_TONES[status]} label={CHECK_LABELS[status]} />
}

// One-line summary of a program for its list item: the state of the settings until they are saved, then
// the outcome of their latest check, with the text color of its tone.
export function summaryOf(tool: ExternalToolState): { readonly label: string; readonly className: string } {
	if (tool.status !== 'configured') return { label: CONFIG_LABELS[tool.status], className: TONE_TEXT[CONFIG_TONES[tool.status]] }
	const status = tool.lastCheck?.status ?? 'notTested'
	return { label: CHECK_LABELS[status], className: TONE_TEXT[CHECK_TONES[status]] }
}
