import { Button, type ButtonProps, DateInput, NumberInput, Tooltip } from '@heroui/react'
import { fromAbsolute, now } from '@internationalized/date'
import { I18nProvider } from '@react-aria/i18n'
import { useState } from 'react'
import type { GPS } from 'src/shared/types'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { Modal } from './Modal'

export interface TimeProps {
	readonly name: string
	readonly time: GPS['time']
	readonly onTimeChange?: (time: GPS['time']) => void
	readonly onClose?: () => void
}

export function Time({ name, time, onTimeChange, onClose }: TimeProps) {
	// https://react-spectrum.adobe.com/internationalized/date/ZonedDateTime.html
	const [date, setDate] = useState(fromAbsolute(time.utc, 'UTC'))
	const [offset, setOffset] = useState(time.offset)

	function handleTimeChoose() {
		if (onTimeChange) {
			const utc = date.toDate().getTime()
			onTimeChange({ utc, offset })
			onClose?.()
		}
	}

	function handleNow() {
		setDate(now('UTC'))
	}

	return (
		<Modal
			footer={
				<Button color='success' onPointerUp={handleTimeChoose} startContent={<Icons.Check />} variant='flat'>
					Choose
				</Button>
			}
			header='Time'
			maxWidth='330px'
			name={name}
			onClose={onClose}>
			<div className='mt-0 grid grid-cols-3 gap-2'>
				<I18nProvider locale='sv-SE'>
					<DateInput className='col-span-2' endContent={<NowButton onPointerUp={handleNow} />} granularity='second' hideTimeZone hourCycle={24} label='UTC' onChange={(value) => setDate(value!)} size='sm' value={date} />
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
