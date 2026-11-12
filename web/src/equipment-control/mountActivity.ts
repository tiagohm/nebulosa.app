import type { MountState } from 'api'

// Motion of a mount as every mount status of the app names it. The toolkit's `slewing` is broad: it is true
// while any command moves the mount's coordinate (a goto or flip, a manual axis motion, and with some drivers
// parking and homing), so it is read after the flags that name the cause, and what it alone reports is a
// goto or a flip.

// Motion of a mount shown as status text.
export type MountMotion = 'Parking' | 'Homing' | 'Moving' | 'Slewing'

// Returns the motion of a mount by precedence: parking (some mounts park by homing, so the command given wins),
// homing, a manual axis motion, then a goto or flip; undefined when the mount reports no motion.
export function mountMotion(state: Pick<MountState, 'parking' | 'homing' | 'moving' | 'slewing'>): MountMotion | undefined {
	if (state.parking) return 'Parking'
	if (state.homing) return 'Homing'
	if (state.moving) return 'Moving'
	if (state.slewing) return 'Slewing'
	return undefined
}
