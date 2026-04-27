import { useMolecule } from 'bunshi/react'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FramingMolecule } from '@/molecules/framing'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { Chip } from './components/Chip'
import { NumberInput } from './components/NumberInput'
import { TextInput } from './components/TextInput'
import { HipsSurveySelect } from './HipsSurveySelect'
import { Icons } from './Icon'
import { Link } from './Link'
import { Modal } from './Modal'

export const Framing = memo(() => {
	const framing = useMolecule(FramingMolecule)

	return (
		<Modal footer={<Footer />} header="Framing" id="framing" maxWidth="296px" onHide={framing.hide}>
			<Body />
			<Link className="col-span-full mt-2" href="https://alasky.cds.unistra.fr/hips-image-services/hips2fits" label="Powered by hips2fits, a service provided by CDS" />
		</Modal>
	)
})

const Body = memo(() => {
	const framing = useMolecule(FramingMolecule)
	const { loading, openNewImage } = useSnapshot(framing.state)
	const { width, height, rotation, focalLength, pixelSize, hipsSurvey } = useSnapshot(framing.state.request)
	const { rightAscension, declination } = useSnapshot(framing.state.request, { sync: true })

	return (
		<div className="mt-0 grid grid-cols-12 gap-2">
			<TextInput className="col-span-6" disabled={loading} label="RA (J2000)" onValueChange={(value) => framing.update('rightAscension', value)} value={rightAscension} />
			<TextInput className="col-span-6" disabled={loading} label="DEC (J2000)" onValueChange={(value) => framing.update('declination', value)} value={declination} />
			<NumberInput className="col-span-4" disabled={loading} label="Width" maxValue={8192} minValue={100} onValueChange={(value) => framing.update('width', value)} value={width} />
			<NumberInput className="col-span-4" disabled={loading} label="Height" maxValue={8192} minValue={100} onValueChange={(value) => framing.update('height', value)} value={height} />
			<NumberInput className="col-span-4" disabled={loading} fractionDigits={2} label="Rotation (°)" maxValue={360} minValue={-360} onValueChange={(value) => framing.update('rotation', value)} step={0.1} value={rotation} />
			<NumberInput className="col-span-6" disabled={loading} label="Focal Length (mm)" maxValue={100000} minValue={0} onValueChange={(value) => framing.update('focalLength', value)} value={focalLength} />
			<NumberInput className="col-span-6" disabled={loading} fractionDigits={1} label="Pixel size (µm)" maxValue={1000} minValue={0} onValueChange={(value) => framing.update('pixelSize', value)} step={0.01} value={pixelSize} />
			<HipsSurveySelect className="col-span-full" disabled={loading} onValueChange={(value) => framing.update('hipsSurvey', value)} value={hipsSurvey} />
			<Checkbox className="col-span-full" disabled={loading} label="Open in new image" onValueChange={(value) => (framing.state.openNewImage = value)} value={openNewImage} />
		</div>
	)
})

const Footer = memo(() => {
	const framing = useMolecule(FramingMolecule)
	const { loading } = useSnapshot(framing.state)
	const { width, height, focalLength, pixelSize } = useSnapshot(framing.state.request)
	const size = angularSizeOfPixel(focalLength, pixelSize)

	return (
		<>
			<div className="flex flex-1 items-center">
				<Chip color="primary" label={`${((size * width) / 3600).toFixed(2)}° x ${((size * height) / 3600).toFixed(2)}°`} />
			</div>
			<Button color="success" label="Load" loading={loading} onPointerUp={framing.load} startContent={<Icons.Download />} />
		</>
	)
})
