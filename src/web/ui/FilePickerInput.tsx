import { ScopeProvider } from 'bunshi/react'
import { Activity, useRef, useState } from 'react'
import { FilePickerScope, type FilePickerScopeValue } from '@/molecules/filepicker'
import { IconButton } from './components/IconButton'
import { TextInput, type TextInputProps } from './components/TextInput'
import { FilePicker } from './FilePicker'
import { Icons } from './Icon'

export interface FilePickerInputProps extends Omit<FilePickerScopeValue, 'multiple' | 'path'>, Omit<TextInputProps, 'value' | 'onValueChange' | 'startContent' | 'endContent' | 'label'> {
	readonly id: string
	readonly value?: string
	readonly onValueChange: (value?: string) => void
}

export function FilePickerInput({ filter, mode, id, value, onValueChange, readOnly = false, disabled = false, ...props }: FilePickerInputProps) {
	const [show, setShow] = useState(false)
	const initialPath = useRef(value)
	const blocked = readOnly || disabled

	function handleOnChoose(paths?: string[]) {
		if (!blocked && paths?.length) {
			initialPath.current = paths[0]
			onValueChange(paths[0])
		}

		setShow(false)
	}

	function handleValueChange(path: string) {
		if (!show && !blocked) {
			initialPath.current = path
			onValueChange(path)
		}
	}

	const StartContent = <IconButton disabled={blocked} icon={Icons.FolderOpen} color="warning" onPointerUp={() => setShow(true)} tooltipContent="Browse" size="sm" variant="ghost" />
	const EndContent = value ? <IconButton disabled={blocked} icon={Icons.CloseCircle} color="danger" onPointerUp={() => onValueChange('')} size="sm" tooltipContent="Clear" variant="ghost" /> : null

	return (
		<>
			<div className="col-span-full flex w-full flex-1 flex-row items-center gap-1">
				<TextInput disabled={blocked} endContent={EndContent} onValueChange={handleValueChange} startContent={StartContent} value={value} {...props} />
			</div>
			<Activity mode={show && !blocked ? 'visible' : 'hidden'}>
				<ScopeProvider scope={FilePickerScope} value={{ path: initialPath.current, filter, mode, multiple: false }}>
					<FilePicker header="Choose Path" id={`file-picker-input-${id}`} onChoose={handleOnChoose} />
				</ScopeProvider>
			</Activity>
		</>
	)
}
