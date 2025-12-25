import { Checkbox, NumberInput, Slider } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageStretchMolecule } from '@/molecules/image/stretch'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { SigmaClipCenterMethodSelect } from './SigmaClipCenterMethodSelect'
import { SigmaClipDispersionMethodSelect } from './SigmaClipDispersionMethodSelect'
import { TextButton } from './TextButton'

export const ImageStretch = memo(() => {
	const stretch = useMolecule(ImageStretchMolecule)
	const { auto, shadow, midtone, highlight, meanBackground, clippingPoint, sigmaClip, centerMethod, dispersionMethod, sigmaLower, sigmaUpper, bits } = useSnapshot(stretch.state.stretch, { sync: true })

	function handleShadowHighlightChange(value?: number | number[]) {
		if (Array.isArray(value)) {
			stretch.state.stretch.shadow = value[0]
			stretch.state.stretch.highlight = value[1]
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
		<Modal footer={Footer} header='Stretch' id={`stretch-${stretch.scope.image.key}`} maxWidth='300px' onHide={stretch.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<NumberInput className='col-span-6' formatOptions={INTEGER_NUMBER_FORMAT} label='Shadow' maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('shadow', value)} size='sm' value={shadow} />
				<NumberInput className='col-span-6' formatOptions={INTEGER_NUMBER_FORMAT} label='Highlight' maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('highlight', value)} size='sm' value={highlight} />
				<Slider className='col-span-full' disableThumbScale maxValue={65536} minValue={0} onChange={handleShadowHighlightChange} step={8} value={[shadow, highlight]} />
				<NumberInput className='col-span-9' formatOptions={INTEGER_NUMBER_FORMAT} label='Midtone' maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('midtone', value)} size='sm' value={midtone} />
				<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Bits' maxValue={20} minValue={8} onValueChange={(value) => stretch.update('bits', value)} size='sm' value={bits} />
				<Slider className='col-span-full' disableThumbScale maxValue={65536} minValue={0} onChange={(value) => stretch.update('midtone', value as number)} step={8} value={midtone} />
				<p className='col-span-full'>AUTO STRETCH</p>
				<Checkbox className='col-span-6' isSelected={sigmaClip} onValueChange={(value) => stretch.update('sigmaClip', value)}>
					Sigma Clip
				</Checkbox>
				<NumberInput className='col-span-3' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!sigmaClip} label='Lower' maxValue={10} minValue={0.1} onValueChange={(value) => stretch.update('sigmaLower', value)} size='sm' step={0.1} value={sigmaLower} />
				<NumberInput className='col-span-3' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!sigmaClip} label='Upper' maxValue={10} minValue={0.1} onValueChange={(value) => stretch.update('sigmaUpper', value)} size='sm' step={0.1} value={sigmaUpper} />
				<SigmaClipCenterMethodSelect className='col-span-6' isDisabled={!sigmaClip} onValueChange={(value) => stretch.update('centerMethod', value)} value={centerMethod} />
				<SigmaClipDispersionMethodSelect className='col-span-6' isDisabled={!sigmaClip} onValueChange={(value) => stretch.update('dispersionMethod', value)} value={dispersionMethod} />
				<NumberInput className='col-span-6' formatOptions={DECIMAL_NUMBER_FORMAT} label='Mean background' maxValue={1} minValue={0} onValueChange={(value) => stretch.update('meanBackground', value)} size='sm' step={0.01} value={meanBackground} />
				<NumberInput className='col-span-6' formatOptions={DECIMAL_NUMBER_FORMAT} label='Clipping point' maxValue={10} minValue={-10} onValueChange={(value) => stretch.update('clippingPoint', value)} size='sm' step={0.01} value={clippingPoint} />
			</div>
		</Modal>
	)
})
