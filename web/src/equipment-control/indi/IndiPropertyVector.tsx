import type { IndiProperty } from 'api'
import { cn } from 'cn'
import { Notice } from '../parts'
import { labelOf, PERMISSION_LABELS, RULE_LABELS, STATE_COLORS, TYPE_LABELS } from './indi.format'
import { BlobVectorView, LightVectorView } from './IndiReadings'
import { IndiWriteStatus } from './IndiWriteStatus'
import { SwitchVectorEditor } from './SwitchVectorEditor'
import { ValueVectorEditor } from './ValueVectorEditor'

// One vector of the INDI Properties view: its label and technical name, kind, permission, switch rule, state
// as text, the driver's latest message for it, its elements in driver order with the editor of its kind, and
// the outcome of the latest write.

export interface IndiPropertyVectorProps {
	// Vector shown.
	readonly vector: IndiProperty
}

// Editor or reading of a vector by its kind.
function VectorBody({ vector }: IndiPropertyVectorProps) {
	switch (vector.type) {
		case 'TEXT':
		case 'NUMBER':
			return <ValueVectorEditor vector={vector} />
		case 'SWITCH':
			return <SwitchVectorEditor vector={vector} />
		case 'LIGHT':
			return <LightVectorView vector={vector} />
		case 'BLOB':
			return <BlobVectorView vector={vector} />
	}
}

// Vector of the view.
export function IndiPropertyVector({ vector }: IndiPropertyVectorProps) {
	const details = [TYPE_LABELS[vector.type], vector.type === 'LIGHT' ? 'read-only' : PERMISSION_LABELS[vector.permission], vector.type === 'SWITCH' ? RULE_LABELS[vector.rule] : undefined].filter(Boolean).join(' · ')

	return (
		<section className="flex flex-col gap-2 border-t border-line-100 py-3 first:border-t-0">
			<header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
				<h4 className="m-0 min-w-0 text-[13px] font-medium break-words text-ink-100">{labelOf(vector)}</h4>
				<span className="min-w-0 font-mono text-[11px] break-all text-ink-300">{vector.name}</span>
				<span className="ml-auto flex items-baseline gap-2 text-xs">
					<span className="text-ink-300 max-sm:hidden">{details}</span>
					<span className={cn('font-medium', STATE_COLORS[vector.state])}>{vector.state}</span>
				</span>
			</header>
			{vector.message && <Notice error={vector.state === 'Alert'}>{vector.message}</Notice>}
			<VectorBody vector={vector} />
			<IndiWriteStatus name={vector.name} />
		</section>
	)
}
