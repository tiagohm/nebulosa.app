import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageAnnotationMolecule } from '@/molecules/image/annotation'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { Modal } from './Modal'

export const ImageAnnotation = memo(() => {
	const annotation = useMolecule(ImageAnnotationMolecule)

	return (
		<Modal footer={<Footer />} header="Annotation" id={`annotation-${annotation.viewer.storageKey}`} maxWidth="376px" onHide={annotation.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	return (
		<div className="mt-0 grid grid-cols-12 gap-2">
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
			<Checkbox className="col-span-6" label="Stars" onValueChange={(value) => annotation.update('stars', value)} value={stars} />
			<Checkbox className="col-span-6" label="DSOs" onValueChange={(value) => annotation.update('dsos', value)} value={dsos} />
			<div className="col-span-full flex flex-row items-center gap-2">
				<Checkbox disabled={!stars && !dsos} label="SIMBAD Astronomical Database" onValueChange={(value) => annotation.update('useSimbad', value)} value={useSimbad} />
				<SimbadLink />
			</div>
		</>
	)
})

const openSimbad = () => window.open('https://simbad.cds.unistra.fr/simbad/', '_blank', 'noopener')

const SimbadLink = memo(() => {
	return <IconButton icon={Icons.Link} isRounded onPointerUp={openSimbad} variant="ghost" />
})

const MinorPlanets = memo(() => {
	const annotation = useMolecule(ImageAnnotationMolecule)
	const { minorPlanets, minorPlanetsMagnitudeLimit, includeMinorPlanetsWithoutMagnitude } = useSnapshot(annotation.state.request)

	return (
		<>
			<Checkbox className="col-span-full" label="Minor Planets" onValueChange={(value) => annotation.update('minorPlanets', value)} value={minorPlanets} />
			<NumberInput className="col-span-5" disabled={!minorPlanets} label="Magnitude Limit" maxValue={30} minValue={1} onValueChange={(value) => annotation.update('minorPlanetsMagnitudeLimit', value)} value={minorPlanetsMagnitudeLimit} />
			<Checkbox className="col-span-7" disabled={!minorPlanets || minorPlanetsMagnitudeLimit >= 30} label="Include without magnitude" onValueChange={(value) => annotation.update('includeMinorPlanetsWithoutMagnitude', value)} value={includeMinorPlanetsWithoutMagnitude} />
		</>
	)
})

const Footer = memo(() => {
	const annotation = useMolecule(ImageAnnotationMolecule)
	const { loading } = useSnapshot(annotation.state)

	return <Button color="success" label="Annotate" loading={loading} onPointerUp={annotation.annotate} startContent={<Icons.Check />} />
})
