import { ButtonGroup, Checkbox, Input } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageStatisticsMolecule } from '@/molecules/image/statistics'
import { Histogram } from './Histogram'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageStatistics = memo(() => {
	const statistics = useMolecule(ImageStatisticsMolecule)
	const { histogram, selected } = useSnapshot(statistics.state)
	const { transformed } = useSnapshot(statistics.state.request, { sync: true })

	const n = histogram.length
	const hs = histogram[selected]

	return (
		<Modal header='Statistics' id={`settings-${statistics.scope.image.key}`} maxWidth='300px' onHide={statistics.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<Checkbox className='col-span-full' isSelected={transformed} onValueChange={(value) => statistics.update('transformed', value)}>
					Transformed
				</Checkbox>
				{n === 3 && (
					<div className='col-span-full flex flex-row items-center justify-between'>
						<ButtonGroup>
							<TextButton color='danger' label='RED' onPointerUp={() => (statistics.state.selected = 0)} variant={selected === 0 ? 'flat' : 'light'} />
							<TextButton color='success' label='GREEN' onPointerUp={() => (statistics.state.selected = 1)} variant={selected === 1 ? 'flat' : 'light'} />
							<TextButton color='primary' label='BLUE' onPointerUp={() => (statistics.state.selected = 2)} variant={selected === 2 ? 'flat' : 'light'} />
						</ButtonGroup>
					</div>
				)}
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
					<Histogram histogram={histogram} style={{ width: '275px', height: '150px' }} />
				</div>
			</div>
		</Modal>
	)
})
