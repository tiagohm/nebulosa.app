import { Badge, BreadcrumbItem, Breadcrumbs, Input, Listbox, ListboxItem, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { format } from 'date-fns'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { FilePickerMolecule } from '@/molecules/filepicker'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export interface FilePickerProps {
	readonly id: string
	readonly header?: React.ReactNode
	readonly onChoose: (entries?: string[]) => void
}

export const FilePicker = memo(({ id, header, onChoose }: FilePickerProps) => {
	const picker = useMolecule(FilePickerMolecule)
	const { mode, history, filtered, selected, directoryTree, filter, directory, save } = useSnapshot(picker.state, { sync: true })

	function handleOnChoose() {
		if (mode === 'save') {
			void picker.save(onChoose)
		} else {
			onChoose(selected.length === 0 ? undefined : (selected as string[]))
		}
	}

	const Footer = (
		<>
			<Activity mode={mode === 'save' ? 'visible' : 'hidden'}>
				<Input className='flex-1' color={save.alreadyExists ? 'warning' : 'default'} isClearable label='Name' onValueChange={picker.updateSaveName} size='sm' value={save.name} />
				<TextButton color='success' isDisabled={save.name.length === 0} label='Choose' onPointerUp={handleOnChoose} startContent={<Icons.Check />} />
			</Activity>
			<Activity mode={mode !== 'save' ? 'visible' : 'hidden'}>
				<TextButton color='danger' isDisabled={selected.length === 0} label='Clear' onPointerUp={picker.unselectAll} startContent={<Icons.Trash />} />
				<Badge color='success' content={selected.length} showOutline={false}>
					<TextButton color='success' isDisabled={selected.length === 0} label='Choose' onPointerUp={handleOnChoose} startContent={<Icons.Check />} />
				</Badge>
			</Activity>
		</>
	)

	return (
		<Modal footer={Footer} header={header ?? (mode === 'save' ? 'Save' : mode === 'directory' ? 'Open Directory' : 'Open File')} id={id} maxWidth='420px' onHide={onChoose}>
			<div className='mt-0 flex flex-col flex-wrap gap-2'>
				<div className='flex flex-row items-center gap-2'>
					<Tooltip content='Go Back' showArrow>
						<IconButton color='secondary' icon={Icons.ArrowLeft} isDisabled={history.length === 0} onPointerUp={picker.navigateBack} />
					</Tooltip>
					<Breadcrumbs className='flex-1' itemsAfterCollapse={2} itemsBeforeCollapse={1} maxItems={3}>
						{directoryTree.map((item) => (
							<BreadcrumbItem key={item.name} onPointerUp={() => picker.navigateTo(item)} startContent={item.name ? undefined : <Icons.FolderRoot />}>
								{item.name}
							</BreadcrumbItem>
						))}
					</Breadcrumbs>
					<Tooltip content='Go To Parent' showArrow>
						<IconButton color='secondary' icon={Icons.ArrowUp} isDisabled={directoryTree.length <= 1} onPointerUp={picker.navigateToParent} />
					</Tooltip>
					<Tooltip content={directory.create ? 'Filter' : 'New Directory'} showArrow>
						<IconButton color='warning' icon={directory.create ? Icons.Filter : Icons.FolderPlus} onPointerUp={picker.toggleCreateDirectory} />
					</Tooltip>
					<Tooltip content='Refresh' showArrow>
						<IconButton color='primary' icon={Icons.Sync} onPointerUp={picker.list} />
					</Tooltip>
				</div>
				<Activity mode={directory.create ? 'hidden' : 'visible'}>
					<Input isClearable label='Filter' onValueChange={picker.filter} size='sm' value={filter} />
				</Activity>
				<Activity mode={directory.create ? 'visible' : 'hidden'}>
					<div className='flex flex-row items-center gap-2'>
						<Input label='Name' onValueChange={(value) => (picker.state.directory.name = value)} size='sm' value={directory.name} />
						<Tooltip content='Create' showArrow>
							<IconButton color='success' icon={Icons.Check} isDisabled={directory.name.length === 0} onPointerUp={picker.createDirectory} variant='light' />
						</Tooltip>
					</div>
				</Activity>
				<Listbox
					isVirtualized
					onAction={picker.select}
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
								{mode === 'directory' && <IconButton color='secondary' icon={Icons.FolderOpen} onPointerUp={() => picker.navigateTo(item)} />}
							</div>
						</ListboxItem>
					))}
				</Listbox>
			</div>
		</Modal>
	)
})
