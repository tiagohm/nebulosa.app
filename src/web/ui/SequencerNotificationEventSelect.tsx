import { MultiSelect } from '@ui/components/MultiSelect'
import type { MultiSelectProps } from '@ui/components/MultiSelect'
import type { SequencerNotificationEvent } from '#/sequencer'

const ITEMS = [
	'sessionStarted',
	'sessionPaused',
	'sessionSuspended',
	'sessionResumed',
	'sessionCompleted',
	'sessionStopped',
	'sessionFailed',
	'actionFailed',
	'retryScheduled',
	'unsafe',
	'safe',
	'recoveryStarted',
	'recoveryCompleted',
	'recoveryFailed',
	'meridianFlipStarted',
	'meridianFlipCompleted',
	'autofocusStarted',
	'autofocusCompleted',
	'frameRejected',
	'deviceDisconnected',
	'storageLow',
] as const

const LABELS = [
	'Session started',
	'Session paused',
	'Session suspended',
	'Session resumed',
	'Session completed',
	'Session stopped',
	'Session failed',
	'Action failed',
	'Retry scheduled',
	'Unsafe',
	'Safe',
	'Recovery started',
	'Recovery completed',
	'Recovery failed',
	'Meridian flip started',
	'Meridian flip completed',
	'Autofocus started',
	'Autofocus completed',
	'Frame rejected',
	'Device disconnected',
	'Storage low',
] as const

function SequencerNotificationEventItem(item: SequencerNotificationEvent, index: number) {
	return <span>{LABELS[index]}</span>
}

export type SequencerNotificationEventSelectProps = Omit<MultiSelectProps<SequencerNotificationEvent>, 'children' | 'items'>

export function SequencerNotificationEventSelect({ label = 'Events', ...props }: SequencerNotificationEventSelectProps) {
	return (
		<MultiSelect clearable items={ITEMS} label={label} {...props}>
			{SequencerNotificationEventItem}
		</MultiSelect>
	)
}
