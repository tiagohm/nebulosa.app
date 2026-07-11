import { memo, useContext, useEffect } from 'react'
import type { ImageAdjustment as ImageAdjustmentType } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { ImageChannelOrGrayInput } from './ImageChannelOrGrayInput'

export const ImageAdjustment = memo(() => {
	const { adjustment } = useContext(ImageViewerStoreContext)

	useEffect(adjustment.mount, [])

	return (
		<div className="grid grid-cols-12 gap-2 p-3">
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

	return <AdjustmentValueInput enabled={enabled} label="Brightness" type="brightness" value={brightness.value} />
})

const Contrast = memo(() => {
	const { adjustment } = useContext(ImageViewerStoreContext)
	const { enabled, contrast } = useSnapshot(adjustment.state.adjustment)

	return <AdjustmentValueInput enabled={enabled} label="Contrast" type="contrast" value={contrast.value} />
})

const Gamma = memo(() => {
	const { adjustment } = useContext(ImageViewerStoreContext)
	const { enabled, gamma } = useSnapshot(adjustment.state.adjustment)

	return <AdjustmentValueInput enabled={enabled} label="Gamma" minValue={1} type="gamma" value={gamma.value} />
})

const Saturation = memo(() => {
	const { adjustment } = useContext(ImageViewerStoreContext)
	const { info } = useSnapshot(adjustment.viewer.state)
	const { enabled, saturation } = useSnapshot(adjustment.state.adjustment)

	if (!info?.mono) return null

	return (
		<div className="col-span-full flex flex-col gap-2">
			<AdjustmentValueInput enabled={enabled} label="Saturation" type="saturation" value={saturation.value} />
			<ImageChannelOrGrayInput disabled={!enabled || saturation.value === 1} onValueChange={(value) => adjustment.update('saturation', 'channel', value)} value={saturation.channel} />
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

type AdjustmentValueType = 'brightness' | 'contrast' | 'gamma' | 'saturation'

interface AdjustmentValueInputProps {
	readonly enabled: boolean
	readonly label: string
	readonly minValue?: number
	readonly type: AdjustmentValueType
	readonly value: number
}

const AdjustmentValueInput = memo(({ enabled, label, minValue = 0, type, value }: AdjustmentValueInputProps) => {
	const { adjustment } = useContext(ImageViewerStoreContext)

	return <NumberInput className="col-span-full min-w-0" disabled={!enabled} fractionDigits={2} label={label} maxValue={10} minValue={minValue} onValueChange={(value) => adjustment.update(type, 'value', value)} step={0.01} value={value} />
})

function isValidAdjustment(adjustment: ImageAdjustmentType) {
	return isValidAdjustmentValue(adjustment.brightness.value) && isValidAdjustmentValue(adjustment.contrast.value) && isValidAdjustmentValue(adjustment.saturation.value) && isValidAdjustmentValue(adjustment.gamma.value, 1)
}

function isValidAdjustmentValue(value: number, minValue = 0) {
	return Number.isFinite(value) && value >= minValue
}
