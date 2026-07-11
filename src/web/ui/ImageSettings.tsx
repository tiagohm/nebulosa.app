import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'
import { CfaPatternSelect } from './CfaPatternSelect'
import { ChrominanceSubsamplingSelect } from './ChrominanceSubsamplingSelect'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { ImageFormatSelect } from './ImageFormatSelect'

const JPEG_FORMAT = 'jpeg'

export const ImageSettings = memo(() => {
	const { settings } = useContext(ImageViewerStoreContext)
	const { pixelated, transformation } = useSnapshot(settings.state)

	useEffect(settings.mount, [])

	return (
		<div className="mt-0 grid grid-cols-12 items-center gap-2">
			<ImageFormatSelect className="col-span-full min-w-0" fullWidth onValueChange={settings.updateFormatType} value={transformation.format.type} />
			{transformation.format.type === JPEG_FORMAT && <JpegFormat />}
			<Checkbox className="col-span-full min-w-0" label="Pixelated" onValueChange={(value) => settings.update('pixelated', value)} value={pixelated} />
			<CfaPatternSelect className="col-span-full min-w-0" fullWidth onValueChange={(value) => settings.updateTransformation('cfaPattern', value)} value={transformation.cfaPattern} />
			<Footer />
		</div>
	)
})

const Footer = memo(() => {
	const { settings } = useContext(ImageViewerStoreContext)

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Button color="danger" label="Reset" onClick={settings.reset} startContent={<Icons.Restore />} />
			<Button color="success" label="Apply" onClick={settings.apply} startContent={<Icons.Check />} />
		</div>
	)
})

const JpegFormat = memo(() => {
	const { settings } = useContext(ImageViewerStoreContext)
	const { quality, chrominanceSubsampling } = useSnapshot(settings.state.transformation.format.jpeg)

	return (
		<div className="col-span-full grid grid-cols-subgrid gap-2">
			<NumberInput className="col-span-5 min-w-0" label="Quality" maxValue={100} minValue={0} onValueChange={(value) => settings.updateFormat(JPEG_FORMAT, 'quality', value)} value={quality} />
			<ChrominanceSubsamplingSelect className="col-span-7 min-w-0" fullWidth onValueChange={(value) => settings.updateFormat(JPEG_FORMAT, 'chrominanceSubsampling', value)} value={chrominanceSubsampling} />
		</div>
	)
})
