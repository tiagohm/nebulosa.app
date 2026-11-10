// Head of an inspected object: its name, what it is, and its other designations, the one title block of the Sky
// inspectors, the lunar feature details, and the overview of a close approach. It renders bare lines, so the section
// that holds it spaces them as its other rows.

export interface ObjectTitleProps {
	// Name of the object.
	readonly name: string
	// What the object is, such as "Star" or "Comet · Apollo"; absent when unknown.
	readonly kind?: string
	// Other designations joined in one line, such as "M 31 · NGC 224"; absent or empty when it has none.
	readonly designations?: string
	// Tooltip of the designations, explaining them.
	readonly designationsTitle?: string
}

// Name, kind, and designations of an object.
export function ObjectTitle({ name, kind, designations, designationsTitle }: ObjectTitleProps) {
	return (
		<>
			<p className="m-0 text-base leading-6 font-semibold text-ink-100">{name}</p>
			{kind && <p className="m-0 text-ink-300">{kind}</p>}
			{designations && (
				<p className="m-0 text-xs leading-5 text-ink-200" title={designationsTitle}>
					{designations}
				</p>
			)}
		</>
	)
}
