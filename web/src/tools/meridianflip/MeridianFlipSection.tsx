import type { ReactNode } from 'react'
import { SectionHeading } from '../../ui/SectionHeading'

// Section of the main area of the Meridian Flip tool, shared by its Monitor and Executor views: a group headed by the
// uppercase label of the app, set apart from the one above it by a line rather than boxed, as the console's panels are.

// Titled section of the Meridian Flip tool.
export function FlipSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
	return (
		<section className="flex min-w-0 flex-col gap-3 border-t border-line-100 pt-3">
			<SectionHeading as="h2">{title}</SectionHeading>
			{children}
		</section>
	)
}
