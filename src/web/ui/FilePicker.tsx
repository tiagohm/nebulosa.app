import { Badge, BreadcrumbItem, Breadcrumbs, Button, Input, Listbox, ListboxItem, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { format } from 'date-fns'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { useModal } from '@/shared/hooks'
import { FilePickerMolecule } from '@/shared/molecules'

export type FilePickerMode = 'file' | 'directory'

export interface FilePickerProps {
	readonly header?: React.ReactNode
	readonly onChoose?: (entries?: string[]) => void
}

export function FilePicker({ header, onChoose }: FilePickerProps) {
	const filePicker = useMolecule(FilePickerMolecule)
	const { mode, filtered, selected, directoryTree, filter, createDirectory, directoryName } = useSnapshot(filePicker.state)
	const modal = useModal(() => onChoose?.())

	function handleChoose() {
		onChoose?.(selected.length === 0 ? undefined : (selected as string[]))
	}

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[480px]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-row items-center'>
							{header ?? (mode === 'directory' ? 'Open Directory' : 'Open File')}
						</ModalHeader>
						<ModalBody>
							<div className='flex w-full flex-col flex-wrap gap-2'>
								<div className='flex flex-row items-center gap-2'>
									<Tooltip content='Go Back' showArrow>
										<Button color='secondary' isDisabled={history.length === 0} isIconOnly onPointerUp={() => filePicker.navigateBack()} variant='light'>
											<Lucide.ArrowLeft size={16} />
										</Button>
									</Tooltip>
									<Breadcrumbs className='flex-1' itemsAfterCollapse={2} itemsBeforeCollapse={1} maxItems={3}>
										{directoryTree.map((item) => (
											<BreadcrumbItem key={item.name} onPointerUp={() => filePicker.navigateTo(item)} startContent={item.name ? undefined : <Lucide.FolderRoot size={16} />}>
												{item.name}
											</BreadcrumbItem>
										))}
									</Breadcrumbs>
									<Tooltip content='Go To Parent' showArrow>
										<Button color='secondary' isDisabled={directoryTree.length <= 1} isIconOnly onPointerUp={() => filePicker.navigateToParent()} variant='light'>
											<Lucide.ArrowUp size={16} />
										</Button>
									</Tooltip>
									<Tooltip content='New Directory' showArrow>
										<Button color='warning' isIconOnly onPointerUp={() => filePicker.toggleCreateDirectory()} variant='light'>
											<Lucide.FolderPlus size={16} />
										</Button>
									</Tooltip>
									<Tooltip content='Refresh' showArrow>
										<Button color='primary' isIconOnly onPointerUp={() => filePicker.list()} variant='light'>
											<Lucide.RefreshCcw size={16} />
										</Button>
									</Tooltip>
								</div>
								{!createDirectory && <Input label='Filter' onValueChange={(value) => filePicker.filter(value)} size='sm' value={filter} />}
								{createDirectory && (
									<div className='flex flex-row items-center gap-2'>
										<Input label='Name' onValueChange={(value) => (filePicker.state.directoryName = value)} size='sm' value={directoryName} />
										<Tooltip content='Create' showArrow>
											<Button color='success' isDisabled={directoryName.length === 0} isIconOnly onPointerUp={() => filePicker.createDirectory()} variant='light'>
												<Lucide.Check size={16} />
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
										<ListboxItem endContent={selected.includes(item.path) && <Lucide.Check color='green' size={16} />} key={item.path} startContent={item.directory ? <Lucide.Folder color='orange' /> : <Lucide.File color='gray' />}>
											<div className='flex flex-row items-center justify-between gap-1'>
												<div className='flex flex-col justify-center gap-1'>
													<span className='break-all whitespace-nowrap w-0'>{item.name}</span>
													<div className='w-full flex flex-row items-center justify-between gap-1'>
														<span className='text-xs text-gray-500'>{format(item.updatedAt, 'yyyy-MM-dd HH:mm:ss')}</span>
														{!item.directory && <span className='text-xs text-gray-500'> · {item.size} B</span>}
													</div>
												</div>
												{mode === 'directory' && (
													<Button color='secondary' isIconOnly onPointerUp={() => filePicker.navigateTo(item)} variant='light'>
														<Lucide.FolderOpen size={16} />
													</Button>
												)}
											</div>
										</ListboxItem>
									))}
								</Listbox>
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Badge color='success' content={selected.length} showOutline={false}>
								<Button color='success' isDisabled={selected.length === 0} onPointerUp={handleChoose} startContent={<Lucide.Check />} variant='flat'>
									Choose
								</Button>
							</Badge>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
