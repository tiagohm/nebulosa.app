import { Checkbox, Input } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageStatisticsMolecule } from '@/molecules/image/statistics'
import { Histogram } from './Histogram'
import { ImageChannelButtonGroup } from './ImageChannelButtonGroup'
import { Modal } from './Modal'

export const ImageStatistics = memo(() => {
	const statistics = useMolecule(ImageStatisticsMolecule)
	const { histogram, selected } = useSnapshot(statistics.state)
	const { transformed } = useSnapshot(statistics.state.request)

	const n = histogram.length
	const hs = histogram[selected]

	return (
		<Modal header='Statistics' id={`settings-${statistics.scope.image.key}`} maxWidth='300px' onHide={statistics.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<Checkbox className='col-span-full' isSelected={transformed} onValueChange={(value) => statistics.update('transformed', value)}>
					Transformed
				</Checkbox>
				{n === 3 && <ImageChannelButtonGroup className='col-span-full' onValueChange={(value) => (statistics.state.selected = value === 'GREEN' ? 1 : value === 'BLUE' ? 2 : 0)} value={selected === 0 ? 'RED' : selected === 1 ? 'GREEN' : 'BLUE'} />}
				{hs && (
					<>
						<Input className='col-span-6' isReadOnly label='Count: Total | Max' size='sm' value={`${hs.count[0].toFixed(0)} | ${hs.count[1].toFixed(0)}`} />
						<Input className='col-span-6' isReadOnly label='Mean' size='sm' value={hs.mean.toFixed(8)} />
						<Input className='col-span-6' isReadOnly label='Median' size='sm' value={hs.median.toFixed(8)} />
						<Input className='col-span-6' isReadOnly label='Variance' size='sm' value={hs.variance.toFixed(8)} />
						<Input className='col-span-6' isReadOnly label='Std Dev' size='sm' value={hs.standardDeviation.toFixed(8)} />
						<Input className='col-span-6' isReadOnly label='Min | Max' size='sm' value={`${hs.minimum[0].toFixed(6)} | ${hs.maximum[0].toFixed(6)}`} />
					</>
				)}
				<div className='col-span-full'>
					<Histogram histogram={histogram} style={{ width: '275px', height: '120px' }} />
				</div>
			</div>
		</Modal>
	)
})
