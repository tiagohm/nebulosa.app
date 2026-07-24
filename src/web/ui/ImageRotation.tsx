import { IconButton } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Icons } from '@ui/Icon'
import { memo, useContext, useEffect } from 'react'
import { ImageViewerStoreContext } from 'src/web/shared/context'
import { useSnapshot } from 'valtio'

export const ImageRotation = memo(() => {
	const { rotation } = useContext(ImageViewerStoreContext)
	const { angle } = useSnapshot(rotation.state)

	useEffect(rotation.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<NumberInput className="col-span-full" minValue={0} maxValue={360} fractionDigits={2} step={1} label="Angle" endContent="°" value={angle} onValueChange={rotation.setAngle} />
			<div className="col-span-full flex flex-row items-center justify-center gap-2">
				<IconButton icon={Icons.RotateLeft} color="primary" onClick={rotation.rotateCounterclockwise} tooltipContent="Rotate 90° left" />
				<IconButton icon={Icons.RotateRight} color="primary" onClick={rotation.rotateClockwise} tooltipContent="Rotate 90° right" />
				<IconButton icon={Icons.Restore} color="danger" onClick={rotation.reset} tooltipContent="Reset" />
			</div>
		</div>
	)
})
