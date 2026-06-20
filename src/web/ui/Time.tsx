import type { UTCTime } from 'nebulosa/src/indi.device'
import { useEffect, useState } from 'react'
import { clamp } from '@/shared/util'
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

const MIN_OFFSET = -720
const MAX_OFFSET = 720

function toUTCDateTime(utc: number) {
	if (!Number.isFinite(utc)) return undefined

	try {
		return Temporal.Instant.fromEpochMilliseconds(utc).toZonedDateTimeISO('UTC').toPlainDateTime()
	} catch {
		return undefined
	}
}

function normalizeOffset(offset: number) {
	return Number.isFinite(offset) ? clamp(Math.round(offset), MIN_OFFSET, MAX_OFFSET) : 0
}

export function Time({ id, onTimeChange, onClose, ...time }: TimeProps) {
	const [date, setDate] = useState<Temporal.PlainDateTime | undefined>(() => toUTCDateTime(time.utc))
	const [offset, setOffset] = useState(() => normalizeOffset(time.offset))
	const canApply = date !== undefined && onTimeChange !== undefined

	function handleChoose() {
		if (!date || !onTimeChange) return

		const utc = date.toZonedDateTime('UTC').toInstant().epochMilliseconds
		onTimeChange({ utc, offset })
		onClose?.()
	}

	useEffect(() => {
		setDate(toUTCDateTime(time.utc))
		setOffset(normalizeOffset(time.offset))
	}, [time.offset, time.utc])

	const Footer = <Button color="success" disabled={!canApply} label="Apply" onClick={handleChoose} startContent={<Icons.Check />} />

	return (
		<Modal footer={Footer} header="Time" id={id} initialWidth="328px" onHide={onClose}>
			<div className="mt-0 grid grid-cols-3 gap-2">
				<DateTimeInput className="col-span-2" label="UTC" granularity="second" onValueChange={setDate} value={date} />
				<NumberInput className="col-span-1" label="Offset (min)" maxValue={MAX_OFFSET} minValue={MIN_OFFSET} onValueChange={setOffset} step={30} value={offset} />
			</div>
		</Modal>
	)
}
