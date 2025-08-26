import { Button, NumberInput, Slider } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageStretchMolecule } from '@/molecules/image/stretch'
import { Icons } from './Icon'
import { Modal } from './Modal'

export const ImageStretch = memo(() => {
	const stretch = useMolecule(ImageStretchMolecule)
	const { viewer } = stretch
	const { auto, shadow, midtone, highlight, meanBackground } = useSnapshot(stretch.state)
	const { info } = useSnapshot(viewer.state)

	function handleShadowHighlightChange(value?: number | number[]) {
		if (Array.isArray(value)) {
			viewer.state.transformation.stretch.shadow = value[0]
			viewer.state.transformation.stretch.highlight = value[1]
		}
	}

	return (
		<Modal
			footer={
				<>
					<Button color='primary' onPointerUp={stretch.auto} startContent={<Icons.WandSparkles />} variant={auto ? 'solid' : 'flat'}>
						Auto
					</Button>
					<Button color='danger' onPointerUp={stretch.reset} startContent={<Icons.Restore />} variant='flat'>
						Reset
					</Button>
					<Button color='success' onPointerUp={() => stretch.apply()} startContent={<Icons.Check />} variant='flat'>
						Stretch
					</Button>
				</>
			}
			header={
				<div className='w-full flex flex-col justify-center gap-0'>
					<span>Stretch</span>
					<span className='text-xs font-normal text-gray-400 max-w-full'>{info.originalPath}</span>
				</div>
			}
			maxWidth='289px'
			name={`stretch-${stretch.scope.image.key}`}
			onClose={() => viewer.close('stretch')}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<NumberInput className='col-span-6' label='Shadow' maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('shadow', value)} size='sm' value={shadow} />
				<NumberInput className='col-span-6' label='Highlight' maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('highlight', value)} size='sm' value={highlight} />
				<Slider className='col-span-full' maxValue={65536} minValue={0} onChange={handleShadowHighlightChange} step={8} value={[shadow, highlight]} />
				<NumberInput className='col-span-full' label='Midtone' maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('midtone', value)} size='sm' value={midtone} />
				<Slider className='col-span-full' maxValue={65536} minValue={0} onChange={(value) => stretch.update('midtone', value as number)} step={8} value={midtone} />
				<NumberInput className='col-span-full' label='Mean Background (Auto Stretch)' maxValue={1} minValue={0} onValueChange={(value) => stretch.update('meanBackground', value)} size='sm' step={0.01} value={meanBackground} />
			</div>
		</Modal>
	)
})
