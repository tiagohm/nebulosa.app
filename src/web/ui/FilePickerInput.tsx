import { Input, type InputProps } from '@heroui/react'
import { ScopeProvider } from 'bunshi/react'
import { Activity, useRef, useState } from 'react'
import { FilePickerScope, type FilePickerScopeValue } from '@/molecules/filepicker'
import { Button } from './components/Button'
import { FilePicker } from './FilePicker'
import { Icons } from './Icon'

export interface FilePickerInputProps extends Omit<FilePickerScopeValue, 'multiple' | 'path'>, Omit<InputProps, 'value' | 'onValueChange' | 'onClear' | 'startContent' | 'endContent' | 'isClearable' | 'label'> {
	readonly id: string
	readonly value?: string
	readonly onValueChange: (value?: string) => void
}

export function FilePickerInput({ filter, mode, id, value, onValueChange, isReadOnly = true, size = 'sm', ...props }: FilePickerInputProps) {
	const [show, setShow] = useState(false)
	const initialPath = useRef(value)

	function handleOnChoose(paths?: string[]) {
		if (paths?.length) {
			initialPath.current = paths[0]
			onValueChange(paths[0])
		}

		setShow(false)
	}

	function handleValueChange(path: string) {
		if (!show) {
			initialPath.current = path
			onValueChange(path)
		}
	}

	const StartContent = <Button children={<Icons.FolderOpen className='cursor-pointer' color='#FF9800' onPointerUp={() => setShow(true)} />} size='sm' tooltipContent='Browse' variant='ghost' />
	const EndContent = value ? <Button children={<Icons.CloseCircle className='cursor-pointer' color='#F44336' onPointerUp={() => onValueChange('')} />} size='sm' variant='ghost' /> : null

	return (
		<>
			<div className='col-span-full flex flex-row items-center gap-1 w-full flex-1'>
				<Input {...props} endContent={EndContent} isClearable={false} isReadOnly={isReadOnly} onValueChange={handleValueChange} size={size} startContent={StartContent} value={value} />
			</div>
			<Activity mode={show ? 'visible' : 'hidden'}>
				<ScopeProvider scope={FilePickerScope} value={{ path: initialPath.current, filter, mode, multiple: false }}>
					<FilePicker header='Choose Path' id={`file-picker-input-${id}`} onChoose={handleOnChoose} />
				</ScopeProvider>
			</Activity>
		</>
	)
}
