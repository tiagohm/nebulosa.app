import { framingStore } from '@stores/framing.store'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { Chip } from '@ui/components/Chip'
import { NumberInput } from '@ui/components/NumberInput'
import { TextInput } from '@ui/components/TextInput'
import { HipsSurveySelect } from '@ui/HipsSurveySelect'
import { Icons } from '@ui/Icon'
import type { IDockviewPanelProps } from 'dockview-react'
import { pixelScale } from 'nebulosa/src/astronomy/formulas'
import { memo, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const Framing = memo(({ params }: IDockviewPanelProps) => {
	useEffect(framingStore.mount, [])

	const { loading, openNewImage } = useSnapshot(framingStore.state)
	const { width, height, rotation, focalLength, pixelSize, hipsSurvey } = useSnapshot(framingStore.state.request)
	const { rightAscension, declination } = useSnapshot(framingStore.state.request)

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<TextInput className="col-span-6 min-w-0" disabled={loading} label="RA (J2000)" onValueChange={(value) => framingStore.update('rightAscension', value)} value={rightAscension} />
			<TextInput className="col-span-6 min-w-0" disabled={loading} label="DEC (J2000)" onValueChange={(value) => framingStore.update('declination', value)} value={declination} />
			<NumberInput className="col-span-4 min-w-0" disabled={loading} label="Width" maxValue={8192} minValue={100} onValueChange={(value) => framingStore.update('width', value)} value={width} />
			<NumberInput className="col-span-4 min-w-0" disabled={loading} label="Height" maxValue={8192} minValue={100} onValueChange={(value) => framingStore.update('height', value)} value={height} />
			<NumberInput className="col-span-4 min-w-0" disabled={loading} fractionDigits={2} label="Rotation (°)" maxValue={360} minValue={-360} onValueChange={(value) => framingStore.update('rotation', value)} step={0.1} value={rotation} />
			<NumberInput className="col-span-6 min-w-0" disabled={loading} label="Focal Length (mm)" maxValue={100000} minValue={0} onValueChange={(value) => framingStore.update('focalLength', value)} value={focalLength} />
			<NumberInput className="col-span-6 min-w-0" disabled={loading} fractionDigits={1} label="Pixel size (µm)" maxValue={1000} minValue={0} onValueChange={(value) => framingStore.update('pixelSize', value)} step={0.01} value={pixelSize} />
			<HipsSurveySelect className="col-span-full" disabled={loading} onValueChange={(value) => framingStore.update('hipsSurvey', value)} value={hipsSurvey} />
			<Checkbox className="col-span-full" disabled={loading} label="Open in new image" onValueChange={(value) => (framingStore.state.openNewImage = value)} value={openNewImage} />
			<Footer />
		</div>
	)
})

const Footer = memo(() => {
	const { loading } = useSnapshot(framingStore.state)
	const { width, height, focalLength, pixelSize, fov } = useSnapshot(framingStore.state.request)
	const field = formatFieldOfView(width, height, focalLength, pixelSize, fov)
	const canLoad = isPositiveFinite(width) && isPositiveFinite(height) && field !== undefined

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<div className="flex min-w-0 flex-1 items-center">
				<Chip className="max-w-full" color={canLoad ? 'primary' : 'default'} label={field ?? 'Invalid FOV'} />
			</div>
			<Button color="success" disabled={!canLoad} label="Load" loading={loading} onClick={() => framingStore.load()} startContent={<Icons.Download />} />
		</div>
	)
})

function formatFieldOfView(width: number, height: number, focalLength: number, pixelSize: number, fallbackFov?: number) {
	if (!isPositiveFinite(width) || !isPositiveFinite(height)) return undefined

	if (isPositiveFinite(focalLength) && isPositiveFinite(pixelSize)) {
		const size = pixelScale(pixelSize, focalLength)
		const widthInDegrees = (size * width) / 3600
		const heightInDegrees = (size * height) / 3600

		if (isPositiveFinite(widthInDegrees) && isPositiveFinite(heightInDegrees)) {
			return `${widthInDegrees.toFixed(2)}° x ${heightInDegrees.toFixed(2)}°`
		}
	}

	if (fallbackFov !== undefined && isPositiveFinite(fallbackFov)) {
		return `${fallbackFov.toFixed(2)}°`
	}

	return undefined
}

function isPositiveFinite(value: number) {
	return Number.isFinite(value) && value > 0
}
