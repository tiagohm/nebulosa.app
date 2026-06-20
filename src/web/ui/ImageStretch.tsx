import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Slider } from './components/Slider'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { SigmaClipCenterMethodSelect } from './SigmaClipCenterMethodSelect'
import { SigmaClipDispersionMethodSelect } from './SigmaClipDispersionMethodSelect'

const STRETCH_MIN_VALUE = 0
const STRETCH_MAX_VALUE = 65536

export const ImageStretch = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { stretch } = viewer
	const { show } = useSnapshot(stretch.state)

	if (!show) return null

	return (
		<Modal footer={<Footer />} header="Stretch" id={`stretch-${viewer.image.id}`} initialWidth="296px" onHide={stretch.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<Stretch />
		<AutoStretch />
	</div>
))

const Stretch = memo(() => {
	const { stretch } = useContext(ImageViewerStoreContext)
	const { shadow, midtone, highlight, bits } = useSnapshot(stretch.state.stretch)

	return (
		<>
			<NumberInput className="col-span-6 min-w-0" label="Shadow" maxValue={STRETCH_MAX_VALUE} minValue={STRETCH_MIN_VALUE} onValueChange={stretch.handleShadowChange} value={shadow} />
			<NumberInput className="col-span-6 min-w-0" label="Highlight" maxValue={STRETCH_MAX_VALUE} minValue={STRETCH_MIN_VALUE} onValueChange={stretch.handleHighlightChange} value={highlight} />
			<Slider className="col-span-full min-w-0" fullWidth maxValue={STRETCH_MAX_VALUE} minValue={STRETCH_MIN_VALUE} onValueChange={stretch.handleShadowHighlightChange} step={8} value={[shadow, highlight]} />
			<NumberInput className="col-span-9 min-w-0" label="Midtone" maxValue={STRETCH_MAX_VALUE} minValue={STRETCH_MIN_VALUE} onValueChange={(value) => stretch.update('midtone', value)} value={midtone} />
			<NumberInput className="col-span-3 min-w-0" label="Bits" maxValue={20} minValue={8} onValueChange={(value) => stretch.update('bits', value)} value={bits} />
			<Slider className="col-span-full min-w-0" fullWidth maxValue={STRETCH_MAX_VALUE} minValue={STRETCH_MIN_VALUE} onValueChange={(value) => stretch.update('midtone', value)} step={8} value={midtone} />
		</>
	)
})

const AutoStretch = memo(() => {
	const { stretch } = useContext(ImageViewerStoreContext)
	const { meanBackground, clippingPoint } = useSnapshot(stretch.state.stretch)

	return (
		<>
			<p className="col-span-full text-sm font-bold">AUTO STRETCH</p>
			<SigmaClip />
			<NumberInput className="col-span-6 min-w-0" fractionDigits={2} label="Mean background" maxValue={1} minValue={0} onValueChange={(value) => stretch.update('meanBackground', value)} step={0.01} value={meanBackground} />
			<NumberInput className="col-span-6 min-w-0" fractionDigits={2} label="Clipping point" maxValue={10} minValue={-10} onValueChange={(value) => stretch.update('clippingPoint', value)} step={0.01} value={clippingPoint} />
		</>
	)
})

const SigmaClip = memo(() => {
	const { stretch } = useContext(ImageViewerStoreContext)
	const { sigmaClip, centerMethod, dispersionMethod, sigmaLower, sigmaUpper } = useSnapshot(stretch.state.stretch)

	return (
		<>
			<Checkbox className="col-span-6 min-w-0" label="Sigma Clip" onValueChange={(value) => stretch.update('sigmaClip', value)} value={sigmaClip} />
			<NumberInput className="col-span-3 min-w-0" disabled={!sigmaClip} fractionDigits={1} label="Lower" maxValue={10} minValue={0.1} onValueChange={(value) => stretch.update('sigmaLower', value)} step={0.1} value={sigmaLower} />
			<NumberInput className="col-span-3 min-w-0" disabled={!sigmaClip} fractionDigits={1} label="Upper" maxValue={10} minValue={0.1} onValueChange={(value) => stretch.update('sigmaUpper', value)} step={0.1} value={sigmaUpper} />
			<SigmaClipCenterMethodSelect className="col-span-6 min-w-0" disabled={!sigmaClip} onValueChange={(value) => stretch.update('centerMethod', value)} value={centerMethod} />
			<SigmaClipDispersionMethodSelect className="col-span-6 min-w-0" disabled={!sigmaClip} onValueChange={(value) => stretch.update('dispersionMethod', value)} value={dispersionMethod} />
		</>
	)
})

const Footer = memo(() => {
	const { stretch } = useContext(ImageViewerStoreContext)
	const { auto } = useSnapshot(stretch.state.stretch)

	return (
		<>
			<Button color="primary" label="Auto" onClick={stretch.auto} startContent={<Icons.WandSparkles />} variant={auto ? 'solid' : 'flat'} />
			<Button color="danger" label="Reset" onClick={stretch.reset} startContent={<Icons.Restore />} />
			<Button color="success" label="Stretch" onClick={stretch.apply} startContent={<Icons.Check />} />
		</>
	)
})
