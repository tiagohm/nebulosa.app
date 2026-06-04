import { GRAYSCALES, type Grayscale, type ImageChannelOrGray } from 'nebulosa/src/image.types'
import { useEffect, useRef, useState } from 'react'
import { tw } from '@/shared/util'
import { IconButton } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { Select, type SelectItemRenderer } from './components/Select'
import { Icons } from './Icon'
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
	const selectedChannel = typeof value === 'string' ? value : selectValue.current
	const inputChannel = typeof value === 'object' ? value : inputValue.current

	useEffect(() => {
		if (typeof value === 'string') {
			selectValue.current = value
			setMode('select')
		} else {
			inputValue.current = structuredClone(value)
			setMode('input')
		}
	}, [value])

	function handleModeChange(mode: ImageChannelOrGrayInputMode) {
		if (mode === 'select') onValueChange(selectValue.current)
		else onValueChange(inputValue.current)
		setMode(mode)
	}

	function handleSelectValueChange(value: Exclude<ImageChannelOrGray, Grayscale>) {
		selectValue.current = value
		onValueChange(value)
	}

	function handleInputValueChange(type: keyof Grayscale, value: number) {
		const input = { ...inputValue.current, [type]: value }
		inputValue.current = input
		onValueChange(input)
	}

	function handleRestoreClick() {
		inputValue.current = structuredClone(GRAYSCALES[selectValue.current])
		onValueChange(inputValue.current)
	}

	return (
		<div {...props} className={tw('flex min-w-0 flex-col gap-2', className)}>
			<Select className="w-full min-w-0" disabled={disabled} endContent={mode === 'input' ? <IconButton color="danger" disabled={disabled} icon={Icons.Restore} onClick={handleRestoreClick} /> : null} items={MODE_ITEMS} label="Channel mode" onValueChange={handleModeChange} value={mode}>
				{ModeItem}
			</Select>

			{mode === 'select' ? (
				<ImageChannelOrGraySelect className="min-w-0" disabled={disabled} onValueChange={handleSelectValueChange} value={selectedChannel} />
			) : (
				<div className="grid min-w-0 grid-cols-3 items-center gap-2">
					<NumberInput className="col-span-1 min-w-0" disabled={disabled} fractionDigits={3} label="Red" maxValue={1} minValue={0} onValueChange={(red) => handleInputValueChange('red', red)} step={0.001} value={inputChannel.red} />
					<NumberInput className="col-span-1 min-w-0" disabled={disabled} fractionDigits={3} label="Green" maxValue={1} minValue={0} onValueChange={(green) => handleInputValueChange('green', green)} step={0.001} value={inputChannel.green} />
					<NumberInput className="col-span-1 min-w-0" disabled={disabled} fractionDigits={3} label="Blue" maxValue={1} minValue={0} onValueChange={(blue) => handleInputValueChange('blue', blue)} step={0.001} value={inputChannel.blue} />
				</div>
			)}
		</div>
	)
}
