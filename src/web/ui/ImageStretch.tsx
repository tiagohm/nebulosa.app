import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageStretchMolecule } from '@/molecules/image/stretch'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Slider } from './components/Slider'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { SigmaClipCenterMethodSelect } from './SigmaClipCenterMethodSelect'
import { SigmaClipDispersionMethodSelect } from './SigmaClipDispersionMethodSelect'

export const ImageStretch = memo(() => {
	const stretch = useMolecule(ImageStretchMolecule)

	return (
		<Modal footer={<Footer />} header="Stretch" id={`stretch-${stretch.viewer.storageKey}`} maxWidth="296px" onHide={stretch.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	return (
		<div className="mt-0 grid grid-cols-12 gap-2">
			<Stretch />
			<AutoStretch />
		</div>
	)
})

const Stretch = memo(() => {
	const stretch = useMolecule(ImageStretchMolecule)
	const { shadow, midtone, highlight, bits } = useSnapshot(stretch.state.stretch)

	function handleShadowHighlightChange(value?: number | number[]) {
		if (Array.isArray(value)) {
			stretch.state.stretch.shadow = value[0]
			stretch.state.stretch.highlight = value[1]
		}
	}

	return (
		<>
			<NumberInput className="col-span-6" label="Shadow" maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('shadow', value)} value={shadow} />
			<NumberInput className="col-span-6" label="Highlight" maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('highlight', value)} value={highlight} />
			<Slider className="col-span-full" maxValue={65536} minValue={0} onValueChange={handleShadowHighlightChange} step={8} value={[shadow, highlight]} />
			<NumberInput className="col-span-9" label="Midtone" maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('midtone', value)} value={midtone} />
			<NumberInput className="col-span-3" label="Bits" maxValue={20} minValue={8} onValueChange={(value) => stretch.update('bits', value)} value={bits} />
			<Slider className="col-span-full" maxValue={65536} minValue={0} onValueChange={(value) => stretch.update('midtone', value)} step={8} value={midtone} />
		</>
	)
})

const AutoStretch = memo(() => {
	const stretch = useMolecule(ImageStretchMolecule)
	const { meanBackground, clippingPoint } = useSnapshot(stretch.state.stretch)

	return (
		<>
			<p className="col-span-full">AUTO STRETCH</p>
			<SigmaClip />
			<NumberInput className="col-span-6" fractionDigits={2} label="Mean background" maxValue={1} minValue={0} onValueChange={(value) => stretch.update('meanBackground', value)} step={0.01} value={meanBackground} />
			<NumberInput className="col-span-6" fractionDigits={2} label="Clipping point" maxValue={10} minValue={-10} onValueChange={(value) => stretch.update('clippingPoint', value)} step={0.01} value={clippingPoint} />
		</>
	)
})

const SigmaClip = memo(() => {
	const stretch = useMolecule(ImageStretchMolecule)
	const { sigmaClip, centerMethod, dispersionMethod, sigmaLower, sigmaUpper } = useSnapshot(stretch.state.stretch)

	return (
		<>
			<Checkbox className="col-span-6" label="Sigma Clip" onValueChange={(value) => stretch.update('sigmaClip', value)} value={sigmaClip} />
			<NumberInput className="col-span-3" disabled={!sigmaClip} fractionDigits={1} label="Lower" maxValue={10} minValue={0.1} onValueChange={(value) => stretch.update('sigmaLower', value)} step={0.1} value={sigmaLower} />
			<NumberInput className="col-span-3" disabled={!sigmaClip} fractionDigits={1} label="Upper" maxValue={10} minValue={0.1} onValueChange={(value) => stretch.update('sigmaUpper', value)} step={0.1} value={sigmaUpper} />
			<SigmaClipCenterMethodSelect className="col-span-6" disabled={!sigmaClip} onValueChange={(value) => stretch.update('centerMethod', value)} value={centerMethod} />
			<SigmaClipDispersionMethodSelect className="col-span-6" disabled={!sigmaClip} onValueChange={(value) => stretch.update('dispersionMethod', value)} value={dispersionMethod} />
		</>
	)
})

const Footer = memo(() => {
	const stretch = useMolecule(ImageStretchMolecule)
	const { auto } = useSnapshot(stretch.state.stretch)

	return (
		<>
			<Button color="primary" label="Auto" onPointerUp={stretch.auto} startContent={<Icons.WandSparkles />} variant={auto ? 'solid' : 'flat'} />
			<Button color="danger" label="Reset" onPointerUp={stretch.reset} startContent={<Icons.Restore />} />
			<Button color="success" label="Stretch" onPointerUp={stretch.apply} startContent={<Icons.Check />} />
		</>
	)
})
