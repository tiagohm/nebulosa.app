import type { ReactNode } from 'react'

// One measurement of a star's profile, for the description lists of the Guiding panel and the Star Profile Inspector.

interface StarProfileRowProps {
	// Name of the measurement.
	readonly label: string
	// Its value; a long one wraps instead of being cut.
	readonly children: ReactNode
}

// Label and value of a row.
export function StarProfileRow({ label, children }: StarProfileRowProps) {
	return (
		<div className="contents">
			<dt className="text-ink-300">{label}</dt>
			<dd className="m-0 min-w-0 text-right tabular-nums">{children}</dd>
		</div>
	)
}
