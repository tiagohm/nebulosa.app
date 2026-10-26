import type { IndiBlobProperty, IndiLightProperty } from 'api'
import { cn } from 'cn'
import { Readout } from '../parts'
import { blobText, labelOf, STATE_COLORS } from './indi.format'

// Read-only views of the INDI Properties view: the lights of a light vector, each with its own state apart from
// the vector's, and the latest delivery of each element of a BLOB vector, metadata only: the view never
// downloads, previews, or enables BLOBs.

// Lights of a light vector.
export function LightVectorView({ vector }: { readonly vector: IndiLightProperty }) {
	return (
		<div className="flex flex-col gap-1">
			{vector.elementNames.map((name) => (
				<Readout key={name} label={labelOf(vector.elements[name])}>
					<span className={cn(STATE_COLORS[vector.elements[name].value])}>{vector.elements[name].value}</span>
				</Readout>
			))}
		</div>
	)
}

// Latest deliveries of a BLOB vector.
export function BlobVectorView({ vector }: { readonly vector: IndiBlobProperty }) {
	return (
		<div className="flex flex-col gap-1">
			{vector.elementNames.map((name) => (
				<Readout key={name} label={labelOf(vector.elements[name])}>
					{blobText(vector.elements[name]) ?? 'No data received'}
				</Readout>
			))}
		</div>
	)
}
