import { NumberInput, SelectItem } from '@heroui/react'
import clsx from 'clsx'
import { GRAYSCALES, type Grayscale, type ImageChannelOrGray } from 'nebulosa/src/image.types'
import { useRef, useState } from 'react'
import { EnumSelect } from './EnumSelect'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { ImageChannelOrGraySelect } from './ImageChannelOrGraySelect'

export type ImageChannelOrGrayInputMode = 'select' | 'input'

export interface ImageChannelOrGrayInputProps extends React.ComponentProps<'div'> {
	readonly value: ImageChannelOrGray
	readonly onValueChange: (value: ImageChannelOrGray) => void
	readonly isDisabled?: boolean
}

export function ImageChannelOrGrayInput({ value, onValueChange, className, isDisabled, ...props }: ImageChannelOrGrayInputProps) {
	const [mode, setMode] = useState<ImageChannelOrGrayInputMode>(typeof value === 'string' ? 'select' : 'input')
	const selectValue = useRef(typeof value === 'string' ? value : 'BT709')
	const inputValue = useRef(typeof value === 'object' ? value : structuredClone(GRAYSCALES[value]))

	function handleOnModeChange(mode: ImageChannelOrGrayInputMode) {
		if (mode === 'select') onValueChange(selectValue.current)
		else onValueChange(inputValue.current)
		setMode(mode)
	}

	function handleOnSelectValueChange(value: Exclude<ImageChannelOrGray, Grayscale>) {
		selectValue.current = value
		onValueChange(value)
	}

	function handleOnInputValueChange(type: keyof Grayscale, value: number) {
		const input = { ...inputValue.current, [type]: value }
		inputValue.current = input
		onValueChange(input)
	}

	function handleOnRestorePointerUp() {
		inputValue.current = structuredClone(GRAYSCALES[selectValue.current])
		onValueChange(inputValue.current)
	}

	return (
		<div {...props} className={clsx('flex flex-col gap-2', className)}>
			<EnumSelect className='w-full' endContent={mode === 'input' ? <IconButton color='danger' icon={Icons.Restore} onPointerUp={handleOnRestorePointerUp} size='sm' /> : null} isDisabled={isDisabled} label='Channel mode' onValueChange={handleOnModeChange} value={mode}>
				<SelectItem key='select'>Select</SelectItem>
				<SelectItem key='input'>Input</SelectItem>
			</EnumSelect>

			{typeof value === 'string' ? (
				<ImageChannelOrGraySelect isDisabled={isDisabled} onValueChange={handleOnSelectValueChange} value={value} />
			) : (
				<div className='grid grid-cols-3 gap-2 items-center'>
					<NumberInput className='col-span-1' isDisabled={isDisabled} label='Red' maxValue={1} minValue={0} onValueChange={(red) => handleOnInputValueChange('red', red)} size='sm' step={0.001} value={value.red} />
					<NumberInput className='col-span-1' isDisabled={isDisabled} label='Green' maxValue={1} minValue={0} onValueChange={(green) => handleOnInputValueChange('green', green)} size='sm' step={0.001} value={value.green} />
					<NumberInput className='col-span-1' isDisabled={isDisabled} label='Blue' maxValue={1} minValue={0} onValueChange={(blue) => handleOnInputValueChange('blue', blue)} size='sm' step={0.001} value={value.blue} />
				</div>
			)}
		</div>
	)
}
