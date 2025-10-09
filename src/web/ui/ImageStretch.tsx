import { NumberInput, Slider } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageStretchMolecule } from '@/molecules/image/stretch'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageStretch = memo(() => {
	const stretch = useMolecule(ImageStretchMolecule)
	const { auto, shadow, midtone, highlight, meanBackground } = useSnapshot(stretch.state, { sync: true })

	function handleShadowHighlightChange(value?: number | number[]) {
		if (Array.isArray(value)) {
			stretch.state.shadow = value[0]
			stretch.state.highlight = value[1]
		}
	}

	const Footer = (
		<>
			<TextButton color='primary' label='Auto' onPointerUp={stretch.auto} startContent={<Icons.WandSparkles />} variant={auto ? 'solid' : 'flat'} />
			<TextButton color='danger' label='Reset' onPointerUp={stretch.reset} startContent={<Icons.Restore />} />
			<TextButton color='success' label='Stretch' onPointerUp={() => stretch.apply()} startContent={<Icons.Check />} />
		</>
	)

	return (
		<Modal footer={Footer} header='Stretch' id={`stretch-${stretch.scope.image.key}`} maxWidth='289px' onHide={stretch.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<NumberInput className='col-span-6' formatOptions={INTEGER_NUMBER_FORMAT} label='Shadow' maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('shadow', value)} size='sm' value={shadow} />
				<NumberInput className='col-span-6' formatOptions={INTEGER_NUMBER_FORMAT} label='Highlight' maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('highlight', value)} size='sm' value={highlight} />
				<Slider className='col-span-full' disableThumbScale maxValue={65536} minValue={0} onChange={handleShadowHighlightChange} step={8} value={[shadow, highlight]} />
				<NumberInput className='col-span-full' formatOptions={INTEGER_NUMBER_FORMAT} label='Midtone' maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('midtone', value)} size='sm' value={midtone} />
				<Slider className='col-span-full' disableThumbScale maxValue={65536} minValue={0} onChange={(value) => stretch.update('midtone', value as number)} step={8} value={midtone} />
				<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} label='Mean Background (Auto Stretch)' maxValue={1} minValue={0} onValueChange={(value) => stretch.update('meanBackground', value)} size='sm' step={0.01} value={meanBackground} />
			</div>
		</Modal>
	)
})
