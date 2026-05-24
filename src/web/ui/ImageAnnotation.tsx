import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { IconButton } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { Modal } from './Modal'

export const ImageAnnotation = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { annotation } = viewer

	return (
		<Modal footer={<Footer />} header="Annotation" id={`annotation-${viewer.image.id}`} maxWidth="376px" onHide={annotation.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<StarsAndDsos />
		<MinorPlanets />
	</div>
))

const StarsAndDsos = memo(() => {
	const { annotation } = useContext(ImageViewerStoreContext)
	const { loading } = useSnapshot(annotation.state)
	const { stars, dsos, useSimbad } = useSnapshot(annotation.state.request)
	const canUseSimbad = !loading && (stars || dsos)

	return (
		<>
			<Checkbox className="col-span-6" disabled={loading} label="Stars" onValueChange={(value) => annotation.update('stars', value)} value={stars} />
			<Checkbox className="col-span-6" disabled={loading} label="DSOs" onValueChange={(value) => annotation.update('dsos', value)} value={dsos} />
			<div className="col-span-full flex min-w-0 flex-row items-center gap-2">
				<Checkbox disabled={!canUseSimbad} label="SIMBAD Astronomical Database" onValueChange={(value) => annotation.update('useSimbad', value)} value={canUseSimbad && useSimbad} />
				<SimbadLink />
			</div>
		</>
	)
})

const openSimbad = () => window.open('https://simbad.cds.unistra.fr/simbad/', '_blank', 'noopener')

const SimbadLink = memo(() => <IconButton icon={Icons.Link} onClick={openSimbad} tooltipContent="Open SIMBAD" variant="ghost" />)

const MinorPlanets = memo(() => {
	const { annotation } = useContext(ImageViewerStoreContext)
	const { loading } = useSnapshot(annotation.state)
	const { minorPlanets, minorPlanetsMagnitudeLimit, includeMinorPlanetsWithoutMagnitude } = useSnapshot(annotation.state.request)
	const canIncludeWithoutMagnitude = !loading && minorPlanets && isValidMagnitudeLimit(minorPlanetsMagnitudeLimit) && minorPlanetsMagnitudeLimit < MAX_MINOR_PLANET_MAGNITUDE_LIMIT

	return (
		<>
			<Checkbox className="col-span-full" disabled={loading} label="Minor Planets" onValueChange={(value) => annotation.update('minorPlanets', value)} value={minorPlanets} />
			<NumberInput className="col-span-5 min-w-0" disabled={loading || !minorPlanets} label="Magnitude Limit" maxValue={MAX_MINOR_PLANET_MAGNITUDE_LIMIT} minValue={1} onValueChange={(value) => annotation.update('minorPlanetsMagnitudeLimit', value)} value={minorPlanetsMagnitudeLimit} />
			<Checkbox className="col-span-7 min-w-0" disabled={!canIncludeWithoutMagnitude} label="Include without magnitude" onValueChange={(value) => annotation.update('includeMinorPlanetsWithoutMagnitude', value)} value={canIncludeWithoutMagnitude && includeMinorPlanetsWithoutMagnitude} />
		</>
	)
})

const Footer = memo(() => {
	const { annotation } = useContext(ImageViewerStoreContext)
	const { loading } = useSnapshot(annotation.state)
	const { stars, dsos, minorPlanets, minorPlanetsMagnitudeLimit } = useSnapshot(annotation.state.request)
	const canAnnotate = stars || dsos || (minorPlanets && isValidMagnitudeLimit(minorPlanetsMagnitudeLimit))

	return <Button color="success" disabled={!canAnnotate} label="Annotate" loading={loading} onClick={annotation.annotate} startContent={<Icons.Check />} />
})

const MAX_MINOR_PLANET_MAGNITUDE_LIMIT = 30

function isValidMagnitudeLimit(value: number) {
	return Number.isFinite(value) && value >= 1 && value <= MAX_MINOR_PLANET_MAGNITUDE_LIMIT
}
