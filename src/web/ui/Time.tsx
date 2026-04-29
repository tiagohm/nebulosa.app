import type { UTCTime } from 'nebulosa/src/indi.device'
import { useState } from 'react'
import { Button } from './components/Button'
import { DateTimeInput } from './components/DateTimeInput'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { Modal } from './Modal'

export interface TimeProps extends UTCTime {
	readonly id: string
	readonly onTimeChange?: (time: UTCTime) => void
	readonly onClose?: () => void
}

export function Time({ id, onTimeChange, onClose, ...time }: TimeProps) {
	const [date, setDate] = useState<Temporal.PlainDateTime | undefined>(() => Temporal.Instant.fromEpochMilliseconds(time.utc).toZonedDateTimeISO('UTC').toPlainDateTime())
	const [offset, setOffset] = useState(time.offset)

	function handleChoose() {
		if (date && onTimeChange) {
			const utc = date.toZonedDateTime('UTC').toInstant().epochMilliseconds
			onTimeChange({ utc, offset })
			onClose?.()
		}
	}

	const Footer = <Button color="success" label="Apply" onPointerUp={handleChoose} startContent={<Icons.Check />} />

	return (
		<Modal footer={Footer} header="Time" id={id} maxWidth="328px" onHide={onClose}>
			<div className="mt-0 grid grid-cols-3 gap-2">
				<DateTimeInput className="col-span-2" label="UTC" granularity="second" onValueChange={setDate} value={date} />
				<NumberInput className="col-span-1" label="Offset (min)" maxValue={720} minValue={-720} onValueChange={setOffset} step={30} value={offset} />
			</div>
		</Modal>
	)
}
