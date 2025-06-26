import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, Slider } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageStretchMolecule } from '@/molecules/image/stretch'
import { useModal } from '@/shared/hooks'

export const ImageStretch = memo(() => {
	const stretch = useMolecule(ImageStretchMolecule)
	const { viewer } = stretch
	const { auto, shadow, midtone, highlight, meanBackground } = useSnapshot(stretch.state)
	const { info } = useSnapshot(viewer.state)
	const modal = useModal(() => viewer.closeModal('stretch'))

	function handleShadowHighlightChange(value?: number | number[]) {
		if (Array.isArray(value)) {
			viewer.state.transformation.stretch.shadow = value[0]
			viewer.state.transformation.stretch.highlight = value[1]
		}
	}

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[300px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-col gap-0'>
							<span>Stretch</span>
							<span className='text-xs font-normal text-gray-400'>{info.originalPath}</span>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'>
								<NumberInput className='col-span-6' label='Shadow' maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('shadow', value)} size='sm' value={shadow} />
								<NumberInput className='col-span-6' label='Highlight' maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('highlight', value)} size='sm' value={highlight} />
								<Slider className='col-span-full' maxValue={65536} minValue={0} onChange={handleShadowHighlightChange} step={8} value={[shadow, highlight]} />
								<NumberInput className='col-span-full' label='Midtone' maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('midtone', value)} size='sm' value={midtone} />
								<Slider className='col-span-full' maxValue={65536} minValue={0} onChange={(value) => stretch.update('midtone', value as number)} step={8} value={midtone} />
								<NumberInput className='col-span-full' label='Mean Background' maxValue={1} minValue={0} onValueChange={(value) => stretch.update('meanBackground', value)} size='sm' step={0.01} value={meanBackground} />
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='primary' onPointerUp={stretch.auto} startContent={<Lucide.WandSparkles />} variant={auto ? 'solid' : 'flat'}>
								Auto
							</Button>
							<Button color='danger' onPointerUp={stretch.reset} startContent={<Tabler.IconRestore />} variant='flat'>
								Reset
							</Button>
							<Button color='success' onPointerUp={stretch.apply} startContent={<Lucide.Check />} variant='flat'>
								Stretch
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
