import { ImageViewerStoreContext } from '@shared/context'
import { tw } from '@shared/util'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { NumberInput } from '@ui/components/NumberInput'
import type { NumberInputProps } from '@ui/components/NumberInput'
import { Icons } from '@ui/Icon'
import { ImageChannelOrGrayInput } from '@ui/ImageChannelOrGrayInput'
import { memo, useContext, useEffect } from 'react'
import type { ImageAdjustment as Adjustment } from 'src/types/image.adjustment'
import { useSnapshot } from 'valtio'

export const ImageAdjustment = memo(() => {
	const { adjustment } = useContext(ImageViewerStoreContext)

	useEffect(adjustment.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Enabled />
			<Brightness />
			<Contrast />
			<Gamma />
			<Saturation />
			<Footer />
		</div>
	)
})

const Enabled = memo(() => {
	const { adjustment } = useContext(ImageViewerStoreContext)
	const { enabled } = useSnapshot(adjustment.state.adjustment)

	return <Checkbox className="col-span-full" label="Enabled" onValueChange={(value) => (adjustment.state.adjustment.enabled = value)} value={enabled} />
})

const Brightness = memo(() => {
	const { adjustment } = useContext(ImageViewerStoreContext)
	const { enabled, brightness } = useSnapshot(adjustment.state.adjustment)

	return <AdjustmentValueInput disabled={!enabled} label="Brightness" onValueChange={adjustment.setBrightness} value={brightness.value} />
})

const Contrast = memo(() => {
	const { adjustment } = useContext(ImageViewerStoreContext)
	const { enabled, contrast } = useSnapshot(adjustment.state.adjustment)

	return <AdjustmentValueInput disabled={!enabled} label="Contrast" onValueChange={adjustment.setContrast} value={contrast.value} />
})

const Gamma = memo(() => {
	const { adjustment } = useContext(ImageViewerStoreContext)
	const { enabled, gamma } = useSnapshot(adjustment.state.adjustment)

	return <AdjustmentValueInput disabled={!enabled} label="Gamma" minValue={1} onValueChange={adjustment.setGamma} value={gamma.value} />
})

const Saturation = memo(() => {
	const { adjustment } = useContext(ImageViewerStoreContext)
	const { info } = useSnapshot(adjustment.viewer.state)
	const { enabled, saturation } = useSnapshot(adjustment.state.adjustment)

	if (!info?.mono) return null

	return (
		<div className="col-span-full flex flex-col gap-2">
			<AdjustmentValueInput disabled={!enabled} label="Saturation" onValueChange={adjustment.setSaturationLevel} value={saturation.value} />
			<ImageChannelOrGrayInput disabled={!enabled || saturation.value === 1} onValueChange={adjustment.setSaturationChannel} value={saturation.channel} />
		</div>
	)
})

const Footer = memo(() => {
	const { adjustment } = useContext(ImageViewerStoreContext)
	const snapshot = useSnapshot(adjustment.state.adjustment)
	const { enabled } = snapshot
	const canApply = !enabled || isValidAdjustment(snapshot)

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Button color="danger" disabled={!enabled} label="Reset" onClick={adjustment.reset} startContent={<Icons.Restore />} />
			<Button color="success" disabled={!canApply} label="Adjust" onClick={adjustment.apply} startContent={<Icons.Check />} />
		</div>
	)
})

function AdjustmentValueInput({ minValue = 0, className, ...props }: NumberInputProps) {
	return <NumberInput className={tw('col-span-full min-w-0', className)} fractionDigits={2} minValue={minValue} maxValue={10} step={0.01} {...props} />
}

function isValidAdjustment(adjustment: Adjustment) {
	return isValidAdjustmentValue(adjustment.brightness.value) && isValidAdjustmentValue(adjustment.contrast.value) && isValidAdjustmentValue(adjustment.saturation.value) && isValidAdjustmentValue(adjustment.gamma.value, 1)
}

function isValidAdjustmentValue(value: number, minValue = 0) {
	return Number.isFinite(value) && value >= minValue
}
