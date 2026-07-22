import { ImageViewerStoreContext } from '@shared/context'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { IconButton } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Icons } from '@ui/Icon'
import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const ImageAnnotation = memo(() => {
	const { annotation } = useContext(ImageViewerStoreContext)

	useEffect(annotation.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<StarsAndDsos />
			<MinorPlanets />
			<Footer />
		</div>
	)
})

const StarsAndDsos = memo(() => {
	const { annotation } = useContext(ImageViewerStoreContext)
	const { loading } = useSnapshot(annotation.state)
	const { stars, dsos, useSimbad } = useSnapshot(annotation.state.request)
	const canUseSimbad = !loading && (stars || dsos)

	return (
		<>
			<Checkbox className="col-span-6" disabled={loading} label="Stars" onValueChange={annotation.setStars} value={stars} />
			<Checkbox className="col-span-6" disabled={loading} label="DSOs" onValueChange={annotation.setDsos} value={dsos} />
			<div className="col-span-full flex min-w-0 flex-row items-center gap-2">
				<Checkbox disabled={!canUseSimbad} label="SIMBAD Astronomical Database" onValueChange={annotation.setUseSimbad} value={canUseSimbad && useSimbad} />
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
			<Checkbox className="col-span-full" disabled={loading} label="Minor Planets" onValueChange={annotation.setMinorPlanets} value={minorPlanets} />
			<NumberInput className="col-span-5 min-w-0" disabled={loading || !minorPlanets} label="Magnitude Limit" maxValue={MAX_MINOR_PLANET_MAGNITUDE_LIMIT} minValue={1} onValueChange={annotation.setMinorPlanetsMagnitudeLimit} value={minorPlanetsMagnitudeLimit} />
			<Checkbox className="col-span-7 min-w-0" disabled={!canIncludeWithoutMagnitude} label="Include without magnitude" onValueChange={annotation.setIncludeMinorPlanetsWithoutMagnitude} value={canIncludeWithoutMagnitude && includeMinorPlanetsWithoutMagnitude} />
		</>
	)
})

const Footer = memo(() => {
	const { annotation } = useContext(ImageViewerStoreContext)
	const { loading } = useSnapshot(annotation.state)
	const { stars, dsos, minorPlanets, minorPlanetsMagnitudeLimit } = useSnapshot(annotation.state.request)
	const canAnnotate = stars || dsos || (minorPlanets && isValidMagnitudeLimit(minorPlanetsMagnitudeLimit))

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Button color="success" disabled={!canAnnotate} label="Annotate" loading={loading} onClick={annotation.annotate} startContent={<Icons.Check />} />
		</div>
	)
})

const MAX_MINOR_PLANET_MAGNITUDE_LIMIT = 30

function isValidMagnitudeLimit(value: number) {
	return Number.isFinite(value) && value >= 1 && value <= MAX_MINOR_PLANET_MAGNITUDE_LIMIT
}
