import { ImageViewerStoreContext } from '@shared/context'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { NumberInput, type NumberInputProps } from '@ui/components/NumberInput'
import { Tab, TabPanel, Tabs } from '@ui/components/Tabs'
import { Icons } from '@ui/Icon'
import { ImageFFTFilterTypeRadioGroup } from '@ui/ImageFFTFilterTypeRadioGroup'
import { ImageKernelFilterTypeRadioGroup } from '@ui/ImageKernelFilterTypeRadioGroup'
import { memo, useContext, useEffect } from 'react'
import type { ImageFFT, ImageFilter as ImageKernelFilter } from 'src/shared/types'
import { useSnapshot } from 'valtio'

export const ImageFilter = memo(() => {
	const { filter } = useContext(ImageViewerStoreContext)

	useEffect(filter.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Tabs className="col-span-full">
				<Tab id="kernel">Kernel</Tab>
				<Tab id="fft">FFT</Tab>

				<TabPanel id="kernel">
					<Kernel />
				</TabPanel>
				<TabPanel id="fft">
					<FFT />
				</TabPanel>
			</Tabs>
			<Footer />
		</div>
	)
})

const Kernel = memo(() => {
	const { filter } = useContext(ImageViewerStoreContext)
	const { enabled, type } = useSnapshot(filter.state.kernel)

	return (
		<div className="grid grid-cols-12 gap-2">
			<Checkbox className="col-span-full" label="Enabled" onValueChange={(value) => (filter.state.kernel.enabled = value)} value={enabled} />
			<ImageKernelFilterTypeRadioGroup className="col-span-full" disabled={!enabled} onValueChange={filter.updateKernelType} value={type} />
			<Mean />
			<Blur />
			<GaussianBlur />
		</div>
	)
})

const Mean = memo(() => {
	const { filter } = useContext(ImageViewerStoreContext)
	const { enabled, type, mean } = useSnapshot(filter.state.kernel)

	if (type !== 'mean') return null

	return <KernelSizeInput disabled={!enabled} value={mean.size} onValueChange={(value) => filter.updateKernel('mean', 'size', value)} />
})

const Blur = memo(() => {
	const { filter } = useContext(ImageViewerStoreContext)
	const { enabled, type, blur } = useSnapshot(filter.state.kernel)

	if (type !== 'blur') return null

	return <KernelSizeInput disabled={!enabled} value={blur.size} onValueChange={(value) => filter.updateKernel('blur', 'size', value)} />
})

const GaussianBlur = memo(() => {
	const { filter } = useContext(ImageViewerStoreContext)
	const { enabled, type, gaussianBlur } = useSnapshot(filter.state.kernel)

	if (type !== 'gaussianBlur') return null

	return (
		<div className="col-span-full grid grid-cols-12 gap-2">
			<NumberInput className="col-span-6 min-w-0" disabled={!enabled} label="Size" maxValue={MAX_KERNEL_SIZE} minValue={MIN_KERNEL_SIZE} onValueChange={(value) => filter.updateKernel('gaussianBlur', 'size', value)} step={2} value={gaussianBlur.size} />
			<NumberInput className="col-span-6 min-w-0" disabled={!enabled} fractionDigits={2} label="Sigma" maxValue={3} minValue={1} onValueChange={(value) => filter.updateKernel('gaussianBlur', 'sigma', value)} step={0.01} value={gaussianBlur.sigma} />
		</div>
	)
})

const FFT = memo(() => {
	const { filter } = useContext(ImageViewerStoreContext)
	const { enabled, type, cutoff, weight } = useSnapshot(filter.state.fft)

	return (
		<div className="grid grid-cols-12 gap-2">
			<Checkbox className="col-span-full" label="Enabled" onValueChange={(value) => (filter.state.fft.enabled = value)} value={enabled} />
			<ImageFFTFilterTypeRadioGroup className="col-span-full" disabled={!enabled} onValueChange={filter.setFFTType} value={type} />
			<NumberInput className="col-span-6 min-w-0" disabled={!enabled} fractionDigits={3} label="Cutoff" maxValue={1} minValue={0} onValueChange={filter.setFFTCutoff} step={0.001} value={cutoff} />
			<NumberInput className="col-span-6 min-w-0" disabled={!enabled} fractionDigits={3} label="Weight" maxValue={1} minValue={0} onValueChange={filter.setFFTWeight} step={0.001} value={weight} />
		</div>
	)
})

const Footer = memo(() => {
	const { filter } = useContext(ImageViewerStoreContext)
	const kernel = useSnapshot(filter.state.kernel)
	const fft = useSnapshot(filter.state.fft)
	const canApply = isValidKernelFilter(kernel) && isValidFFTFilter(fft)

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Button color="danger" label="Reset" onClick={filter.reset} startContent={<Icons.Restore />} />
			<Button color="success" disabled={!canApply} label="Apply" onClick={filter.apply} startContent={<Icons.Check />} />
		</div>
	)
})

const MIN_KERNEL_SIZE = 3
const MAX_KERNEL_SIZE = 15

function KernelSizeInput(props: NumberInputProps) {
	return <NumberInput className="col-span-full min-w-0" label="Size" maxValue={MAX_KERNEL_SIZE} minValue={MIN_KERNEL_SIZE} step={2} {...props} />
}

function isValidKernelFilter(filter: ImageKernelFilter) {
	if (!filter.enabled) return true

	switch (filter.type) {
		case 'sharpen':
			return true
		case 'mean':
			return isValidKernelSize(filter.mean.size)
		case 'blur':
			return isValidKernelSize(filter.blur.size)
		case 'gaussianBlur':
			return isValidKernelSize(filter.gaussianBlur.size) && isInRange(filter.gaussianBlur.sigma, 1, 3)
	}
}

function isValidFFTFilter(fft: ImageFFT) {
	return !fft.enabled || (isInRange(fft.cutoff, 0, 1) && isInRange(fft.weight, 0, 1))
}

function isValidKernelSize(value: number) {
	return Number.isInteger(value) && value >= MIN_KERNEL_SIZE && value <= MAX_KERNEL_SIZE && value % 2 === 1
}

function isInRange(value: number, min: number, max: number) {
	return Number.isFinite(value) && value >= min && value <= max
}
