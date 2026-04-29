import { Children, Fragment, isValidElement } from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { tw } from '@/shared/util'
import { Icons } from '../Icon'

const breadcrumbsStyles = tv({
	slots: {
		base: 'inline-flex min-w-0 max-w-full items-center align-top',
		item: 'inline-flex min-w-0 items-center truncate text-neutral-200',
		separator: 'flex shrink-0 items-center justify-center text-neutral-500',
		separatorIcon: 'size-[1.25em]',
		ellipsis: 'flex shrink-0 items-center justify-center text-neutral-500',
		ellipsisIcon: 'size-[1.25em]',
	},
	variants: {
		size: {
			sm: {
				base: 'gap-0.5',
				item: 'text-xs',
				separator: 'text-xs',
				ellipsis: 'text-xs',
			},
			md: {
				base: 'gap-1',
				item: 'text-sm',
				separator: 'text-sm',
				ellipsis: 'text-sm',
			},
			lg: {
				base: 'gap-1.5',
				item: 'text-base',
				separator: 'text-base',
				ellipsis: 'text-base',
			},
		},
		fullWidth: {
			true: {
				base: 'w-full',
			},
		},
	},
	defaultVariants: {
		size: 'md',
		fullWidth: false,
	},
})

type BreadcrumbsVariants = VariantProps<typeof breadcrumbsStyles>

export interface BreadcrumbsClassNames {
	readonly base?: ClassValue
	readonly item?: ClassValue
	readonly separator?: ClassValue
	readonly separatorIcon?: ClassValue
	readonly ellipsis?: ClassValue
	readonly ellipsisIcon?: ClassValue
}

export interface BreadcrumbsProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children'>, BreadcrumbsVariants {
	readonly children?: React.ReactNode
	readonly classNames?: BreadcrumbsClassNames
	readonly disabled?: boolean
	readonly ellipsis?: React.ReactNode
	readonly maxItems?: number
	readonly separator?: React.ReactNode
}

type BreadcrumbRenderPart =
	| {
			readonly item: React.ReactNode
			readonly sourceIndex: number
			readonly type: 'item'
	  }
	| {
			readonly type: 'ellipsis'
	  }

// Checks whether a React child should participate in breadcrumb layout.
function isBreadcrumbChild(child: React.ReactNode) {
	return child !== undefined && child !== null && child !== false && child !== true
}

// Appends breadcrumb items while allowing callers to group children in fragments.
function pushBreadcrumbItems(children: React.ReactNode, items: React.ReactNode[]) {
	for (const child of Children.toArray(children)) {
		if (isValidElement(child) && child.type === Fragment) {
			pushBreadcrumbItems((child.props as { children?: React.ReactNode }).children, items)
			continue
		}

		if (isBreadcrumbChild(child)) items.push(child)
	}
}

// Collects breadcrumb children into a flat render list.
function collectBreadcrumbItems(children: React.ReactNode) {
	const items: React.ReactNode[] = []
	pushBreadcrumbItems(children, items)
	return items
}

// Builds a stable key for rendered breadcrumb item fragments.
function breadcrumbItemKey(item: React.ReactNode, index: number) {
	return isValidElement(item) && item.key !== null ? item.key : index
}

// Normalizes invalid maximum values without letting bad props hide every crumb.
function normalizeMaxItems(maxItems: number | undefined) {
	if (typeof maxItems !== 'number' || !Number.isFinite(maxItems)) return undefined
	return Math.max(3, Math.trunc(maxItems))
}

// Builds the visible breadcrumb sequence and preserves the first crumb when truncated.
function collectBreadcrumbParts(items: readonly React.ReactNode[], maxItems: number | undefined) {
	const normalizedMaxItems = normalizeMaxItems(maxItems)

	if (normalizedMaxItems === undefined || items.length <= normalizedMaxItems) {
		return items.map((item, sourceIndex) => ({ item, sourceIndex, type: 'item' }) satisfies BreadcrumbRenderPart)
	}

	const tailCount = Math.max(0, normalizedMaxItems - 1)
	const tailStartIndex = Math.max(items.length - tailCount, 1)
	const parts: BreadcrumbRenderPart[] = [{ item: items[0], sourceIndex: 0, type: 'item' }, { type: 'ellipsis' }]

	for (let i = tailStartIndex; i < items.length; i++) {
		parts.push({ item: items[i], sourceIndex: i, type: 'item' })
	}

	return parts
}

// Builds a stable key for rendered breadcrumb items and truncation markers.
function breadcrumbPartKey(part: BreadcrumbRenderPart) {
	return part.type === 'ellipsis' ? 'ellipsis' : `item-${breadcrumbItemKey(part.item, part.sourceIndex)}`
}

// Render a compact breadcrumb row by interleaving children with chevron separators.
export function Breadcrumbs({ children, className, classNames, disabled = false, ellipsis, fullWidth, inert, maxItems, ref, separator, size, ...props }: BreadcrumbsProps) {
	const items = collectBreadcrumbItems(children)
	const parts = collectBreadcrumbParts(items, maxItems)
	const styles = breadcrumbsStyles({ fullWidth, size })
	const stateClassName = disabled ? 'cursor-not-allowed opacity-40 pointer-events-none' : 'cursor-default'
	const inertState = disabled || inert || undefined
	const separatorContent = separator === undefined ? <Icons.ChevronRight className={tw(styles.separatorIcon(), classNames?.separatorIcon)} /> : separator
	const ellipsisContent = ellipsis === undefined ? <Icons.DotsHorizontal className={tw(styles.ellipsisIcon(), classNames?.ellipsisIcon)} /> : ellipsis

	return (
		<div {...props} className={tw(styles.base(), stateClassName, className, classNames?.base)} inert={inertState} ref={ref}>
			{parts.map((part, index) => (
				<Fragment key={breadcrumbPartKey(part)}>
					{index > 0 && <span className={tw(styles.separator(), classNames?.separator)}>{separatorContent}</span>}
					{part.type === 'ellipsis' ? <span className={tw(styles.ellipsis(), classNames?.ellipsis)}>{ellipsisContent}</span> : <span className={tw(styles.item(), classNames?.item)}>{part.item}</span>}
				</Fragment>
			))}
		</div>
	)
}
