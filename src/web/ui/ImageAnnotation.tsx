import { Checkbox, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageAnnotationMolecule } from '@/molecules/image/annotation'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageAnnotation = memo(() => {
	const annotation = useMolecule(ImageAnnotationMolecule)

	return (
		<Modal footer={<Footer />} header='Annotation' id={`annotation-${annotation.viewer.storageKey}`} maxWidth='376px' onHide={annotation.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<StarsAndDsos />
			<MinorPlanets />
		</div>
	)
})

const StarsAndDsos = memo(() => {
	const annotation = useMolecule(ImageAnnotationMolecule)
	const { stars, dsos, useSimbad } = useSnapshot(annotation.state.request)

	return (
		<>
			<Checkbox className='col-span-6' isSelected={stars} onValueChange={(value) => annotation.update('stars', value)}>
				Stars
			</Checkbox>
			<Checkbox className='col-span-6' isSelected={dsos} onValueChange={(value) => annotation.update('dsos', value)}>
				DSOs
			</Checkbox>
			<div className='col-span-full flex flex-row items-center gap-2'>
				<Checkbox isDisabled={!stars && !dsos} isSelected={useSimbad} onValueChange={(value) => annotation.update('useSimbad', value)}>
					SIMBAD Astronomical Database
				</Checkbox>
				<SimbadLink />
			</div>
		</>
	)
})

const openSimbad = () => window.open('https://simbad.cds.unistra.fr/simbad/', '_blank', 'noopener')

const SimbadLink = memo(() => {
	return <IconButton icon={Icons.Link} isRounded onPointerUp={openSimbad} size='sm' variant='light' />
})

const MinorPlanets = memo(() => {
	const annotation = useMolecule(ImageAnnotationMolecule)
	const { minorPlanets, minorPlanetsMagnitudeLimit, includeMinorPlanetsWithoutMagnitude } = useSnapshot(annotation.state.request)

	return (
		<>
			<Checkbox className='col-span-full' isSelected={minorPlanets} onValueChange={(value) => annotation.update('minorPlanets', value)}>
				Minor Planets
			</Checkbox>
			<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!minorPlanets} label='Magnitude Limit' maxValue={30} minValue={1} onValueChange={(value) => annotation.update('minorPlanetsMagnitudeLimit', value)} size='sm' value={minorPlanetsMagnitudeLimit} />
			<Checkbox className='col-span-7' isDisabled={!minorPlanets || minorPlanetsMagnitudeLimit >= 30} isSelected={includeMinorPlanetsWithoutMagnitude} onValueChange={(value) => annotation.update('includeMinorPlanetsWithoutMagnitude', value)}>
				Include without magnitude
			</Checkbox>
		</>
	)
})

const Footer = memo(() => {
	const annotation = useMolecule(ImageAnnotationMolecule)
	const { loading } = useSnapshot(annotation.state)

	return <TextButton color='success' isLoading={loading} label='Annotate' onPointerUp={annotation.annotate} startContent={<Icons.Check />} />
})
