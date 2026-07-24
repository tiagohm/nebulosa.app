import { clamp } from '@shared/util'
import { Button } from '@ui/components/Button'
import { DateTimeInput } from '@ui/components/DateTimeInput'
import { IconButton } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Icons } from '@ui/Icon'
import type { UTCTime } from 'nebulosa/src/devices/indi/device'
import { useEffect, useState } from 'react'

export interface UTCTimeInputProps extends UTCTime {
	readonly onTimeChange?: (time: UTCTime) => void
}

export function UTCTimeInput({ onTimeChange, ...time }: UTCTimeInputProps) {
	const [date, setDate] = useState<Temporal.PlainDateTime | undefined>(() => toUTCDateTime(time.utc))
	const [offset, setOffset] = useState(() => normalizeOffset(time.offset))
	const canApply = date !== undefined && onTimeChange !== undefined

	function handleChoose() {
		if (!date || !onTimeChange) return

		const utc = date.toZonedDateTime('UTC').toInstant().epochMilliseconds
		onTimeChange({ utc, offset })
	}

	function handleNowClick() {
		setDate(Temporal.Now.plainDateTimeISO('UTC'))
	}

	useEffect(() => {
		setDate(toUTCDateTime(time.utc))
		setOffset(normalizeOffset(time.offset))
	}, [time.offset, time.utc])

	return (
		<div className="grid grid-cols-3 gap-2">
			<DateTimeInput className="col-span-2" label="UTC" granularity="second" onValueChange={setDate} value={date} endContent={<IconButton icon={Icons.Clock} onClick={handleNowClick} rounded={false} size="sm" />} />
			<NumberInput className="col-span-1" label="Offset (min)" maxValue={720} minValue={-720} onValueChange={setOffset} step={30} value={offset} />
			<div className="col-span-full flex items-center justify-end">
				<Button color="success" disabled={!canApply} label="Apply" onClick={handleChoose} startContent={<Icons.Check />} />
			</div>
		</div>
	)
}

function toUTCDateTime(utc: number) {
	if (!Number.isFinite(utc)) return undefined

	try {
		return Temporal.Instant.fromEpochMilliseconds(utc).toZonedDateTimeISO('UTC').toPlainDateTime()
	} catch {
		return undefined
	}
}

function normalizeOffset(offset: number) {
	return Number.isFinite(offset) ? clamp(Math.round(offset), -720, 720) : 0
}
