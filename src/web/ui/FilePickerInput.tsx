import type { FilePickerScope } from '@stores/filepicker.store'
import { IconButton } from '@ui/components/IconButton'
import { Popover } from '@ui/components/Popover'
import type { PopoverMethods } from '@ui/components/Popover'
import { TextInput } from '@ui/components/TextInput'
import type { TextInputProps } from '@ui/components/TextInput'
import { FilePicker } from '@ui/FilePicker'
import { Icons } from '@ui/Icon'
import { useEffect, useRef } from 'react'

export interface FilePickerInputProps extends Omit<FilePickerScope, 'multiple' | 'path'>, Omit<TextInputProps, 'value' | 'onValueChange' | 'startContent' | 'endContent'> {
	readonly value?: string
	readonly onValueChange: (value?: string) => void
}

export function FilePickerInput({ filter, mode, value, onValueChange, readOnly = false, disabled = false, ...props }: FilePickerInputProps) {
	const popoverRef = useRef<PopoverMethods | null>(null)
	const initialPath = useRef(value)
	const blocked = readOnly || disabled
	const hasValue = value !== undefined && value.length > 0

	useEffect(() => {
		initialPath.current = value
	}, [value])

	useEffect(() => {
		if (blocked) {
			popoverRef.current?.hide()
		}
	}, [blocked])

	function handleBrowse() {
		if (blocked) return

		initialPath.current = value
		popoverRef.current?.show()
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

		popoverRef.current?.hide()
	}

	function handleValueChange(path: string) {
		if (!blocked) {
			initialPath.current = path
			onValueChange(path)
		}
	}

	const StartContent = (
		<Popover ref={popoverRef} trigger={<IconButton disabled={blocked} icon={Icons.FolderOpen} color="warning" onClick={handleBrowse} tooltipContent="Browse" size="sm" variant="ghost" />}>
			<FilePicker title="Choose Path" onChoose={handleChoose} path={initialPath.current} filter={filter} mode={mode} />
		</Popover>
	)

	const EndContent = hasValue ? <IconButton disabled={blocked} icon={Icons.CloseCircle} color="danger" onClick={handleClear} size="sm" tooltipContent="Clear" variant="ghost" /> : null

	return (
		<>
			<div className="col-span-full flex w-full flex-1 flex-row items-center gap-1">
				<TextInput disabled={blocked} endContent={EndContent} onValueChange={handleValueChange} startContent={StartContent} value={value} {...props} />
			</div>
		</>
	)
}
