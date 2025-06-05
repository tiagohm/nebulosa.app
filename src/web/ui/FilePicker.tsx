import { Api } from '@/shared/api'
import type { UseDraggableModalResult } from '@/shared/hooks'
import { Badge, BreadcrumbItem, Breadcrumbs, Button, Input, Listbox, ListboxItem, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tooltip } from '@heroui/react'
import { format } from 'date-fns'
import * as Lucide from 'lucide-react'
import { type Key, useEffect, useRef, useState } from 'react'
import type { DirectoryEntry, FileEntry } from 'src/api/types'

export type FilePickerMode = 'file' | 'directory'

export interface FilePickerProps {
	readonly draggable: UseDraggableModalResult
	readonly path?: string
	readonly filter?: string
	readonly mode?: FilePickerMode
	readonly multiple?: boolean
	readonly onChoose?: (entries?: string[]) => void
}

export function FilePicker({ draggable, path, filter, mode, multiple, onChoose }: FilePickerProps) {
	const directoryEntries = useRef<FileEntry[]>([])
	const [filteredDirectoryEntries, setFilteredDirectoryEntries] = useState<FileEntry[]>([])
	const [directoryTree, setDirectoryTree] = useState<DirectoryEntry[]>([])
	const [selectedEntries, setSelectedEntries] = useState(new Set<Key>())
	const [history, setHistory] = useState<string[]>([])
	const [filterText, setFilterText] = useState('')
	const [directoryName, setDirectoryName] = useState('')
	const [createDirectory, setCreateDirectory] = useState(false)
	const currentPath = useRef(path)

	useEffect(() => {
		if (draggable.isOpen) {
			currentPath.current = path
			setSelectedEntries(new Set())
			setHistory([])
			listDirectory()
		}
	}, [draggable.isOpen])

	useEffect(() => {
		if (filterText.trim().length === 0) {
			setFilteredDirectoryEntries(directoryEntries.current)
		} else {
			const text = filterText.toLowerCase()
			const entries = directoryEntries.current.filter((entry) => entry.name.toLowerCase().includes(text))
			setFilteredDirectoryEntries(entries)
		}
	}, [filterText, directoryEntries.current])

	async function listDirectory() {
		const { entries, tree } = await Api.FileSystem.list({ path: currentPath.current, filter, directoryOnly: mode === 'directory' })

		directoryEntries.current = entries
		setFilteredDirectoryEntries(entries)
		setDirectoryTree(tree)
	}

	function navigateTo(entry: DirectoryEntry) {
		setHistory([...history, currentPath.current!])
		currentPath.current = entry.path
		listDirectory()
	}

	function navigateBack() {
		if (history.length === 0) return

		const path = history.pop()
		setHistory([...history])

		currentPath.current = path
		listDirectory()
	}

	function navigateToParent() {
		if (directoryTree.length <= 1) return

		navigateTo(directoryTree[directoryTree.length - 2])
	}

	function refresh() {
		listDirectory()
	}

	async function handleCreateDirectory() {
		const { path } = await Api.FileSystem.create({ path: currentPath.current!, name: directoryName })

		if (path) {
			setCreateDirectory(false)
			setDirectoryName('')
			refresh()
		}
	}

	function handleEntryAction(path: Key) {
		const entry = directoryEntries.current.find((e) => e.path === path)

		if (!entry) return

		if (mode !== 'directory' && entry.directory) {
			navigateTo(entry)
			return
		}

		const data = new Set(selectedEntries)

		if (selectedEntries.has(path)) {
			data.delete(path)
			setSelectedEntries(data)
		} else if (multiple) {
			setSelectedEntries(data.add(path))
		} else {
			data.clear()
			setSelectedEntries(data.add(path))
		}
	}

	function handleChooseSelectedEntries() {
		if (onChoose) {
			onChoose(selectedEntries.size === 0 ? undefined : (Array.from(selectedEntries) as string[]))
		}

		draggable.close()
	}

	return (
		<Modal size='sm' ref={draggable.targetRef} isOpen={draggable.isOpen} onOpenChange={draggable.onOpenChange} classNames={{ base: 'max-w-[480px]' }}>
			<ModalContent>
				{(onClose) => (
					<>
						<ModalHeader {...draggable.moveProps} className='flex flex-row gap-1'>
							{mode === 'directory' ? 'Open Directory' : 'Open File'}
						</ModalHeader>
						<ModalBody>
							<div className='flex w-full flex-col flex-wrap gap-4'>
								<div className='flex flex-row items-center gap-2'>
									<Tooltip content='Go Back' showArrow>
										<Button isIconOnly isDisabled={history.length === 0} color='secondary' variant='light' onPress={navigateBack}>
											<Lucide.ArrowLeft size={16} />
										</Button>
									</Tooltip>
									<Breadcrumbs className='flex-1' itemsAfterCollapse={2} itemsBeforeCollapse={1} maxItems={3}>
										{directoryTree.map((e) => (
											<BreadcrumbItem key={e.name} startContent={e.name ? undefined : <Lucide.FolderRoot size={16} />} onPress={() => navigateTo(e)}>
												{e.name}
											</BreadcrumbItem>
										))}
									</Breadcrumbs>
									<Tooltip content='Go To Parent' showArrow>
										<Button isIconOnly isDisabled={directoryTree.length <= 1} color='secondary' variant='light' onPress={navigateToParent}>
											<Lucide.ArrowUp size={16} />
										</Button>
									</Tooltip>
									<Tooltip content='New Directory' showArrow>
										<Button isIconOnly color='warning' variant='light' onPress={() => setCreateDirectory(!createDirectory)}>
											<Lucide.FolderPlus size={16} />
										</Button>
									</Tooltip>
									<Tooltip content='Refresh' showArrow>
										<Button isIconOnly color='primary' variant='light' onPress={refresh}>
											<Lucide.RefreshCcw size={16} />
										</Button>
									</Tooltip>
								</div>
								{!createDirectory && <Input label='Filter' size='sm' value={filterText} onValueChange={setFilterText} />}
								{createDirectory && (
									<div className='flex flex-row items-center gap-2'>
										<Input label='Name' size='sm' value={directoryName} onValueChange={setDirectoryName} />
										<Tooltip content='Create' showArrow>
											<Button isIconOnly isDisabled={directoryName.length === 0} color='success' variant='light' onPress={handleCreateDirectory}>
												<Lucide.Check size={16} />
											</Button>
										</Tooltip>
									</div>
								)}
								<Listbox
									aria-label='Actions'
									isVirtualized
									onAction={handleEntryAction}
									selectionMode='none'
									virtualization={{
										maxListboxHeight: 200,
										itemHeight: 48,
									}}>
									{filteredDirectoryEntries.map((e) => (
										<ListboxItem key={e.path} startContent={e.directory ? <Lucide.Folder color='orange' /> : <Lucide.File color='gray' />} endContent={selectedEntries.has(e.path) && <Lucide.Check size={16} color='green' />}>
											<div className='flex flex-row items-center justify-between gap-1'>
												<div className='flex flex-col justify-center gap-1'>
													<span className='break-all whitespace-nowrap w-0'>{e.name}</span>
													<div className='w-full flex flex-row items-center justify-between gap-1'>
														{!e.directory && <span className='text-xs text-gray-500'>{e.size} B</span>}
														<span className='text-xs text-gray-500'>{format(e.updatedAt, 'yyyy-MM-dd HH:mm:ss')}</span>
													</div>
												</div>
												{mode === 'directory' && (
													<Button isIconOnly variant='light' color='secondary' onPress={() => navigateTo(e)}>
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
							<Button color='danger' variant='light' startContent={<Lucide.X />} onPress={onClose}>
								Close
							</Button>
							<Badge color='success' content={selectedEntries.size} showOutline={false}>
								<Button isDisabled={selectedEntries.size === 0} color='success' variant='light' startContent={<Lucide.Check />} onPress={handleChooseSelectedEntries}>
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
