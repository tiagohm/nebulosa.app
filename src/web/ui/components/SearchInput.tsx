import { Icons } from '../Icon'
import { TextInput, type TextInputProps } from './TextInput'

export interface SearchInputProps extends TextInputProps {
	minLengthToSearch?: number
}

export function SearchTextInput({ placeholder = 'Search', minLengthToSearch = 3, value, onValueChange, ...props }: SearchInputProps) {
	function handleValueChange(value: string) {
		if (value.length === 0 || value.length >= minLengthToSearch) {
			onValueChange?.(value)
		}
	}

	return <TextInput onValueChange={handleValueChange} placeholder={placeholder} fireOnEnter startContent={<Icons.Search />} value={value} {...props} />
}
