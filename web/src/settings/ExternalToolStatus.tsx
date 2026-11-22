import type { ExternalToolCheck, ExternalToolState } from 'api'
import { StatusBadge, type StatusTone, TONE_TEXT } from '../ui/StatusBadge'

// The one state of an external program shown everywhere it appears (the External Tools list and header, the solver
// and star detection controls): derived from its latest check, or, before any, from whether it is set up. A state the
// operator chose, such as a web service not signed in to or a program left unset, is muted, never a failure. The text
// label always accompanies the color, and the tooltip says what the state proves.

// State of a program as shown: not set up, signed out of, not checked yet, being checked in this tab, available (a
// program that answered when started, a service signed in to), available without a star database, not found, or failed.
export type ToolDisplay = 'notSetUp' | 'signedOut' | 'notChecked' | 'checking' | 'available' | 'signedIn' | 'noDatabase' | 'notFound' | 'failed'

// Label of each state.
export const TOOL_LABELS: Readonly<Record<ToolDisplay, string>> = {
	notSetUp: 'Not Set Up',
	signedOut: 'Signed Out',
	notChecked: 'Not Checked',
	checking: 'Checking',
	available: 'Available',
	signedIn: 'Signed In',
	noDatabase: 'No Star Database',
	notFound: 'Not Found',
	failed: 'Failed',
}

// Tone of each state.
const TOOL_TONES: Readonly<Record<ToolDisplay, StatusTone>> = { notSetUp: 'muted', signedOut: 'muted', notChecked: 'muted', checking: 'active', available: 'success', signedIn: 'success', noDatabase: 'warning', notFound: 'danger', failed: 'danger' }

// What each state proves, for its tooltip.
const TOOL_HINTS: Readonly<Record<ToolDisplay, string>> = {
	notSetUp: 'No executable is set, so the services that need it refuse to run',
	signedOut: 'The server holds no session of the service, so solving with it is refused',
	notChecked: 'The settings have not been tested since the server started',
	checking: 'The server is testing the settings',
	available: 'The program answered when the server started it',
	signedIn: 'The server holds a session of the service; the service was not contacted',
	noDatabase: 'The program answered, but no star database is beside it',
	notFound: 'Nothing exists where the settings point on the server',
	failed: 'The server cannot use the program with these settings',
}

// Returns the state of a program from a check of its settings, or, without one, from whether those settings are set
// up: configured, for a program, means an executable is set, and, for a web service, that it is signed in to.
export function toolDisplay(check: ExternalToolCheck | undefined, session: boolean, configured: boolean): ToolDisplay {
	if (!check) return configured ? 'notChecked' : session ? 'signedOut' : 'notSetUp'

	switch (check.code) {
		case 'ok':
			return session ? 'signedIn' : 'available'
		case 'empty':
			return 'notSetUp'
		case 'signedOut':
			return 'signedOut'
		case 'noDatabase':
			return 'noDatabase'
		case 'missing':
		case 'configMissing':
			return 'notFound'
		default:
			return 'failed'
	}
}

// Returns the state of the saved settings of a program, as the server reports them.
export function savedDisplay(tool: ExternalToolState): ToolDisplay {
	return toolDisplay(tool.lastCheck, tool.session, tool.status === 'configured')
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
