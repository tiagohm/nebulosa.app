import { GRAYSCALES, type Grayscale, type ImageChannelOrGray } from 'nebulosa/src/image.types'
import { useRef, useState } from 'react'
import { tw } from '@/shared/util'
import { NumberInput } from './components/NumberInput'
import { Select, type SelectItemRenderer } from './components/Select'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { ImageChannelOrGraySelect } from './ImageChannelOrGraySelect'

export type ImageChannelOrGrayInputMode = 'select' | 'input'

const MODE_ITEMS = ['select', 'input'] as const
const MODE_LABELS = ['Select', 'Input'] as const

const ModeItem: SelectItemRenderer<ImageChannelOrGrayInputMode> = (_, i) => <span>{MODE_LABELS[i]}</span>

export interface ImageChannelOrGrayInputProps extends React.ComponentProps<'div'> {
	readonly value: ImageChannelOrGray
	readonly onValueChange: (value: ImageChannelOrGray) => void
	readonly disabled?: boolean
}

export function ImageChannelOrGrayInput({ value, onValueChange, className, disabled, ...props }: ImageChannelOrGrayInputProps) {
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
		<div {...props} className={tw('flex flex-col gap-2', className)}>
			<Select className="w-full" disabled={disabled} endContent={mode === 'input' ? <IconButton color="danger" icon={Icons.Restore} onPointerUp={handleOnRestorePointerUp} /> : null} items={MODE_ITEMS} label="Channel mode" onValueChange={handleOnModeChange} value={mode}>
				{ModeItem}
			</Select>

			{typeof value === 'string' ? (
				<ImageChannelOrGraySelect disabled={disabled} onValueChange={handleOnSelectValueChange} value={value} />
			) : (
				<div className="grid grid-cols-3 items-center gap-2">
					<NumberInput className="col-span-1" disabled={disabled} fractionDigits={3} label="Red" maxValue={1} minValue={0} onValueChange={(red) => handleOnInputValueChange('red', red)} step={0.001} value={value.red} />
					<NumberInput className="col-span-1" disabled={disabled} fractionDigits={3} label="Green" maxValue={1} minValue={0} onValueChange={(green) => handleOnInputValueChange('green', green)} step={0.001} value={value.green} />
					<NumberInput className="col-span-1" disabled={disabled} fractionDigits={3} label="Blue" maxValue={1} minValue={0} onValueChange={(blue) => handleOnInputValueChange('blue', blue)} step={0.001} value={value.blue} />
				</div>
			)}
		</div>
	)
}
