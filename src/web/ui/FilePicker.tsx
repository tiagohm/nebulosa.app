import { Badge, BreadcrumbItem, Breadcrumbs, Button, Input, Listbox, ListboxItem, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { format } from 'date-fns'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FilePickerMolecule } from '@/molecules/filepicker'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export interface FilePickerProps {
	readonly id: string
	readonly header?: React.ReactNode
	readonly onChoose: (entries?: string[]) => void
}

export const FilePicker = memo(({ id, header, onChoose }: FilePickerProps) => {
	const picker = useMolecule(FilePickerMolecule)
	const { mode, history, filtered, selected, directoryTree, filter, createDirectory, directoryName } = useSnapshot(picker.state, { sync: true })

	function handleChoose() {
		onChoose(selected.length === 0 ? undefined : (selected as string[]))
	}

	const Footer = (
		<>
			<TextButton color='danger' isDisabled={selected.length === 0} label='Clear' onPointerUp={picker.unselectAll} startContent={<Icons.Trash />} />
			<Badge color='success' content={selected.length} showOutline={false}>
				<TextButton color='success' isDisabled={selected.length === 0} label='Choose' onPointerUp={handleChoose} startContent={<Icons.Check />} />
			</Badge>
		</>
	)

	return (
		<Modal footer={Footer} header={header ?? (mode === 'directory' ? 'Open Directory' : 'Open File')} id={id} maxWidth='420px' onHide={onChoose}>
			<div className='mt-0 flex flex-col flex-wrap gap-2'>
				<div className='flex flex-row items-center gap-2'>
					<Tooltip content='Go Back' showArrow>
						<Button color='secondary' isDisabled={history.length === 0} isIconOnly onPointerUp={picker.navigateBack} variant='light'>
							<Icons.ArrowLeft />
						</Button>
					</Tooltip>
					<Breadcrumbs className='flex-1' itemsAfterCollapse={2} itemsBeforeCollapse={1} maxItems={3}>
						{directoryTree.map((item) => (
							<BreadcrumbItem key={item.name} onPointerUp={() => picker.navigateTo(item)} startContent={item.name ? undefined : <Icons.FolderRoot />}>
								{item.name}
							</BreadcrumbItem>
						))}
					</Breadcrumbs>
					<Tooltip content='Go To Parent' showArrow>
						<Button color='secondary' isDisabled={directoryTree.length <= 1} isIconOnly onPointerUp={picker.navigateToParent} variant='light'>
							<Icons.ArrowUp />
						</Button>
					</Tooltip>
					<Tooltip content={createDirectory ? 'Filter' : 'New Directory'} showArrow>
						<Button color='warning' isIconOnly onPointerUp={picker.toggleCreateDirectory} variant='light'>
							{createDirectory ? <Icons.Filter /> : <Icons.FolderPlus />}
						</Button>
					</Tooltip>
					<Tooltip content='Refresh' showArrow>
						<Button color='primary' isIconOnly onPointerUp={picker.list} variant='light'>
							<Icons.Sync />
						</Button>
					</Tooltip>
				</div>
				{!createDirectory && <Input isClearable label='Filter' onValueChange={picker.filter} size='sm' value={filter} />}
				{createDirectory && (
					<div className='flex flex-row items-center gap-2'>
						<Input label='Name' onValueChange={(value) => (picker.state.directoryName = value)} size='sm' value={directoryName} />
						<Tooltip content='Create' showArrow>
							<Button color='success' isDisabled={directoryName.length === 0} isIconOnly onPointerUp={picker.createDirectory} variant='light'>
								<Icons.Check />
							</Button>
						</Tooltip>
					</div>
				)}
				<Listbox
					isVirtualized
					onAction={(path) => picker.select(path as string)}
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
									<Button color='secondary' isIconOnly onPointerUp={() => picker.navigateTo(item)} variant='light'>
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
