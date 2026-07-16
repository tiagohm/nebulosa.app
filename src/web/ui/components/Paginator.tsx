import { IconButton } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Icons } from '@ui/Icon'
import { tw } from 'src/web/shared/util'

export interface PaginatorProps extends React.ComponentProps<'div'> {
	readonly page: number
	readonly count: number
	readonly loading?: boolean
	readonly readOnly?: boolean
	readonly onPrev: VoidFunction
	readonly onNext: VoidFunction
}

export function Paginator({ page, count, onPrev, onNext, loading = false, readOnly = true, className, ...props }: PaginatorProps) {
	return (
		<div {...props} className={tw('flex flex-row items-center justify-center gap-3', className)}>
			<IconButton color="secondary" disabled={page <= 1 || loading} icon={Icons.ChevronLeft} onClick={onPrev} />
			<NumberInput className="max-w-20" classNames={{ input: 'text-center' }} disabled={loading || (page <= 1 && count < 4)} minValue={1} readOnly={readOnly} value={page} />
			<IconButton color="secondary" disabled={count < 4 || loading} icon={Icons.ChevronRight} onClick={onNext} />
		</div>
	)
}
