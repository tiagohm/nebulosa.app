import type { DeviceSummary, OperationRecord } from 'api'
import type { ActivityTone } from './groups'

// Small building blocks shared by the Equipment Control panels: the tone of an activity, the description of an
// operation outcome, and the props of the controls of a device interface. The notes, button rows, and confirmed
// commands they show are the shared primitives of `ui/`.

// Text color of each activity tone.
export const TONE_COLORS: Readonly<Record<ActivityTone, string>> = {
	off: 'text-ink-300',
	idle: 'text-ink-200',
	active: 'text-accent',
	warning: 'text-danger',
}

// Description of each reason a device operation fails, completing "failed: …".
export const FAILURE_REASONS: Readonly<Record<NonNullable<OperationRecord['reason']>, string>> = {
	busy: 'the device was busy',
	aborted: 'it was stopped',
	disconnected: 'the device disconnected',
	removed: 'the device was removed',
	timeout: 'the device did not finish in time',
	alert: 'the driver reported an error',
	commandFailed: 'the command could not be confirmed',
	unexpectedState: 'the device refused it in its current state',
}

// Props of the controls of one interface of a device.
export interface InterfaceProps {
	// Interface controlled, on the watched connection.
	readonly device: DeviceSummary
}
