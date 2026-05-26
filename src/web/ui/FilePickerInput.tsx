import { useEffect, useRef, useState } from 'react'
import type { FilePickerScope } from '../store/filepicker.store'
import { IconButton } from './components/IconButton'
import { TextInput, type TextInputProps } from './components/TextInput'
import { FilePicker } from './FilePicker'
import { Icons } from './Icon'

export interface FilePickerInputProps extends Omit<FilePickerScope, 'multiple' | 'path'>, Omit<TextInputProps, 'value' | 'onValueChange' | 'startContent' | 'endContent' | 'label'> {
	readonly id: string
	readonly value?: string
	readonly onValueChange: (value?: string) => void
}

export function FilePickerInput({ filter, mode, id, value, onValueChange, readOnly = false, disabled = false, ...props }: FilePickerInputProps) {
	const [show, setShow] = useState(false)
	const initialPath = useRef(value)
	const blocked = readOnly || disabled
	const hasValue = value !== undefined && value.length > 0

	useEffect(() => {
		if (!show) {
			initialPath.current = value
		}
	}, [show, value])

	useEffect(() => {
		if (blocked) {
			setShow(false)
		}
	}, [blocked])

	function handleBrowse() {
		if (blocked) return

		initialPath.current = value
		setShow(true)
	}

	function handleClear() {
		if (blocked) return

		initialPath.current = ''
		onValueChange('')
	}

	function handleChoose(paths?: string[]) {
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

	const StartContent = <IconButton disabled={blocked} icon={Icons.FolderOpen} color="warning" onClick={handleBrowse} tooltipContent="Browse" size="sm" variant="ghost" />
	const EndContent = hasValue ? <IconButton disabled={blocked} icon={Icons.CloseCircle} color="danger" onClick={handleClear} size="sm" tooltipContent="Clear" variant="ghost" /> : null

	return (
		<>
			<div className="col-span-full flex w-full flex-1 flex-row items-center gap-1">
				<TextInput disabled={blocked} endContent={EndContent} onValueChange={handleValueChange} startContent={StartContent} value={value} {...props} />
			</div>
			{show && !blocked && <FilePicker header="Choose Path" id={`file-picker-input-${id}`} onChoose={handleChoose} path={initialPath.current} filter={filter} mode={mode} />}
		</>
	)
}
