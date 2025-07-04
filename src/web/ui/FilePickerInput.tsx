import { Input, type InputProps } from '@heroui/react'
import { ScopeProvider } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo, useCallback, useRef, useState } from 'react'
import { FilePickerScope, type FilePickerScopeValue } from '@/molecules/filepicker'
import { ModalScope } from '@/molecules/modal'
import { FilePicker } from './FilePicker'

export interface FilePickerInputProps extends Omit<FilePickerScopeValue, 'multiple' | 'path'>, Omit<InputProps, 'size' | 'value' | 'onValueChange' | 'onClear' | 'startContent' | 'endContent' | 'isClearable'> {
	readonly name: string
	readonly value?: string
	readonly onValueChange: (value?: string) => void
}

export const FilePickerInput = memo(({ filter, mode, name, value, onValueChange, isReadOnly = true, ...props }: FilePickerInputProps) => {
	const [show, setShow] = useState(false)
	const initialPath = useRef(value)

	const handleChoose = useCallback(
		(paths?: string[]) => {
			if (paths?.length) {
				initialPath.current = paths[0]
				onValueChange(paths[0])
			}

			setShow(false)
		},
		[onValueChange],
	)

	return (
		<>
			<div className='flex flex-row items-center gap-1 w-full flex-1'>
				<Input
					{...props}
					endContent={value ? <Lucide.CircleX className='cursor-pointer' color='#F44336' onPointerUp={() => onValueChange('')} size={12} /> : null}
					isClearable={false}
					isReadOnly={isReadOnly}
					size='sm'
					startContent={<Lucide.FolderOpen className='cursor-pointer' color='#FF9800' onPointerUp={() => setShow(true)} size={12} />}
					value={value}
				/>
			</div>
			{show && (
				<ScopeProvider scope={FilePickerScope} value={{ path: initialPath.current, filter, mode, multiple: false }}>
					<ScopeProvider scope={ModalScope} value={{ name: `file-picker-input-${name}`, isAlwaysOnTop: true }}>
						<FilePicker header='Open Path' onChoose={handleChoose} />
					</ScopeProvider>
				</ScopeProvider>
			)}
		</>
	)
})
