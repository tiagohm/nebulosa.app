import type { SaturnRings } from 'api'
import { formatDegrees } from '../../format'
import { DataList, DataRow } from '../../ui/DataRow'

// The ring geometry at the tool's instant: the signed openings toward the Earth and the Sun, the pole's position angle,
// the apparent sizes of the rings and the disk, which face of the rings the Earth sees, and whether that face is lit.
// Values are the server's; the explanation of the faces follows the signs of the openings.

// Arcseconds per radian.
const ARCSEC = (180 / Math.PI) * 3600

// Sentence of each illumination of the rings.
const ILLUMINATION: Readonly<Record<SaturnRings['illumination'], string>> = {
	sameFace: 'The Earth sees the face of the rings the Sun lights.',
	oppositeFaces: 'The Earth sees the unlit face of the rings, lit only by sunlight passing through them.',
	edgeOn: 'The Earth or the Sun is within 0.1° of the ring plane: the rings are edge-on and nearly invisible.',
}

export interface RingGeometryProps {
	readonly rings: SaturnRings
}

// The ring geometry at the instant.
export function RingGeometry({ rings }: RingGeometryProps) {
	const face = rings.earthOpening > 0 ? 'north' : rings.earthOpening < 0 ? 'south' : 'neither'

	return (
		<div className="flex flex-col gap-2">
			<DataList>
				<DataRow label="Earth opening B">{`${rings.earthOpening >= 0 ? '+' : '−'}${formatDegrees(Math.abs(rings.earthOpening), 3)} (${face} face)`}</DataRow>
				<DataRow label="Solar opening B′">{`${rings.solarOpening >= 0 ? '+' : '−'}${formatDegrees(Math.abs(rings.solarOpening), 3)} (${rings.solarOpening > 0 ? 'north' : rings.solarOpening < 0 ? 'south' : 'neither'} face lit)`}</DataRow>
				<DataRow label="Pole position angle P">{formatDegrees(rings.polePositionAngle, 2)}</DataRow>
				<DataRow label="Rings (outer A edge)">{`${(2 * rings.ringSemiMajor * ARCSEC).toFixed(2)}″ × ${(2 * rings.ringSemiMinor * ARCSEC).toFixed(2)}″`}</DataRow>
				<DataRow label="Disk">{`${(2 * rings.equatorialRadius * ARCSEC).toFixed(2)}″ × ${(2 * rings.polarRadius * ARCSEC).toFixed(2)}″`}</DataRow>
				<DataRow label="Distance">{`${rings.distance.toFixed(4)} AU`}</DataRow>
			</DataList>
			<p className="m-0 text-xs text-ink-300">{ILLUMINATION[rings.illumination]} The ring drawing is schematic: its brightness and the shadows are not predicted.</p>
		</div>
	)
}
