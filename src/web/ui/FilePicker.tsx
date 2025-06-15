import type { UseDraggableModalResult } from '@/shared/hooks'
import { FilePickerMolecule } from '@/shared/molecules'
import { Badge, BreadcrumbItem, Breadcrumbs, Button, Input, Listbox, ListboxItem, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { format } from 'date-fns'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'

export type FilePickerMode = 'file' | 'directory'

export interface FilePickerProps {
	readonly draggable: UseDraggableModalResult
	readonly header?: React.ReactNode
	readonly onChoose?: (entries?: string[]) => void
}

export function FilePicker({ draggable, header, onChoose }: FilePickerProps) {
	const filePicker = useMolecule(FilePickerMolecule)
	const { mode, filtered, selected, directoryTree, filter, createDirectory, directoryName } = useSnapshot(filePicker.state)

	function choose() {
		onChoose?.(selected.length === 0 ? undefined : (selected as string[]))
		draggable.close()
	}

	return (
		<Modal size='sm' ref={draggable.targetRef} isOpen={draggable.isOpen} onOpenChange={draggable.onOpenChange} classNames={{ base: 'max-w-[480px]', wrapper: 'pointer-events-none' }} backdrop='transparent'>
			<ModalContent>
				{(onClose) => (
					<>
						<ModalHeader {...draggable.moveProps} className='flex flex-row items-center'>
							{header ?? (mode === 'directory' ? 'Open Directory' : 'Open File')}
						</ModalHeader>
						<ModalBody>
							<div className='flex w-full flex-col flex-wrap gap-2'>
								<div className='flex flex-row items-center gap-2'>
									<Tooltip content='Go Back' showArrow>
										<Button isIconOnly isDisabled={history.length === 0} color='secondary' variant='light' onPointerUp={() => filePicker.navigateBack()}>
											<Lucide.ArrowLeft size={16} />
										</Button>
									</Tooltip>
									<Breadcrumbs className='flex-1' itemsAfterCollapse={2} itemsBeforeCollapse={1} maxItems={3}>
										{directoryTree.map((item) => (
											<BreadcrumbItem key={item.name} startContent={item.name ? undefined : <Lucide.FolderRoot size={16} />} onPointerUp={() => filePicker.navigateTo(item)}>
												{item.name}
											</BreadcrumbItem>
										))}
									</Breadcrumbs>
									<Tooltip content='Go To Parent' showArrow>
										<Button isIconOnly isDisabled={directoryTree.length <= 1} color='secondary' variant='light' onPointerUp={() => filePicker.navigateToParent()}>
											<Lucide.ArrowUp size={16} />
										</Button>
									</Tooltip>
									<Tooltip content='New Directory' showArrow>
										<Button isIconOnly color='warning' variant='light' onPointerUp={() => filePicker.toggleCreateDirectory()}>
											<Lucide.FolderPlus size={16} />
										</Button>
									</Tooltip>
									<Tooltip content='Refresh' showArrow>
										<Button isIconOnly color='primary' variant='light' onPointerUp={() => filePicker.list()}>
											<Lucide.RefreshCcw size={16} />
										</Button>
									</Tooltip>
								</div>
								{!createDirectory && <Input label='Filter' size='sm' value={filter} onValueChange={(value) => filePicker.filter(value)} />}
								{createDirectory && (
									<div className='flex flex-row items-center gap-2'>
										<Input label='Name' size='sm' value={directoryName} onValueChange={(value) => (filePicker.state.directoryName = value)} />
										<Tooltip content='Create' showArrow>
											<Button isIconOnly isDisabled={directoryName.length === 0} color='success' variant='light' onPointerUp={() => filePicker.createDirectory()}>
												<Lucide.Check size={16} />
											</Button>
										</Tooltip>
									</div>
								)}
								<Listbox
									isVirtualized
									onAction={(path) => filePicker.select(path)}
									selectionMode='none'
									virtualization={{
										maxListboxHeight: 200,
										itemHeight: 48,
									}}>
									{filtered.map((item) => (
										<ListboxItem key={item.path} startContent={item.directory ? <Lucide.Folder color='orange' /> : <Lucide.File color='gray' />} endContent={selected.includes(item.path) && <Lucide.Check size={16} color='green' />}>
											<div className='flex flex-row items-center justify-between gap-1'>
												<div className='flex flex-col justify-center gap-1'>
													<span className='break-all whitespace-nowrap w-0'>{item.name}</span>
													<div className='w-full flex flex-row items-center justify-between gap-1'>
														<span className='text-xs text-gray-500'>{format(item.updatedAt, 'yyyy-MM-dd HH:mm:ss')}</span>
														{!item.directory && <span className='text-xs text-gray-500'> · {item.size} B</span>}
													</div>
												</div>
												{mode === 'directory' && (
													<Button isIconOnly variant='light' color='secondary' onPointerUp={() => filePicker.navigateTo(item)}>
														<Lucide.FolderOpen size={16} />
													</Button>
												)}
											</div>
										</ListboxItem>
									))}
								</Listbox>
							</div>
						</ModalBody>
						<ModalFooter>
							<Button color='danger' variant='light' startContent={<Lucide.X />} onPointerUp={onClose}>
								Close
							</Button>
							<Badge color='success' content={selected.length} showOutline={false}>
								<Button isDisabled={selected.length === 0} color='success' variant='light' startContent={<Lucide.Check />} onPointerUp={choose}>
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
