import { satelliteStore } from '@stores/atlas.satellite.store'
import { EphemerisPositionContext, EphemerisAndChart } from '@ui/Atlas'
import { IconButton } from '@ui/components/IconButton'
import { Paginator } from '@ui/components/Paginator'
import { Table } from '@ui/components/Table'
import { TextInput } from '@ui/components/TextInput'
import { Icons } from '@ui/Icon'
import { SatelliteCategoryChipGroup } from '@ui/SatelliteCategoryChipGroup'
import { SatelliteGroupTypeChipGroup } from '@ui/SatelliteGroupTypeChipGroup'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const Satellite = memo(({ api }: IDockviewPanelProps) => {
	useEffect(satelliteStore.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Filter />
			<Result />
			<Page className="col-span-full w-full" />
			<EphemerisPositionContext value={satelliteStore}>
				<EphemerisAndChart />
			</EphemerisPositionContext>
		</div>
	)
})

const Filter = memo(() => {
	const { groups, category } = useSnapshot(satelliteStore.state.request)
	const { text } = useSnapshot(satelliteStore.state.request)
	const { loading } = useSnapshot(satelliteStore.state)

	return (
		<div className="col-span-full grid grid-cols-subgrid items-center gap-2">
			<TextInput clearable className="col-span-full" label="Search" onValueChange={satelliteStore.setText} value={text} />
			<p className="col-span-full flex items-center gap-2 text-sm font-bold">
				CATEGORY
				<IconButton color="danger" disabled={loading} icon={Icons.Restore} onClick={satelliteStore.resetCategory} tooltipContent="Reset" variant="flat" size="sm" />
			</p>
			<SatelliteCategoryChipGroup className="col-span-full" onValueChange={satelliteStore.setCategory} value={category} />
			<p className="col-span-full flex items-center gap-2 text-sm font-bold">
				GROUP
				<IconButton color="danger" disabled={loading} icon={Icons.Restore} onClick={satelliteStore.resetGroup} tooltipContent="Reset" variant="flat" size="sm" />
			</p>
			<SatelliteGroupTypeChipGroup category={category} className="col-span-full" onValueChange={satelliteStore.setGroups} value={groups} />
		</div>
	)
})

const Result = memo(() => {
	const { result } = useSnapshot(satelliteStore.state)

	return (
		<Table rowCount={result.length} columnCount={3} className="col-span-full" onAction={satelliteStore.select}>
			<span>ID</span>
			<span>Name</span>
			<span>Group</span>
			{result.map((item) => (
				<>
					<span>{item.id}</span>
					<span>{item.name}</span>
					<span>{item.groups.join(', ')}</span>
				</>
			))}
		</Table>
	)
})

const Page = memo((props: React.ComponentProps<'div'>) => {
	const { page } = useSnapshot(satelliteStore.state.request)
	const { loading, result } = useSnapshot(satelliteStore.state)

	return <Paginator {...props} count={result.length} loading={loading} onNext={satelliteStore.next} onPrev={satelliteStore.prev} page={page} />
})
