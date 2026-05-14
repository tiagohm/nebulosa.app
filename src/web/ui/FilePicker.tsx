import { useMolecule } from 'bunshi/react'
import { formatTemporal } from 'nebulosa/src/temporal'
import { memo, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { FilePickerMolecule } from '@/molecules/filepicker'
import { tw } from '../shared/util'
import { Badge } from './components/Badge'
import { Breadcrumbs } from './components/Breadcrumbs'
import { Button } from './components/Button'
import { IconButton } from './components/IconButton'
import { List } from './components/List'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { Modal } from './Modal'

const FILE_SIZE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const

export interface FilePickerProps {
	readonly id: string
	readonly header?: React.ReactNode
	readonly onChoose: (entries?: string[]) => void
}

export const FilePicker = memo(({ id, header, onChoose }: FilePickerProps) => (
	<Modal footer={<Footer onChoose={onChoose} />} header={<Header header={header} />} id={id} maxWidth="416px" onHide={onChoose}>
		<Body />
	</Modal>
))

function filePickerTitle(mode: 'directory' | 'file' | 'save') {
	return mode === 'save' ? 'Save' : mode === 'directory' ? 'Open Directory' : 'Open File'
}

const Header = memo(({ header }: Pick<FilePickerProps, 'header'>) => {
	const picker = useMolecule(FilePickerMolecule)
	const { mode } = useSnapshot(picker.state)

	return header ?? filePickerTitle(mode)
})

const Body = memo(() => (
	<div className="mt-0 flex flex-col flex-wrap gap-2">
		<Toolbar />
		<Filter />
		<CreateDirectory />
		<Files />
	</div>
))

function formatFileSize(size: number) {
	if (!Number.isFinite(size) || size <= 0) return '0 B'

	let value = size
	let unitIndex = 0

	while (value >= 1024 && unitIndex < FILE_SIZE_UNITS.length - 1) {
		value /= 1024
		unitIndex++
	}

	const digits = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
	return `${value.toFixed(digits)} ${FILE_SIZE_UNITS[unitIndex]}`
}

const Toolbar = memo(() => {
	const picker = useMolecule(FilePickerMolecule)
	const { history, directoryTree, directory } = useSnapshot(picker.state)

	return (
		<div className="flex flex-row items-center gap-2">
			<IconButton color="secondary" disabled={history.length === 0} icon={Icons.ArrowLeft} onClick={picker.navigateBack} tooltipContent="Go Back" />
			<Breadcrumbs className="flex-1" maxItems={3}>
				{directoryTree.map((item) => (
					<Button key={item.path} label={item.name} onClick={() => picker.navigateTo(item)} startContent={item.name ? undefined : <Icons.FolderRoot />} size="sm" variant="ghost" />
				))}
			</Breadcrumbs>
			<IconButton color="secondary" disabled={directoryTree.length <= 1} icon={Icons.ArrowUp} onClick={picker.navigateToParent} tooltipContent="Go To Parent" />
			<IconButton color="warning" icon={directory.create ? Icons.Filter : Icons.FolderPlus} onClick={picker.toggleCreateDirectory} tooltipContent={directory.create ? 'Filter' : 'New Directory'} />
			<IconButton color="primary" icon={Icons.Sync} onClick={picker.list} tooltipContent="Refresh" />
		</div>
	)
})

const Filter = memo(() => {
	const picker = useMolecule(FilePickerMolecule)
	const { directory, filter } = useSnapshot(picker.state)

	if (directory.create) return null

	return <TextInput fullWidth label="Filter" onValueChange={picker.filter} value={filter} />
})

const CreateDirectory = memo(() => {
	const picker = useMolecule(FilePickerMolecule)
	const { create, name } = useSnapshot(picker.state.directory)

	if (!create) return null

	return (
		<div className="flex flex-row items-center gap-2">
			<TextInput fullWidth label="Name" onValueChange={(value) => (picker.state.directory.name = value)} value={name} />
			<IconButton color="success" disabled={name.trim().length <= 0} icon={Icons.Check} onClick={picker.createDirectory} tooltipContent="Create" variant="ghost" />
		</div>
	)
})

const Files = memo(() => {
	const picker = useMolecule(FilePickerMolecule)
	const { mode, selected, filtered, filter } = useSnapshot(picker.state)
	const selectedPaths = useMemo(() => new Set(selected), [selected])
	const emptyContent = filter.trim().length > 0 ? 'No matching entries' : 'No entries'

	function handleAction(index: number) {
		if (!Number.isInteger(index) || index < 0 || index >= filtered.length) return

		const item = filtered[index]
		if (item !== undefined) void picker.select(item)
	}

	return (
		<List emptyContent={emptyContent} itemCount={filtered.length} itemHeight={44} onAction={handleAction}>
			{(i) => {
				const item = filtered[i]

				if (item === undefined) return null

				const isSelected = selectedPaths.has(item.path)
				const Icon = item.directory ? Icons.Folder : Icons.File
				const updatedAt = formatTemporal(item.updatedAt, 'YYYY-MM-DD HH:mm:ss')
				const metadata = item.directory ? updatedAt : `${updatedAt} | ${formatFileSize(item.size)}`

				return (
					<div className={tw('flex h-full min-w-0 cursor-pointer flex-row items-center gap-2 border-e-2 px-2 py-1 text-sm transition hover:bg-neutral-800/80', isSelected ? '[--color-variant:var(--success)] border-(--color-variant) bg-(--color-variant)/10' : 'border-transparent')}>
						<Icon className={tw('shrink-0', item.directory ? 'text-(--warning)' : 'text-neutral-500')} />
						<div className="flex min-w-0 flex-1 flex-col justify-center gap-0">
							<span className="min-w-0 truncate text-neutral-100">{item.name}</span>
							<span className="min-w-0 truncate text-xs text-neutral-500">{metadata}</span>
						</div>
						{mode === 'directory' && item.directory && <IconButton color="secondary" icon={Icons.FolderOpen} onClick={() => void picker.navigateTo(item)} tooltipContent="Open Directory" />}
					</div>
				)
			}}
		</List>
	)
})

const Footer = memo(({ onChoose }: Pick<FilePickerProps, 'onChoose'>) => {
	const picker = useMolecule(FilePickerMolecule)
	const { mode, selected } = useSnapshot(picker.state)
	const { save } = useSnapshot(picker.state)

	function handleOnChoose() {
		if (mode === 'save') {
			void picker.save(onChoose)
		} else {
			onChoose(selected.length === 0 ? undefined : Array.from(selected))
		}
	}

	return (
		<>
			{mode === 'save' ? (
				<>
					<TextInput className="flex-1" color={save.alreadyExists ? 'warning' : 'default'} label="Name" onValueChange={picker.updateSaveName} value={save.name} />
					<Button color="success" disabled={save.name.trim().length <= 0} label="Choose" onClick={handleOnChoose} startContent={<Icons.Check />} />
				</>
			) : (
				<>
					<Button color="danger" disabled={selected.length === 0} label="Clear" onClick={picker.unselectAll} startContent={<Icons.Broom />} />
					<Badge color="success" label={selected.length} visible={selected.length > 0}>
						<Button color="success" disabled={selected.length === 0} label="Choose" onClick={handleOnChoose} startContent={<Icons.Check />} />
					</Badge>
				</>
			)}
		</>
	)
})
