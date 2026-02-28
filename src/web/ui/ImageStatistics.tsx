import { Checkbox, Input } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageStatisticsMolecule } from '@/molecules/image/statistics'
import { Histogram } from './Histogram'
import { ImageChannelButtonGroup } from './ImageChannelButtonGroup'
import { Modal } from './Modal'

export const ImageStatistics = memo(() => {
	const statistics = useMolecule(ImageStatisticsMolecule)

	return (
		<Modal header='Statistics' id={`settings-${statistics.viewer.storageKey}`} maxWidth='296px' onHide={statistics.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const statistics = useMolecule(ImageStatisticsMolecule)
	const { histogram } = useSnapshot(statistics.state)

	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Options />
			<Stats />
			<div className='col-span-full'>
				<Histogram histogram={histogram} style={{ width: '275px', height: '120px' }} />
			</div>
		</div>
	)
})

const Options = memo(() => {
	const statistics = useMolecule(ImageStatisticsMolecule)
	const { histogram, selected } = useSnapshot(statistics.state)
	const { transformed } = useSnapshot(statistics.state.request)

	return (
		<>
			<Checkbox className='col-span-full' isSelected={transformed} onValueChange={(value) => statistics.update('transformed', value)}>
				Transformed
			</Checkbox>
			<Activity mode={histogram.length === 3 ? 'visible' : 'hidden'}>
				<ImageChannelButtonGroup className='col-span-full' onValueChange={(value) => (statistics.state.selected = value === 'GREEN' ? 1 : value === 'BLUE' ? 2 : 0)} value={selected === 0 ? 'RED' : selected === 1 ? 'GREEN' : 'BLUE'} />
			</Activity>
		</>
	)
})

const Stats = memo(() => {
	const statistics = useMolecule(ImageStatisticsMolecule)
	const { histogram, selected } = useSnapshot(statistics.state)
	const hs = histogram[selected]

	if (hs === undefined) return null

	return (
		<>
			<Input className='col-span-6' isReadOnly label='Count: Total | Max' size='sm' value={`${hs.count[0].toFixed(0)} | ${hs.count[1].toFixed(0)}`} />
			<Input className='col-span-6' isReadOnly label='Mean' size='sm' value={hs.mean.toFixed(8)} />
			<Input className='col-span-6' isReadOnly label='Median' size='sm' value={hs.median.toFixed(8)} />
			<Input className='col-span-6' isReadOnly label='Variance' size='sm' value={hs.variance.toFixed(8)} />
			<Input className='col-span-6' isReadOnly label='Std Dev' size='sm' value={hs.standardDeviation.toFixed(8)} />
			<Input className='col-span-6' isReadOnly label='Min | Max' size='sm' value={`${hs.minimum[0].toFixed(6)} | ${hs.maximum[0].toFixed(6)}`} />
		</>
	)
})
