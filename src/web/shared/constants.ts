export const DECIMAL_NUMBER_FORMAT: Readonly<Intl.NumberFormatOptions> = {
	style: 'decimal',
	minimumFractionDigits: 0,
	maximumFractionDigits: 16,
	useGrouping: true,
}

export const INTEGER_NUMBER_FORMAT: Readonly<Intl.NumberFormatOptions> = {
	style: 'decimal',
	minimumFractionDigits: 0,
	maximumFractionDigits: 0,
	useGrouping: true,
}
