import { Button, type ButtonProps, DateInput, NumberInput, Tooltip } from '@heroui/react'
import { fromAbsolute, now, type ZonedDateTime } from '@internationalized/date'
import { I18nProvider } from '@react-aria/i18n'
import { useState } from 'react'
import type { UTCTime } from 'src/shared/types'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export interface TimeProps {
	readonly id: string
	readonly time: UTCTime
	readonly onTimeChange?: (time: UTCTime) => void
	readonly onClose?: () => void
}

export function Time({ id, time, onTimeChange, onClose }: TimeProps) {
	// https://react-spectrum.adobe.com/internationalized/date/ZonedDateTime.html
	const [date, setDate] = useState<ZonedDateTime | null>(fromAbsolute(time.utc, 'UTC'))
	const [offset, setOffset] = useState(time.offset)

	function handleChoose() {
		if (date && onTimeChange) {
			const utc = date.toDate().getTime()
			onTimeChange({ utc, offset })
			onClose?.()
		}
	}

	function handleNow() {
		setDate(now('UTC'))
	}

	const Footer = <TextButton color='success' label='Apply' onPointerUp={handleChoose} startContent={<Icons.Check />} />

	return (
		<Modal footer={Footer} header='Time' id={id} maxWidth='330px' onHide={onClose}>
			<div className='mt-0 grid grid-cols-3 gap-2'>
				<I18nProvider locale='sv-SE'>
					<DateInput className='col-span-2' endContent={<NowButton onPointerUp={handleNow} />} granularity='second' hideTimeZone hourCycle={24} label='UTC' onChange={setDate} size='sm' value={date} />
				</I18nProvider>
				<NumberInput className='col-span-1' formatOptions={INTEGER_NUMBER_FORMAT} label='Offset (min)' maxValue={720} minValue={-720} onValueChange={setOffset} size='sm' step={30} value={offset} />
			</div>
		</Modal>
	)
}

interface NowButtonProps extends Omit<ButtonProps, 'isIconOnly' | 'variant'> {}

function NowButton({ color = 'secondary', size = 'sm', ...props }: NowButtonProps) {
	return (
		<Tooltip content='Now' placement='bottom'>
			<Button color={color} isIconOnly size={size} variant='light' {...props}>
				<Icons.CalendarToday />
			</Button>
		</Tooltip>
	)
}
