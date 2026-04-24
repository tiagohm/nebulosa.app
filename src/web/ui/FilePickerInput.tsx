import { ScopeProvider } from 'bunshi/react'
import { Activity, useRef, useState } from 'react'
import { FilePickerScope, type FilePickerScopeValue } from '@/molecules/filepicker'
import { Button } from './components/Button'
import { TextInput, type TextInputProps } from './components/TextInput'
import { FilePicker } from './FilePicker'
import { Icons } from './Icon'

export interface FilePickerInputProps extends Omit<FilePickerScopeValue, 'multiple' | 'path'>, Omit<TextInputProps, 'value' | 'onValueChange' | 'startContent' | 'endContent' | 'label'> {
	readonly id: string
	readonly value?: string
	readonly onValueChange: (value?: string) => void
}

export function FilePickerInput({ filter, mode, id, value, onValueChange, readOnly = true, ...props }: FilePickerInputProps) {
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

	const StartContent = <Button children={<Icons.FolderOpen className="cursor-pointer" color="#FF9800" onPointerUp={() => setShow(true)} />} tooltipContent="Browse" variant="ghost" />
	const EndContent = value ? <Button children={<Icons.CloseCircle className="cursor-pointer" color="#F44336" onPointerUp={() => onValueChange('')} />} variant="ghost" /> : null

	return (
		<>
			<div className="col-span-full flex w-full flex-1 flex-row items-center gap-1">
				<TextInput endContent={EndContent} onValueChange={handleValueChange} readOnly={readOnly} startContent={StartContent} value={value} {...props} />
			</div>
			<Activity mode={show ? 'visible' : 'hidden'}>
				<ScopeProvider scope={FilePickerScope} value={{ path: initialPath.current, filter, mode, multiple: false }}>
					<FilePicker header="Choose Path" id={`file-picker-input-${id}`} onChoose={handleOnChoose} />
				</ScopeProvider>
			</Activity>
		</>
	)
}
