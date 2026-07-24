import type { StellariumObjectType } from 'nebulosa/src/devices/protocols/stellarium'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import type { SkyObject } from 'src/types/galaxy'

export interface AnnotatedSkyObject extends Required<Omit<SkyObject, 'type' | 'spmType'>>, Readonly<Point> {
	readonly type: StellariumObjectType | 'MINOR_PLANET'
}
