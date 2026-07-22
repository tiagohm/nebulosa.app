import { ImageViewerStoreContext } from '@shared/context'
import { hasScaledSolution } from '@stores/image.solver.store'
import { Switch } from '@ui/components/Switch'
import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const ImageCoordinateGrid = memo(() => {
	const { coordinateGrid, solver } = useContext(ImageViewerStoreContext)
	const { solution } = useSnapshot(solver.state)
	const { enabled } = useSnapshot(coordinateGrid.state)

	useEffect(coordinateGrid.mount, [])

	if (!hasScaledSolution(solution)) return <div className="flex h-full w-full flex-row items-center justify-center">Not available</div>

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Switch className="col-span-full min-w-0" label="Enabled" onValueChange={coordinateGrid.setEnabled} value={enabled} />
		</div>
	)
})
