import { ImageViewerStoreContext } from '@shared/context'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { NumberInput } from '@ui/components/NumberInput'
import { Slider } from '@ui/components/Slider'
import { Icons } from '@ui/Icon'
import { SigmaClipCenterMethodSelect } from '@ui/SigmaClipCenterMethodSelect'
import { SigmaClipDispersionMethodSelect } from '@ui/SigmaClipDispersionMethodSelect'
import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'

const STRETCH_MIN_VALUE = 0
const STRETCH_MAX_VALUE = 65536

export const ImageStretch = memo(() => {
	const { stretch } = useContext(ImageViewerStoreContext)

	useEffect(stretch.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Stretch />
			<AutoStretch />
			<Footer />
		</div>
	)
})

const Stretch = memo(() => {
	const { stretch } = useContext(ImageViewerStoreContext)
	const { shadow, midtone, highlight, bits } = useSnapshot(stretch.state.stretch)

	return (
		<>
			<NumberInput className="col-span-6 min-w-0" label="Shadow" maxValue={STRETCH_MAX_VALUE} minValue={STRETCH_MIN_VALUE} onValueChange={stretch.handleShadowChange} value={shadow} />
			<NumberInput className="col-span-6 min-w-0" label="Highlight" maxValue={STRETCH_MAX_VALUE} minValue={STRETCH_MIN_VALUE} onValueChange={stretch.handleHighlightChange} value={highlight} />
			<Slider className="col-span-full min-w-0" fullWidth maxValue={STRETCH_MAX_VALUE} minValue={STRETCH_MIN_VALUE} onValueChange={stretch.handleShadowHighlightChange} step={8} value={[shadow, highlight]} />
			<NumberInput className="col-span-9 min-w-0" label="Midtone" maxValue={STRETCH_MAX_VALUE} minValue={STRETCH_MIN_VALUE} onValueChange={stretch.setMidtone} value={midtone} />
			<NumberInput className="col-span-3 min-w-0" label="Bits" maxValue={20} minValue={8} onValueChange={stretch.setBits} value={bits} />
			<Slider className="col-span-full min-w-0" fullWidth maxValue={STRETCH_MAX_VALUE} minValue={STRETCH_MIN_VALUE} onValueChange={stretch.setMidtone} step={8} value={midtone} />
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
			<NumberInput className="col-span-6 min-w-0" fractionDigits={2} label="Mean background" maxValue={1} minValue={0} onValueChange={stretch.setMeanBackground} step={0.01} value={meanBackground} />
			<NumberInput className="col-span-6 min-w-0" fractionDigits={2} label="Clipping point" maxValue={10} minValue={-10} onValueChange={stretch.setClippingPoint} step={0.01} value={clippingPoint} />
		</>
	)
})

const SigmaClip = memo(() => {
	const { stretch } = useContext(ImageViewerStoreContext)
	const { sigmaClip, centerMethod, dispersionMethod, sigmaLower, sigmaUpper } = useSnapshot(stretch.state.stretch)

	return (
		<>
			<Checkbox className="col-span-6 min-w-0" label="Sigma Clip" onValueChange={stretch.setSigmaClip} value={sigmaClip} />
			<NumberInput className="col-span-3 min-w-0" disabled={!sigmaClip} fractionDigits={1} label="Lower" maxValue={10} minValue={0.1} onValueChange={stretch.setSigmaLower} step={0.1} value={sigmaLower} />
			<NumberInput className="col-span-3 min-w-0" disabled={!sigmaClip} fractionDigits={1} label="Upper" maxValue={10} minValue={0.1} onValueChange={stretch.setSigmaUpper} step={0.1} value={sigmaUpper} />
			<SigmaClipCenterMethodSelect className="col-span-6 min-w-0" disabled={!sigmaClip} onValueChange={stretch.setCenterMethod} value={centerMethod} />
			<SigmaClipDispersionMethodSelect className="col-span-6 min-w-0" disabled={!sigmaClip} onValueChange={stretch.setDispersionMethod} value={dispersionMethod} />
		</>
	)
})

const Footer = memo(() => {
	const { stretch } = useContext(ImageViewerStoreContext)
	const { auto } = useSnapshot(stretch.state.stretch)

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Button color="primary" label="Auto" onClick={stretch.auto} startContent={<Icons.WandSparkles />} variant={auto ? 'solid' : 'flat'} />
			<Button color="danger" label="Reset" onClick={stretch.reset} startContent={<Icons.Restore />} />
			<Button color="success" label="Stretch" onClick={stretch.apply} startContent={<Icons.Check />} />
		</div>
	)
})
