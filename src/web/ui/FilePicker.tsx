import { Badge, BreadcrumbItem, Breadcrumbs, Button, Input, Listbox, ListboxItem, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { format } from 'date-fns'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FilePickerMolecule } from '@/molecules/filepicker'
import { Icons } from './Icon'
import { Modal } from './Modal'

export interface FilePickerProps {
	readonly name: string
	readonly header?: React.ReactNode
	readonly onChoose: (entries?: string[]) => void
}

export const FilePicker = memo(({ name, header, onChoose }: FilePickerProps) => {
	const filePicker = useMolecule(FilePickerMolecule)
	const { mode, history, filtered, selected, directoryTree, filter, createDirectory, directoryName } = useSnapshot(filePicker.state, { sync: true })

	function handleChoose() {
		onChoose(selected.length === 0 ? undefined : (selected as string[]))
	}

	return (
		<Modal
			footer={
				<>
					<Button color='danger' isDisabled={selected.length === 0} onPointerUp={filePicker.unselectAll} startContent={<Icons.Trash />} variant='flat'>
						Clear
					</Button>
					<Badge color='success' content={selected.length} showOutline={false}>
						<Button color='success' isDisabled={selected.length === 0} onPointerUp={handleChoose} startContent={<Icons.Check />} variant='flat'>
							Choose
						</Button>
					</Badge>
				</>
			}
			header={header ?? (mode === 'directory' ? 'Open Directory' : 'Open File')}
			maxWidth='420px'
			name={name}
			onClose={onChoose}>
			<div className='mt-0 flex flex-col flex-wrap gap-2'>
				<div className='flex flex-row items-center gap-2'>
					<Tooltip content='Go Back' showArrow>
						<Button color='secondary' isDisabled={history.length === 0} isIconOnly onPointerUp={filePicker.navigateBack} variant='light'>
							<Icons.ArrowLeft />
						</Button>
					</Tooltip>
					<Breadcrumbs className='flex-1' itemsAfterCollapse={2} itemsBeforeCollapse={1} maxItems={3}>
						{directoryTree.map((item) => (
							<BreadcrumbItem key={item.name} onPointerUp={() => filePicker.navigateTo(item)} startContent={item.name ? undefined : <Icons.FolderRoot />}>
								{item.name}
							</BreadcrumbItem>
						))}
					</Breadcrumbs>
					<Tooltip content='Go To Parent' showArrow>
						<Button color='secondary' isDisabled={directoryTree.length <= 1} isIconOnly onPointerUp={filePicker.navigateToParent} variant='light'>
							<Icons.ArrowUp />
						</Button>
					</Tooltip>
					<Tooltip content={createDirectory ? 'Filter' : 'New Directory'} showArrow>
						<Button color='warning' isIconOnly onPointerUp={filePicker.toggleCreateDirectory} variant='light'>
							{createDirectory ? <Icons.Filter /> : <Icons.FolderPlus />}
						</Button>
					</Tooltip>
					<Tooltip content='Refresh' showArrow>
						<Button color='primary' isIconOnly onPointerUp={filePicker.list} variant='light'>
							<Icons.Sync />
						</Button>
					</Tooltip>
				</div>
				{!createDirectory && <Input label='Filter' onValueChange={(value) => filePicker.filter(value)} size='sm' value={filter} />}
				{createDirectory && (
					<div className='flex flex-row items-center gap-2'>
						<Input label='Name' onValueChange={(value) => (filePicker.state.directoryName = value)} size='sm' value={directoryName} />
						<Tooltip content='Create' showArrow>
							<Button color='success' isDisabled={directoryName.length === 0} isIconOnly onPointerUp={filePicker.createDirectory} variant='light'>
								<Icons.Check />
							</Button>
						</Tooltip>
					</div>
				)}
				<Listbox
					isVirtualized
					onAction={(path) => filePicker.select(path as string)}
					selectionMode='none'
					virtualization={{
						maxListboxHeight: 200,
						itemHeight: 48,
					}}>
					{filtered.map((item) => (
						<ListboxItem endContent={selected.includes(item.path) && <Icons.Check color='green' />} key={item.path} startContent={item.directory ? <Icons.Folder color='orange' /> : <Icons.File color='gray' />}>
							<div className='flex flex-row items-center justify-between gap-1'>
								<div className='w-full flex flex-col justify-center gap-0'>
									<span className='break-all whitespace-nowrap w-0'>{item.name}</span>
									<div className='w-full flex flex-row items-center justify-between gap-1'>
										<span className='text-xs text-gray-500'>{format(item.updatedAt, 'yyyy-MM-dd HH:mm:ss')}</span>
										{!item.directory && <span className='text-xs text-gray-500'>{item.size} B</span>}
									</div>
								</div>
								{mode === 'directory' && (
									<Button color='secondary' isIconOnly onPointerUp={() => filePicker.navigateTo(item)} variant='light'>
										<Icons.FolderOpen />
									</Button>
								)}
							</div>
						</ListboxItem>
					))}
				</Listbox>
			</div>
		</Modal>
	)
})
