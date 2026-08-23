import { Button } from '@ui/components/Button'
import { NumberInput } from '@ui/components/NumberInput'
import { Popover } from '@ui/components/Popover'
import { Icons } from '@ui/Icon'
import { SequencerFailureActionOnExhaustedSelect } from '@ui/SequencerFailureActionOnExhaustedSelect'
import { SequencerFailureReasonSelect } from '@ui/SequencerFailureReasonSelect'
import type { SequencerRetryPolicy } from '#/sequencer'

export interface SequencerRetryPolicyPopoverProps extends React.ComponentProps<'div'>, SequencerRetryPolicy {
	readonly disabled?: boolean
	readonly onMaxAttemptsChange: (value: number) => void
	readonly onDelayChange: (value: number) => void
	readonly onBackoffChange: (value: number) => void
	readonly onMaximumDelayChange: (value: number) => void
	readonly onRetryOnChange: (value: SequencerRetryPolicy['retryOn']) => void
	readonly onOnExhaustedChange: (value: SequencerRetryPolicy['onExhausted']) => void
}

export function SequencerRetryPolicyPopover({ maxAttempts, delay, backoff, maximumDelay, retryOn, onExhausted, disabled, onMaxAttemptsChange, onDelayChange, onBackoffChange, onMaximumDelayChange, onRetryOnChange, onOnExhaustedChange, ...props }: SequencerRetryPolicyPopoverProps) {
	return (
		<Popover disabled={disabled} trigger={<Button color="secondary" disabled={disabled} label="Retry policy" startContent={<Icons.Reload />} />}>
			<div className="max-w-90vw grid w-120 grid-cols-12 gap-2 p-2" {...props}>
				<NumberInput className="col-span-4" disabled={disabled} label="Max attempts" maxValue={60} minValue={1} onValueChange={onMaxAttemptsChange} value={maxAttempts} />
				<NumberInput className="col-span-4" disabled={disabled} endContent="s" label="Delay" minValue={0} onValueChange={onDelayChange} value={delay} />
				<NumberInput className="col-span-4" disabled={disabled} label="Backoff" maxValue={10} minValue={1} onValueChange={onBackoffChange} value={backoff} />
				<NumberInput className="col-span-4" disabled={disabled} endContent="s" label="Max delay" maxValue={3600} minValue={delay} onValueChange={onMaximumDelayChange} value={maximumDelay} />
				<SequencerFailureActionOnExhaustedSelect className="col-span-8" disabled={disabled} label="On exhausted" onValueChange={onOnExhaustedChange} value={onExhausted} />
				<SequencerFailureReasonSelect className="col-span-full" disabled={disabled} label="Retry on" onValueChange={onRetryOnChange} value={retryOn} />
			</div>
		</Popover>
	)
}
