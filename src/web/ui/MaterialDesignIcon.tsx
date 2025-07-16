// https://pictogrammers.com/library/mdi/icon

export interface MaterialDesignIconProps extends Partial<Omit<React.ComponentPropsWithoutRef<'svg'>, 'stroke'>> {
	readonly size?: string | number
	readonly stroke?: string | number
}

export const Counter = ({ size, stroke = 1, color = 'currentColor', ...props }: MaterialDesignIconProps) => {
	return (
		<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' width={size} xmlns='http://www.w3.org/2000/svg' {...props}>
			<path d='M4,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M4,6V18H11V6H4M20,18V6H18.76C19,6.54 18.95,7.07 18.95,7.13C18.88,7.8 18.41,8.5 18.24,8.75L15.91,11.3L19.23,11.28L19.24,12.5L14.04,12.47L14,11.47C14,11.47 17.05,8.24 17.2,7.95C17.34,7.67 17.91,6 16.5,6C15.27,6.05 15.41,7.3 15.41,7.3L13.87,7.31C13.87,7.31 13.88,6.65 14.25,6H13V18H15.58L15.57,17.14L16.54,17.13C16.54,17.13 17.45,16.97 17.46,16.08C17.5,15.08 16.65,15.08 16.5,15.08C16.37,15.08 15.43,15.13 15.43,15.95H13.91C13.91,15.95 13.95,13.89 16.5,13.89C19.1,13.89 18.96,15.91 18.96,15.91C18.96,15.91 19,17.16 17.85,17.63L18.37,18H20M8.92,16H7.42V10.2L5.62,10.76V9.53L8.76,8.41H8.92V16Z' />
		</svg>
	)
}

export const TimerSand = ({ size, stroke = 1, color = 'currentColor', ...props }: MaterialDesignIconProps) => {
	return (
		<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' width={size} xmlns='http://www.w3.org/2000/svg' {...props}>
			<path d='M6,2H18V8H18V8L14,12L18,16V16H18V22H6V16H6V16L10,12L6,8V8H6V2M16,16.5L12,12.5L8,16.5V20H16V16.5M12,11.5L16,7.5V4H8V7.5L12,11.5M10,6H14V6.75L12,8.75L10,6.75V6Z' />
		</svg>
	)
}

export const TimerSandComplete = ({ size, stroke = 1, color = 'currentColor', ...props }: MaterialDesignIconProps) => {
	return (
		<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' width={size} xmlns='http://www.w3.org/2000/svg' {...props}>
			<path d='M18 22H6V16L10 12L6 8V2H18V8L14 12L18 16M8 7.5L12 11.5L16 7.5V4H8M12 12.5L8 16.5V20H16V16.5M14 18H10V17.2L12 15.2L14 17.2Z' />
		</svg>
	)
}

export const CameraIris = ({ size, stroke = 1, color = 'currentColor', ...props }: MaterialDesignIconProps) => {
	return (
		<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
			<path d='M13.73,15L9.83,21.76C10.53,21.91 11.25,22 12,22C14.4,22 16.6,21.15 18.32,19.75L14.66,13.4M2.46,15C3.38,17.92 5.61,20.26 8.45,21.34L12.12,15M8.54,12L4.64,5.25C3,7 2,9.39 2,12C2,12.68 2.07,13.35 2.2,14H9.69M21.8,10H14.31L14.6,10.5L19.36,18.75C21,16.97 22,14.6 22,12C22,11.31 21.93,10.64 21.8,10M21.54,9C20.62,6.07 18.39,3.74 15.55,2.66L11.88,9M9.4,10.5L14.17,2.24C13.47,2.09 12.75,2 12,2C9.6,2 7.4,2.84 5.68,4.25L9.34,10.6L9.4,10.5Z' />
		</svg>
	)
}

export const Telescope = ({ size, stroke = 1, color = 'currentColor', ...props }: MaterialDesignIconProps) => {
	return (
		<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
			<path d='M21.9,8.9L20.2,9.9L16.2,3L17.9,2L21.9,8.9M9.8,7.9L12.8,13.1L18.9,9.6L15.9,4.4L9.8,7.9M11.4,12.7L9.4,9.2L5.1,11.7L7.1,15.2L11.4,12.7M2.1,14.6L3.1,16.3L5.7,14.8L4.7,13.1L2.1,14.6M12.1,14L11.8,13.6L7.5,16.1L7.8,16.5C8,16.8 8.3,17.1 8.6,17.3L7,22H9L10.4,17.7H10.5L12,22H14L12.1,16.4C12.6,15.7 12.6,14.8 12.1,14Z' />
		</svg>
	)
}
