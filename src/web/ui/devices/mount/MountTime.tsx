import { memo, useContext } from 'react'
import { MountStoreContext } from 'src/web/shared/context'
import { useSnapshot } from 'valtio'
import { Time } from '../../Time'

export const MountTime = memo(() => {
	const mount = useContext(MountStoreContext)
	const { time } = useSnapshot(mount.state.mount)

	return <Time {...time} onTimeChange={mount.time} />
})
