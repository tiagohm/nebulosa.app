import { useMolecule } from 'bunshi/react'
import { formatTemporal } from 'nebulosa/src/temporal'
import React, { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { FilePickerMolecule } from '@/molecules/filepicker'
import { stopPropagation, tw } from '../shared/util'
import { Badge } from './components/Badge'
import { Breadcrumbs } from './components/Breadcrumbs'
import { Button } from './components/Button'
import { IconButton } from './components/IconButton'
import { List } from './components/List'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { Modal } from './Modal'

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

const Header = memo(({ header }: Pick<FilePickerProps, 'header'>) => {
	const picker = useMolecule(FilePickerMolecule)
	const { mode } = useSnapshot(picker.state)

	return header ?? (mode === 'save' ? 'Save' : mode === 'directory' ? 'Open Directory' : 'Open File')
})

const Body = memo(() => (
	<div className="mt-0 flex flex-col flex-wrap gap-2">
		<Toolbar />
		<Filter />
		<CreateDirectory />
		<Files />
	</div>
))

const Toolbar = memo(() => {
	const picker = useMolecule(FilePickerMolecule)
	const { history, directoryTree, directory } = useSnapshot(picker.state)

	return (
		<div className="flex flex-row items-center gap-2">
			<IconButton color="secondary" disabled={history.length === 0} icon={Icons.ArrowLeft} onClick={picker.navigateBack} tooltipContent="Go Back" />
			<Breadcrumbs className="flex-1" maxItems={3}>
				{directoryTree.map((item) => (
					<Button key={item.name} label={item.name} onClick={() => picker.navigateTo(item)} startContent={item.name ? undefined : <Icons.FolderRoot />} size="sm" variant="ghost" />
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
				<IconButton color="success" disabled={name.length === 0} icon={Icons.Check} onClick={picker.createDirectory} tooltipContent="Create" variant="ghost" />
			</div>
		</Activity>
	)
})

const Files = memo(() => {
	const picker = useMolecule(FilePickerMolecule)
	const { mode, selected, filtered } = useSnapshot(picker.state)

	function handleClick(event: React.MouseEvent<HTMLElement>) {
		stopPropagation(event)
		const index = +event.currentTarget.dataset.index!
		return picker.select(filtered[index])
	}

	return (
		<List itemHeight={42} itemCount={filtered.length}>
			{(i) => {
				const item = filtered[i]

				return (
					<div onClick={handleClick} data-index={i} className={tw('flex flex-row items-center justify-between gap-1 p-2 cursor-pointer border-e-2', selected.includes(item.path) ? 'border-green-700' : 'border-transparent')}>
						{item.directory ? <Icons.Folder color="orange" /> : <Icons.File color="gray" />}
						<div className="flex w-full flex-col justify-center gap-0">
							<span className="w-0 break-all whitespace-nowrap">{item.name}</span>
							<div className="flex w-full flex-row items-center justify-between gap-1">
								<span className="text-xs text-gray-500">{formatTemporal(item.updatedAt, 'YYYY-MM-DD HH:mm:ss')}</span>
								{!item.directory && <span className="text-xs text-gray-500">{item.size} B</span>}
							</div>
						</div>
						{mode === 'directory' && <IconButton color="secondary" icon={Icons.FolderOpen} onClick={() => picker.navigateTo(item)} />}
					</div>
				)
			}}
		</List>
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
				<Button color="success" disabled={save.name.length === 0} label="Choose" onClick={handleOnChoose} startContent={<Icons.Check />} />
			</Activity>
			<Activity mode={mode !== 'save' ? 'visible' : 'hidden'}>
				<Button color="danger" disabled={selected.length === 0} label="Clear" onClick={picker.unselectAll} startContent={<Icons.Broom />} />
				<Badge color="success" label={selected.length}>
					<Button color="success" disabled={selected.length === 0} label="Choose" onClick={handleOnChoose} startContent={<Icons.Check />} />
				</Badge>
			</Activity>
		</>
	)
})
