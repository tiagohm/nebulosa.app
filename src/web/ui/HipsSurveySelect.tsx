import type { HipsSurvey } from 'nebulosa/src/hips2fits'
import hipsSurveys from '../../../data/hips-surveys.json'
import { ListItem } from './components/List'
import { FilterableSelect, type FilterableSelectProps } from './FilterableSelect'

export interface HipsSurveyProps extends Omit<FilterableSelectProps<HipsSurvey>, 'items' | 'children' | 'filter' | 'itemHeight' | 'value' | 'onValueChange'> {
	readonly value?: string
	readonly onValueChange?: (value: string) => void
}

function Filter(item: HipsSurvey, search: string) {
	return item.id.toLowerCase().includes(search) || item.regime.toLowerCase().includes(search)
}

function HipsSurveySelectItem(item: HipsSurvey) {
	return <ListItem label={item.id} description={`${item.regime} (${(item.skyFraction * 100).toFixed(1)}%)`} />
}

export function HipsSurveySelect({ onValueChange, value, ...props }: HipsSurveyProps) {
	return (
		<FilterableSelect filter={Filter} onValueChange={(value) => onValueChange?.(value.id)} value={hipsSurveys.find((e) => e.id === value) as never} itemHeight={38} items={hipsSurveys as readonly HipsSurvey[]} {...props}>
			{HipsSurveySelectItem}
		</FilterableSelect>
	)
}
