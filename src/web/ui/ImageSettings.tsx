import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageSettingsMolecule } from '@/molecules/image/settings'
import { CfaPatternSelect } from './CfaPatternSelect'
import { ChrominanceSubsamplingSelect } from './ChrominanceSubsamplingSelect'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { ImageFormatSelect } from './ImageFormatSelect'
import { Modal } from './Modal'

export const ImageSettings = memo(() => {
	const settings = useMolecule(ImageSettingsMolecule)

	return (
		<Modal footer={<Footer />} header="Settings" id={`settings-${settings.viewer.storageKey}`} maxWidth="256px" onHide={settings.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const settings = useMolecule(ImageSettingsMolecule)
	const { pixelated, transformation } = useSnapshot(settings.state)

	return (
		<div className="mt-0 grid grid-cols-12 items-center gap-2">
			<ImageFormatSelect className="col-span-full" onValueChange={settings.updateFormatType} value={transformation.format.type} />
			<Activity mode={transformation.format.type === 'jpeg' ? 'visible' : 'hidden'}>
				<JpegFormat />
			</Activity>
			<Checkbox className="col-span-full" label="Pixelated" onValueChange={(value) => settings.update('pixelated', value)} value={pixelated} />
			<CfaPatternSelect className="col-span-full" onValueChange={(value) => settings.updateTransformation('cfaPattern', value)} value={transformation.cfaPattern} />
		</div>
	)
})

const Footer = memo(() => {
	const settings = useMolecule(ImageSettingsMolecule)

	return (
		<>
			<Button color="danger" label="Reset" onPointerUp={settings.reset} startContent={<Icons.Restore />} />
			<Button color="success" label="Apply" onPointerUp={settings.apply} startContent={<Icons.Check />} />
		</>
	)
})

const JpegFormat = memo(() => {
	const settings = useMolecule(ImageSettingsMolecule)
	const { quality, chrominanceSubsampling } = useSnapshot(settings.state.transformation.format.jpeg)

	return (
		<div className="col-span-full grid grid-cols-subgrid gap-2">
			<NumberInput className="col-span-5" label="Quality" maxValue={100} minValue={0} onValueChange={(value) => settings.updateFormat('jpeg', 'quality', value)} value={quality} />
			<ChrominanceSubsamplingSelect className="col-span-7" onValueChange={(value) => settings.updateFormat('jpeg', 'chrominanceSubsampling', value)} value={chrominanceSubsampling} />
		</div>
	)
})
