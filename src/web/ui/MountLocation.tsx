import { Location } from '@ui/Location'
import { memo, useContext } from 'react'
import { MountStoreContext } from 'src/web/shared/context'
import { useSnapshot } from 'valtio'

export const MountLocation = memo(() => {
	const mount = useContext(MountStoreContext)
	const { geographicCoordinate } = useSnapshot(mount.state.mount)

	return <Location {...geographicCoordinate} onCoordinateChange={mount.location} />
})
