import { Badge, BreadcrumbItem, Breadcrumbs, Listbox, ListboxItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatTemporal } from 'nebulosa/src/temporal'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { FilePickerMolecule } from '@/molecules/filepicker'
import { Button } from './components/Button'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { Modal } from './Modal'

export interface FilePickerProps {
	readonly id: string
	readonly header?: React.ReactNode
	readonly onChoose: (entries?: string[]) => void
}

export const FilePicker = memo(({ id, header, onChoose }: FilePickerProps) => {
	return (
		<Modal footer={<Footer onChoose={onChoose} />} header={<Header header={header} />} id={id} maxWidth="416px" onHide={onChoose}>
			<Body />
		</Modal>
	)
})

const Header = memo(({ header }: Pick<FilePickerProps, 'header'>) => {
	const picker = useMolecule(FilePickerMolecule)
	const { mode } = useSnapshot(picker.state)

	return header ?? (mode === 'save' ? 'Save' : mode === 'directory' ? 'Open Directory' : 'Open File')
})

const Body = memo(() => {
	return (
		<div className="mt-0 flex flex-col flex-wrap gap-2">
			<Toolbar />
			<Filter />
			<CreateDirectory />
			<Files />
		</div>
	)
})

const Toolbar = memo(() => {
	const picker = useMolecule(FilePickerMolecule)
	const { history, directoryTree, directory } = useSnapshot(picker.state)

	return (
		<div className="flex flex-row items-center gap-2">
			<IconButton color="secondary" disabled={history.length === 0} icon={Icons.ArrowLeft} onPointerUp={picker.navigateBack} tooltipContent="Go Back" />
			<Breadcrumbs className="flex-1" itemsAfterCollapse={2} itemsBeforeCollapse={1} maxItems={3}>
				{directoryTree.map((item) => (
					<BreadcrumbItem key={item.name} onPointerUp={() => picker.navigateTo(item)} startContent={item.name ? undefined : <Icons.FolderRoot />}>
						{item.name}
					</BreadcrumbItem>
				))}
			</Breadcrumbs>
			<IconButton color="secondary" disabled={directoryTree.length <= 1} icon={Icons.ArrowUp} onPointerUp={picker.navigateToParent} tooltipContent="Go To Parent" />
			<IconButton color="warning" icon={directory.create ? Icons.Filter : Icons.FolderPlus} onPointerUp={picker.toggleCreateDirectory} tooltipContent={directory.create ? 'Filter' : 'New Directory'} />
			<IconButton color="primary" icon={Icons.Sync} onPointerUp={picker.list} tooltipContent="Refresh" />
		</div>
	)
})

const Filter = memo(() => {
	const picker = useMolecule(FilePickerMolecule)
	const { directory, filter } = useSnapshot(picker.state)

	return (
		<Activity mode={directory.create ? 'hidden' : 'visible'}>
			<TextInput label="Filter" onValueChange={picker.filter} value={filter} />
		</Activity>
	)
})

const CreateDirectory = memo(() => {
	const picker = useMolecule(FilePickerMolecule)
	const { create, name } = useSnapshot(picker.state.directory, { sync: true })

	return (
		<Activity mode={create ? 'visible' : 'hidden'}>
			<div className="flex flex-row items-center gap-2">
				<TextInput label="Name" onValueChange={(value) => (picker.state.directory.name = value)} value={name} />
				<IconButton color="success" disabled={name.length === 0} icon={Icons.Check} onPointerUp={picker.createDirectory} tooltipContent="Create" variant="ghost" />
			</div>
		</Activity>
	)
})

const Files = memo(() => {
	const picker = useMolecule(FilePickerMolecule)
	const { mode, selected, filtered } = useSnapshot(picker.state)

	return (
		<Listbox
			isVirtualized
			onAction={picker.select}
			selectionMode="none"
			virtualization={{
				maxListboxHeight: 200,
				itemHeight: 48,
			}}>
			{filtered.map((item) => (
				<ListboxItem endContent={selected.includes(item.path) && <Icons.Check color="green" />} key={item.path} startContent={item.directory ? <Icons.Folder color="orange" /> : <Icons.File color="gray" />}>
					<div className="flex flex-row items-center justify-between gap-1">
						<div className="flex w-full flex-col justify-center gap-0">
							<span className="w-0 break-all whitespace-nowrap">{item.name}</span>
							<div className="flex w-full flex-row items-center justify-between gap-1">
								<span className="text-xs text-gray-500">{formatTemporal(item.updatedAt, 'YYYY-MM-DD HH:mm:ss')}</span>
								{!item.directory && <span className="text-xs text-gray-500">{item.size} B</span>}
							</div>
						</div>
						{mode === 'directory' && <IconButton color="secondary" icon={Icons.FolderOpen} onPointerUp={() => picker.navigateTo(item)} />}
					</div>
				</ListboxItem>
			))}
		</Listbox>
	)
})

const Footer = memo(({ onChoose }: Pick<FilePickerProps, 'onChoose'>) => {
	const picker = useMolecule(FilePickerMolecule)
	const { mode, selected } = useSnapshot(picker.state)
	const { save } = useSnapshot(picker.state, { sync: true })

	function handleOnChoose() {
		if (mode === 'save') {
			void picker.save(onChoose)
		} else {
			onChoose(selected.length === 0 ? undefined : (selected as string[]))
		}
	}

	return (
		<>
			<Activity mode={mode === 'save' ? 'visible' : 'hidden'}>
				<TextInput className="flex-1" color={save.alreadyExists ? 'warning' : 'default'} label="Name" onValueChange={picker.updateSaveName} value={save.name} />
				<Button color="success" disabled={save.name.length === 0} label="Choose" onPointerUp={handleOnChoose} startContent={<Icons.Check />} />
			</Activity>
			<Activity mode={mode !== 'save' ? 'visible' : 'hidden'}>
				<Button color="danger" disabled={selected.length === 0} label="Clear" onPointerUp={picker.unselectAll} startContent={<Icons.Broom />} />
				<Badge color="success" content={selected.length} showOutline={false}>
					<Button color="success" disabled={selected.length === 0} label="Choose" onPointerUp={handleOnChoose} startContent={<Icons.Check />} />
				</Badge>
			</Activity>
		</>
	)
})
