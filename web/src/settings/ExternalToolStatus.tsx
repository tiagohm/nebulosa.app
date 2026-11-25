import type { ExternalToolCheck, ExternalToolState } from 'api'
import { StatusBadge, type StatusTone, TONE_TEXT } from '../ui/StatusBadge'

// The one state of an external program shown everywhere it appears (the External Tools list and header, the solver
// controls): derived from its latest check, or, before any, from whether it is set up. A state the operator chose, such
// as a program left unset, is muted, never a failure. The text label always accompanies the color, and the tooltip says
// what the state proves.

// State of a program as shown: not set up, not checked yet, being checked in this tab, available (a program that
// answered when started, folders holding index files), folders without index files, not found, or failed.
export type ToolDisplay = 'notSetUp' | 'notChecked' | 'checking' | 'available' | 'noIndexes' | 'notFound' | 'failed'

// Label of each state.
export const TOOL_LABELS: Readonly<Record<ToolDisplay, string>> = {
	notSetUp: 'Not Set Up',
	notChecked: 'Not Checked',
	checking: 'Checking',
	available: 'Available',
	noIndexes: 'No Index Files',
	notFound: 'Not Found',
	failed: 'Failed',
}

// Tone of each state.
const TOOL_TONES: Readonly<Record<ToolDisplay, StatusTone>> = { notSetUp: 'muted', notChecked: 'muted', checking: 'active', available: 'success', noIndexes: 'warning', notFound: 'danger', failed: 'danger' }

// What each state proves, for its tooltip.
const TOOL_HINTS: Readonly<Record<ToolDisplay, string>> = {
	notSetUp: 'Nothing is set up, so the services that need it refuse to run',
	notChecked: 'The settings have not been tested since the server started',
	checking: 'The server is testing the settings',
	available: 'The program answered when the server started it, or its folders hold what it reads',
	noIndexes: 'The index folder holds no index file',
	notFound: 'Nothing exists where the settings point on the server',
	failed: 'The server cannot use the program with these settings',
}

// Returns the state of a program from a check of its settings, or, without one, from whether those settings are set
// up: configured means an executable is set (the built-in solver always is).
export function toolDisplay(check: ExternalToolCheck | undefined, configured: boolean): ToolDisplay {
	if (!check) return configured ? 'notChecked' : 'notSetUp'

	switch (check.code) {
		case 'ok':
			return 'available'
		case 'empty':
			return 'notSetUp'
		case 'noIndexes':
			return 'noIndexes'
		case 'missing':
			return 'notFound'
		default:
			return 'failed'
	}
}

// Returns the state of the saved settings of a program, as the server reports them.
export function savedDisplay(tool: ExternalToolState): ToolDisplay {
	return toolDisplay(tool.lastCheck, tool.status === 'configured')
}

// Badge of a state.
export function ToolBadge({ display }: { readonly display: ToolDisplay }) {
	return <StatusBadge tone={TOOL_TONES[display]} label={TOOL_LABELS[display]} title={TOOL_HINTS[display]} />
}

// Text color of a state, for a state written inline.
export function toolTextClassName(display: ToolDisplay) {
	return TONE_TEXT[TOOL_TONES[display]]
}

// One-line summary of the saved settings of a program, for lists and the controls that use it: the label of its state
// and the text color of its tone.
export function summaryOf(tool: ExternalToolState): { readonly label: string; readonly className: string; readonly hint: string } {
	const display = savedDisplay(tool)
	return { label: TOOL_LABELS[display], className: toolTextClassName(display), hint: TOOL_HINTS[display] }
}
