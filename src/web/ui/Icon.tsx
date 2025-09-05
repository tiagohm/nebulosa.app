// https://pictogrammers.com/library/mdi/icon

export type Icon = React.ComponentPropsWithoutRef<'svg'> &
	React.ComponentType<{
		readonly size?: string | number
		readonly stroke?: string | number
		readonly color?: string
	}>

export interface IconProps extends Partial<Omit<React.ComponentPropsWithoutRef<'svg'>, 'stroke'>> {
	readonly size?: string | number
	readonly stroke?: string | number
}

export namespace Icons {
	export const Counter = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' width={size} xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M4,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M4,6V18H11V6H4M20,18V6H18.76C19,6.54 18.95,7.07 18.95,7.13C18.88,7.8 18.41,8.5 18.24,8.75L15.91,11.3L19.23,11.28L19.24,12.5L14.04,12.47L14,11.47C14,11.47 17.05,8.24 17.2,7.95C17.34,7.67 17.91,6 16.5,6C15.27,6.05 15.41,7.3 15.41,7.3L13.87,7.31C13.87,7.31 13.88,6.65 14.25,6H13V18H15.58L15.57,17.14L16.54,17.13C16.54,17.13 17.45,16.97 17.46,16.08C17.5,15.08 16.65,15.08 16.5,15.08C16.37,15.08 15.43,15.13 15.43,15.95H13.91C13.91,15.95 13.95,13.89 16.5,13.89C19.1,13.89 18.96,15.91 18.96,15.91C18.96,15.91 19,17.16 17.85,17.63L18.37,18H20M8.92,16H7.42V10.2L5.62,10.76V9.53L8.76,8.41H8.92V16Z' />
			</svg>
		)
	}

	export const TimerSand = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' width={size} xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M6,2H18V8H18V8L14,12L18,16V16H18V22H6V16H6V16L10,12L6,8V8H6V2M16,16.5L12,12.5L8,16.5V20H16V16.5M12,11.5L16,7.5V4H8V7.5L12,11.5M10,6H14V6.75L12,8.75L10,6.75V6Z' />
			</svg>
		)
	}

	export const TimerSandComplete = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' width={size} xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M18 22H6V16L10 12L6 8V2H18V8L14 12L18 16M8 7.5L12 11.5L16 7.5V4H8M12 12.5L8 16.5V20H16V16.5M14 18H10V17.2L12 15.2L14 17.2Z' />
			</svg>
		)
	}

	export const Camera = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M13.73,15L9.83,21.76C10.53,21.91 11.25,22 12,22C14.4,22 16.6,21.15 18.32,19.75L14.66,13.4M2.46,15C3.38,17.92 5.61,20.26 8.45,21.34L12.12,15M8.54,12L4.64,5.25C3,7 2,9.39 2,12C2,12.68 2.07,13.35 2.2,14H9.69M21.8,10H14.31L14.6,10.5L19.36,18.75C21,16.97 22,14.6 22,12C22,11.31 21.93,10.64 21.8,10M21.54,9C20.62,6.07 18.39,3.74 15.55,2.66L11.88,9M9.4,10.5L14.17,2.24C13.47,2.09 12.75,2 12,2C9.6,2 7.4,2.84 5.68,4.25L9.34,10.6L9.4,10.5Z' />
			</svg>
		)
	}

	export const Telescope = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M21.9,8.9L20.2,9.9L16.2,3L17.9,2L21.9,8.9M9.8,7.9L12.8,13.1L18.9,9.6L15.9,4.4L9.8,7.9M11.4,12.7L9.4,9.2L5.1,11.7L7.1,15.2L11.4,12.7M2.1,14.6L3.1,16.3L5.7,14.8L4.7,13.1L2.1,14.6M12.1,14L11.8,13.6L7.5,16.1L7.8,16.5C8,16.8 8.3,17.1 8.6,17.3L7,22H9L10.4,17.7H10.5L12,22H14L12.1,16.4C12.6,15.7 12.6,14.8 12.1,14Z' />
			</svg>
		)
	}

	export const Focuser = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12 8C8.44 8 6.65 12.31 9.17 14.83C11.69 17.35 16 15.56 16 12C16 9.79 14.21 8 12 8M5 15H3V19C3 20.1 3.9 21 5 21H9V19H5M5 5H9V3H5C3.9 3 3 3.9 3 5V9H5M19 3H15V5H19V9H21V5C21 3.9 20.1 3 19 3M19 19H15V21H19C20.1 21 21 20.1 21 19V15H19' />
			</svg>
		)
	}

	export const Thermometer = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M15 13V5A3 3 0 0 0 9 5V13A5 5 0 1 0 15 13M12 4A1 1 0 0 1 13 5V8H11V5A1 1 0 0 1 12 4Z' />
			</svg>
		)
	}

	export const Save = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M15,9H5V5H15M12,19A3,3 0 0,1 9,16A3,3 0 0,1 12,13A3,3 0 0,1 15,16A3,3 0 0,1 12,19M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3Z' />
			</svg>
		)
	}

	export const SaveOff = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M8.2 5L6.2 3H17L21 7V17.8L12.2 9H15V5H8.2M22.11 21.46L20.84 22.73L19.1 21C19.07 21 19.03 21 19 21H5C3.9 21 3 20.11 3 19V5C3 4.97 3 4.93 3 4.9L1.11 3L2.39 1.73L22.11 21.46M7.11 9L5 6.89V9H7.11M14.89 16.78L11.22 13.11C9.95 13.46 9 14.61 9 16C9 17.66 10.34 19 12 19C13.39 19 14.54 18.05 14.89 16.78Z' />
			</svg>
		)
	}

	export const FolderOff = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M22.11 21.46L20.84 22.73L18.11 20H4C2.9 20 2 19.11 2 18V6C2 5.42 2.25 4.9 2.64 4.53L1.11 3L2.39 1.73L22.11 21.46M22 18V8C22 6.89 21.1 6 20 6H12L10 4H7.2L21.88 18.68C21.96 18.47 22 18.24 22 18Z' />
			</svg>
		)
	}

	export const Link = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M3.9,12C3.9,10.29 5.29,8.9 7,8.9H11V7H7A5,5 0 0,0 2,12A5,5 0 0,0 7,17H11V15.1H7C5.29,15.1 3.9,13.71 3.9,12M8,13H16V11H8V13M17,7H13V8.9H17C18.71,8.9 20.1,10.29 20.1,12C20.1,13.71 18.71,15.1 17,15.1H13V17H17A5,5 0 0,0 22,12A5,5 0 0,0 17,7Z' />
			</svg>
		)
	}

	export const Heart = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z' />
			</svg>
		)
	}

	export const Sun = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M3.55 19.09L4.96 20.5L6.76 18.71L5.34 17.29M12 6C8.69 6 6 8.69 6 12S8.69 18 12 18 18 15.31 18 12C18 8.68 15.31 6 12 6M20 13H23V11H20M17.24 18.71L19.04 20.5L20.45 19.09L18.66 17.29M20.45 5L19.04 3.6L17.24 5.39L18.66 6.81M13 1H11V4H13M6.76 5.39L4.96 3.6L3.55 5L5.34 6.81L6.76 5.39M1 13H4V11H1M13 20H11V23H13' />
			</svg>
		)
	}

	export const Moon = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M2 12A10 10 0 0 0 15 21.54A10 10 0 0 1 15 2.46A10 10 0 0 0 2 12Z' />
			</svg>
		)
	}

	export const Stop = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M18,18H6V6H18V18Z' />
			</svg>
		)
	}

	export const Play = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M8,5.14V19.14L19,12.14L8,5.14Z' />
			</svg>
		)
	}

	export const Check = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z' />
			</svg>
		)
	}

	export const Fullscreen = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M5,5H10V7H7V10H5V5M14,5H19V10H17V7H14V5M17,14H19V19H14V17H17V14M10,17V19H5V14H7V17H10Z' />
			</svg>
		)
	}

	export const Circle = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z' />
			</svg>
		)
	}

	export const Image = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M8.5,13.5L11,16.5L14.5,12L19,18H5M21,19V5C21,3.89 20.1,3 19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19Z' />
			</svg>
		)
	}

	export const Sync = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12,18A6,6 0 0,1 6,12C6,11 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12A8,8 0 0,0 12,20V23L16,19L12,15M12,4V1L8,5L12,9V6A6,6 0 0,1 18,12C18,13 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12A8,8 0 0,0 12,4Z' />
			</svg>
		)
	}

	export const Home = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z' />
			</svg>
		)
	}

	export const Galaxy = ({ size = 18, stroke = 2, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill='none' height={size} stroke={color} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12 3c-1.333 1 -2 2.5 -2 4.5c0 3 2 4.5 2 4.5s2 1.5 2 4.5c0 2 -.667 3.5 -2 4.5' />
				<path d='M19.794 16.5c-.2 -1.655 -1.165 -2.982 -2.897 -3.982c-2.597 -1.5 -4.897 -.518 -4.897 -.518s-2.299 .982 -4.897 -.518c-1.732 -1 -2.698 -2.327 -2.897 -3.982' />
				<path d='M19.794 7.5c-1.532 -.655 -3.165 -.482 -4.897 .518c-2.597 1.5 -2.897 3.982 -2.897 3.982s-.299 2.482 -2.897 3.982c-1.732 1 -3.365 1.173 -4.897 .518' />
			</svg>
		)
	}

	export const Plus = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z' />
			</svg>
		)
	}

	export const Laptop = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M4,6H20V16H4M20,18A2,2 0 0,0 22,16V6C22,4.89 21.1,4 20,4H4C2.89,4 2,4.89 2,6V16A2,2 0 0,0 4,18H0V20H24V18H20Z' />
			</svg>
		)
	}

	export const Clock = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M16.2,16.2L11,13V7H12.5V12.2L17,14.9L16.2,16.2Z' />
			</svg>
		)
	}

	export const Edit = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z' />
			</svg>
		)
	}

	export const Copy = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z' />
			</svg>
		)
	}

	export const Trash = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z' />
			</svg>
		)
	}

	export const VerticalMenu = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z' />
			</svg>
		)
	}

	export const Sigma = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M18,6H8.83L14.83,12L8.83,18H18V20H6V18L12,12L6,6V4H18V6Z' />
			</svg>
		)
	}

	export const Restore = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z' />
			</svg>
		)
	}

	export const Planet = ({ size = 18, stroke = 2, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill='none' height={size} stroke={color} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M18.816 13.58c2.292 2.138 3.546 4 3.092 4.9c-.745 1.46 -5.783 -.259 -11.255 -3.838c-5.47 -3.579 -9.304 -7.664 -8.56 -9.123c.464 -.91 2.926 -.444 5.803 .805' />
				<path d='M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0' />
			</svg>
		)
	}

	export const Search = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z' />
			</svg>
		)
	}

	export const ChevronLeft = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z' />
			</svg>
		)
	}

	export const ChevronRight = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z' />
			</svg>
		)
	}

	export const ChevronDown = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z' />
			</svg>
		)
	}

	export const Filter = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M14,12V19.88C14.04,20.18 13.94,20.5 13.71,20.71C13.32,21.1 12.69,21.1 12.3,20.71L10.29,18.7C10.06,18.47 9.96,18.16 10,17.87V12H9.97L4.21,4.62C3.87,4.19 3.95,3.56 4.38,3.22C4.57,3.08 4.78,3 5,3V3H19V3C19.22,3 19.43,3.08 19.62,3.22C20.05,3.56 20.13,4.19 19.79,4.62L14.03,12H14Z' />
			</svg>
		)
	}

	export const ArrowUp = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M14,20H10V11L6.5,14.5L4.08,12.08L12,4.16L19.92,12.08L17.5,14.5L14,11V20Z' />
			</svg>
		)
	}

	export const ArrowLeft = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M20,10V14H11L14.5,17.5L12.08,19.92L4.16,12L12.08,4.08L14.5,6.5L11,10H20Z' />
			</svg>
		)
	}

	export const FolderPlus = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M13 19C13 19.34 13.04 19.67 13.09 20H4C2.9 20 2 19.11 2 18V6C2 4.89 2.89 4 4 4H10L12 6H20C21.1 6 22 6.89 22 8V13.81C21.12 13.3 20.1 13 19 13C15.69 13 13 15.69 13 19M20 18V15H18V18H15V20H18V23H20V20H23V18H20Z' />
			</svg>
		)
	}

	export const FolderOpen = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M19,20H4C2.89,20 2,19.1 2,18V6C2,4.89 2.89,4 4,4H10L12,6H19A2,2 0 0,1 21,8H21L4,8V18L6.14,10H23.21L20.93,18.5C20.7,19.37 19.92,20 19,20Z' />
			</svg>
		)
	}

	export const Folder = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z' />
			</svg>
		)
	}

	export const File = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M13,9V3.5L18.5,9M6,2C4.89,2 4,2.89 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6Z' />
			</svg>
		)
	}

	export const FolderRoot = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12 13m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0' />
				<path d='M12 15v4' />
				<path d='M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2' />
			</svg>
		)
	}

	export const CloseCircle = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z' />
			</svg>
		)
	}

	export const Cog = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z' />
			</svg>
		)
	}

	export const Menu = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z' />
			</svg>
		)
	}

	export const Close = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z' />
			</svg>
		)
	}

	export const MapMarker = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5M12,2A7,7 0 0,0 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9A7,7 0 0,0 12,2Z' />
			</svg>
		)
	}

	export const Download = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z' />
			</svg>
		)
	}

	export const Satellite = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M11.62,1L17.28,6.67L15.16,8.79L13.04,6.67L11.62,8.09L13.95,10.41L12.79,11.58L13.24,12.04C14.17,11.61 15.31,11.77 16.07,12.54L12.54,16.07C11.77,15.31 11.61,14.17 12.04,13.24L11.58,12.79L10.41,13.95L8.09,11.62L6.67,13.04L8.79,15.16L6.67,17.28L1,11.62L3.14,9.5L5.26,11.62L6.67,10.21L3.84,7.38C3.06,6.6 3.06,5.33 3.84,4.55L4.55,3.84C5.33,3.06 6.6,3.06 7.38,3.84L10.21,6.67L11.62,5.26L9.5,3.14L11.62,1M18,14A4,4 0 0,1 14,18V16A2,2 0 0,0 16,14H18M22,14A8,8 0 0,1 14,22V20A6,6 0 0,0 20,14H22Z' />
			</svg>
		)
	}

	export const Connect = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M21.4 7.5C22.2 8.3 22.2 9.6 21.4 10.3L18.6 13.1L10.8 5.3L13.6 2.5C14.4 1.7 15.7 1.7 16.4 2.5L18.2 4.3L21.2 1.3L22.6 2.7L19.6 5.7L21.4 7.5M15.6 13.3L14.2 11.9L11.4 14.7L9.3 12.6L12.1 9.8L10.7 8.4L7.9 11.2L6.4 9.8L3.6 12.6C2.8 13.4 2.8 14.7 3.6 15.4L5.4 17.2L1.4 21.2L2.8 22.6L6.8 18.6L8.6 20.4C9.4 21.2 10.7 21.2 11.4 20.4L14.2 17.6L12.8 16.2L15.6 13.3Z' />
			</svg>
		)
	}

	export const ZoomIn = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M9,2A7,7 0 0,1 16,9C16,10.57 15.5,12 14.61,13.19L15.41,14H16L22,20L20,22L14,16V15.41L13.19,14.61C12,15.5 10.57,16 9,16A7,7 0 0,1 2,9A7,7 0 0,1 9,2M8,5V8H5V10H8V13H10V10H13V8H10V5H8Z' />
			</svg>
		)
	}

	export const ImagePlus = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M18 15V18H15V20H18V23H20V20H23V18H20V15H18M13.3 21H5C3.9 21 3 20.1 3 19V5C3 3.9 3.9 3 5 3H19C20.1 3 21 3.9 21 5V13.3C20.4 13.1 19.7 13 19 13C17.9 13 16.8 13.3 15.9 13.9L14.5 12L11 16.5L8.5 13.5L5 18H13.1C13 18.3 13 18.7 13 19C13 19.7 13.1 20.4 13.3 21Z' />
			</svg>
		)
	}

	export const WandSparkles = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M7.5,5.6L5,7L6.4,4.5L5,2L7.5,3.4L10,2L8.6,4.5L10,7L7.5,5.6M19.5,15.4L22,14L20.6,16.5L22,19L19.5,17.6L17,19L18.4,16.5L17,14L19.5,15.4M22,2L20.6,4.5L22,7L19.5,5.6L17,7L18.4,4.5L17,2L19.5,3.4L22,2M13.34,12.78L15.78,10.34L13.66,8.22L11.22,10.66L13.34,12.78M14.37,7.29L16.71,9.63C17.1,10 17.1,10.65 16.71,11.04L5.04,22.71C4.65,23.1 4,23.1 3.63,22.71L1.29,20.37C0.9,20 0.9,19.35 1.29,18.96L12.96,7.29C13.35,6.9 14,6.9 14.37,7.29Z' />
			</svg>
		)
	}

	export const Meteor = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M21.874 3.486l-4.174 7.514h3.3c.846 0 1.293 .973 .791 1.612l-.074 .085l-6.9 7.095a7.5 7.5 0 1 1 -10.21 -10.974l7.746 -6.58c.722 -.614 1.814 .028 1.628 .958l-.577 2.879l7.11 -3.95c.88 -.488 1.849 .481 1.36 1.36m-12.374 7.515a3.5 3.5 0 0 0 -3.495 3.308l-.005 .192a3.5 3.5 0 1 0 3.5 -3.5' />
			</svg>
		)
	}

	// https://lucide.dev/icons/mouse-pointer-click
	export const MousePointerClick = ({ size = 18, stroke = 2, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill='none' height={size} stroke={color} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M14 4.1 12 6' />
				<path d='m5.1 8-2.9-.8' />
				<path d='m6 12-1.9 2' />
				<path d='M7.2 2.2 8 5.1' />
				<path d='M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z' />
			</svg>
		)
	}

	// https://lucide.dev/icons/crosshair
	export const Crosshair = ({ size = 18, stroke = 2, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill='none' height={size} stroke={color} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<circle cx='12' cy='12' r='10' />
				<line x1='22' x2='18' y1='12' y2='12' />
				<line x1='6' x2='2' y1='12' y2='12' />
				<line x1='12' x2='12' y1='6' y2='2' />
				<line x1='12' x2='12' y1='22' y2='18' />
			</svg>
		)
	}

	export const Pen = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M20.71,7.04C20.37,7.38 20.04,7.71 20.03,8.04C20,8.36 20.34,8.69 20.66,9C21.14,9.5 21.61,9.95 21.59,10.44C21.57,10.93 21.06,11.44 20.55,11.94L16.42,16.08L15,14.66L19.25,10.42L18.29,9.46L16.87,10.87L13.12,7.12L16.96,3.29C17.35,2.9 18,2.9 18.37,3.29L20.71,5.63C21.1,6 21.1,6.65 20.71,7.04M3,17.25L12.56,7.68L16.31,11.43L6.75,21H3V17.25Z' />
			</svg>
		)
	}

	export const Palette = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M17.5,12A1.5,1.5 0 0,1 16,10.5A1.5,1.5 0 0,1 17.5,9A1.5,1.5 0 0,1 19,10.5A1.5,1.5 0 0,1 17.5,12M14.5,8A1.5,1.5 0 0,1 13,6.5A1.5,1.5 0 0,1 14.5,5A1.5,1.5 0 0,1 16,6.5A1.5,1.5 0 0,1 14.5,8M9.5,8A1.5,1.5 0 0,1 8,6.5A1.5,1.5 0 0,1 9.5,5A1.5,1.5 0 0,1 11,6.5A1.5,1.5 0 0,1 9.5,8M6.5,12A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,1 6.5,9A1.5,1.5 0 0,1 8,10.5A1.5,1.5 0 0,1 6.5,12M12,3A9,9 0 0,0 3,12A9,9 0 0,0 12,21A1.5,1.5 0 0,0 13.5,19.5C13.5,19.11 13.35,18.76 13.11,18.5C12.88,18.23 12.73,17.88 12.73,17.5A1.5,1.5 0 0,1 14.23,16H16A5,5 0 0,0 21,11C21,6.58 16.97,3 12,3Z' />
			</svg>
		)
	}

	export const Grid = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M10,4V8H14V4H10M16,4V8H20V4H16M16,10V14H20V10H16M16,16V20H20V16H16M14,20V16H10V20H14M8,20V16H4V20H8M8,14V10H4V14H8M8,8V4H4V8H8M10,14H14V10H10V14M4,2H20A2,2 0 0,1 22,4V20A2,2 0 0,1 20,22H4C2.92,22 2,21.1 2,20V4A2,2 0 0,1 4,2Z' />
			</svg>
		)
	}

	export const FlipHorizontal = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M15 21H17V19H15M19 9H21V7H19M3 5V19C3 20.1 3.9 21 5 21H9V19H5V5H9V3H5C3.9 3 3 3.9 3 5M19 3V5H21C21 3.9 20.1 3 19 3M11 23H13V1H11M19 17H21V15H19M15 5H17V3H15M19 13H21V11H19M19 21C20.1 21 21 20.1 21 19H19Z' />
			</svg>
		)
	}

	export const FlipVertical = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M3 15V17H5V15M15 19V21H17V19M19 3H5C3.9 3 3 3.9 3 5V9H5V5H19V9H21V5C21 3.9 20.1 3 19 3M21 19H19V21C20.1 21 21 20.1 21 19M1 11V13H23V11M7 19V21H9V19M19 15V17H21V15M11 19V21H13V19M3 19C3 20.1 3.9 21 5 21V19Z' />
			</svg>
		)
	}

	export const BringToFront = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M2,2H11V6H9V4H4V9H6V11H2V2M22,13V22H13V18H15V20H20V15H18V13H22M8,8H16V16H8V8Z' />
			</svg>
		)
	}

	export const Stars = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M19,1L17.74,3.75L15,5L17.74,6.26L19,9L20.25,6.26L23,5L20.25,3.75M9,4L6.5,9.5L1,12L6.5,14.5L9,20L11.5,14.5L17,12L11.5,9.5M19,15L17.74,17.74L15,19L17.74,20.25L19,23L20.25,20.25L23,19L20.25,17.74' />
			</svg>
		)
	}

	export const Box = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M19,3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3M19,5V19H5V5H19Z' />
			</svg>
		)
	}

	export const Focus = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M19,19H15V21H19A2,2 0 0,0 21,19V15H19M19,3H15V5H19V9H21V5A2,2 0 0,0 19,3M5,5H9V3H5A2,2 0 0,0 3,5V9H5M5,15H3V19A2,2 0 0,0 5,21H9V19H5V15Z' />
			</svg>
		)
	}

	export const InvertColor = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12,19.58V19.58C10.4,19.58 8.89,18.96 7.76,17.83C6.62,16.69 6,15.19 6,13.58C6,12 6.62,10.47 7.76,9.34L12,5.1M17.66,7.93L12,2.27V2.27L6.34,7.93C3.22,11.05 3.22,16.12 6.34,19.24C7.9,20.8 9.95,21.58 12,21.58C14.05,21.58 16.1,20.8 17.66,19.24C20.78,16.12 20.78,11.05 17.66,7.93Z' />
			</svg>
		)
	}

	export const Swatch = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M20 14H6C3.8 14 2 15.8 2 18S3.8 22 6 22H20C21.1 22 22 21.1 22 20V16C22 14.9 21.1 14 20 14M6 20C4.9 20 4 19.1 4 18S4.9 16 6 16 8 16.9 8 18 7.1 20 6 20M6.3 12L13 5.3C13.8 4.5 15 4.5 15.8 5.3L18.6 8.1C19.4 8.9 19.4 10.1 18.6 10.9L17.7 12H6.3M2 13.5V4C2 2.9 2.9 2 4 2H8C9.1 2 10 2.9 10 4V5.5L2 13.5Z' />
			</svg>
		)
	}

	export const Histogram = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M3,3H5V13H9V7H13V11H17V15H21V21H3V3Z' />
			</svg>
		)
	}

	export const Text = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M21,6V8H3V6H21M3,18H12V16H3V18M3,13H21V11H3V13Z' />
			</svg>
		)
	}

	export const Chart = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M9.96,11.31C10.82,8.1 11.5,6 13,6C14.5,6 15.18,8.1 16.04,11.31C17,14.92 18.1,19 22,19V17C19.8,17 19,14.54 17.97,10.8C17.08,7.46 16.15,4 13,4C9.85,4 8.92,7.46 8.03,10.8C7.03,14.54 6.2,17 4,17V2H2V22H22V20H4V19C7.9,19 9,14.92 9.96,11.31Z' />
			</svg>
		)
	}

	export const ImageEdit = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M22.7 14.3L21.7 15.3L19.7 13.3L20.7 12.3C20.8 12.2 20.9 12.1 21.1 12.1C21.2 12.1 21.4 12.2 21.5 12.3L22.8 13.6C22.9 13.8 22.9 14.1 22.7 14.3M13 19.9V22H15.1L21.2 15.9L19.2 13.9L13 19.9M21 5C21 3.9 20.1 3 19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H11V19.1L12.1 18H5L8.5 13.5L11 16.5L14.5 12L16.1 14.1L21 9.1V5Z' />
			</svg>
		)
	}

	export const FilterWheel = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M19.396 11.056a6 6 0 0 1 -5.647 10.506q .206 -.21 .396 -.44a8 8 0 0 0 1.789 -6.155a8.02 8.02 0 0 0 3.462 -3.911' />
				<path d='M4.609 11.051a7.99 7.99 0 0 0 9.386 4.698a6 6 0 1 1 -9.534 -4.594z' />
				<path d='M12 2a6 6 0 1 1 -6 6l.004 -.225a6 6 0 0 1 5.996 -5.775' />
			</svg>
		)
	}

	export const Brush = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M20.71,4.63L19.37,3.29C19,2.9 18.35,2.9 17.96,3.29L9,12.25L11.75,15L20.71,6.04C21.1,5.65 21.1,5 20.71,4.63M7,14A3,3 0 0,0 4,17C4,18.31 2.84,19 2,19C2.92,20.22 4.5,21 6,21A4,4 0 0,0 10,17A3,3 0 0,0 7,14Z' />
			</svg>
		)
	}

	export const ArrowDown = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M10,4H14V13L17.5,9.5L19.92,11.92L12,19.84L4.08,11.92L6.5,9.5L10,13V4Z' />
			</svg>
		)
	}

	export const ArrowRight = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M4,10V14H13L9.5,17.5L11.92,19.92L19.84,12L11.92,4.08L9.5,6.5L13,10H4Z' />
			</svg>
		)
	}

	export const ArrowUpRight = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M8.5,18.31L5.69,15.5L12.06,9.12H7.11V5.69H18.31V16.89H14.89V11.94L8.5,18.31Z' />
			</svg>
		)
	}

	export const ArrowUpLeft = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M9.12,11.94V16.89H5.69V5.69H16.89V9.12H11.94L18.31,15.5L15.5,18.31L9.12,11.94Z' />
			</svg>
		)
	}

	export const ArrowDownLeft = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M15.5,5.69L18.31,8.5L11.94,14.89H16.89V18.31H5.69V7.11H9.12V12.06L15.5,5.69Z' />
			</svg>
		)
	}

	export const ArrowDownRight = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M14.89,12.06V7.11H18.31V18.31H7.11V14.89H12.06L5.69,8.5L8.5,5.69L14.89,12.06Z' />
			</svg>
		)
	}

	export const Tune = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M3,17V19H9V17H3M3,5V7H13V5H3M13,21V19H21V17H13V15H11V21H13M7,9V11H3V13H7V15H9V9H7M21,13V11H11V13H21M15,9H17V7H21V5H17V3H15V9Z' />
			</svg>
		)
	}

	export const Server = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M4,1H20A1,1 0 0,1 21,2V6A1,1 0 0,1 20,7H4A1,1 0 0,1 3,6V2A1,1 0 0,1 4,1M4,9H20A1,1 0 0,1 21,10V14A1,1 0 0,1 20,15H4A1,1 0 0,1 3,14V10A1,1 0 0,1 4,9M4,17H20A1,1 0 0,1 21,18V22A1,1 0 0,1 20,23H4A1,1 0 0,1 3,22V18A1,1 0 0,1 4,17M9,5H10V3H9V5M9,13H10V11H9V13M9,21H10V19H9V21M5,3V5H7V3H5M5,11V13H7V11H5M5,19V21H7V19H5Z' />
			</svg>
		)
	}

	export const ServerOff = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M4,1H20A1,1 0 0,1 21,2V6A1,1 0 0,1 20,7H8.82L6.82,5H7V3H5V3.18L3.21,1.39C3.39,1.15 3.68,1 4,1M22,22.72L20.73,24L19.73,23H4A1,1 0 0,1 3,22V18A1,1 0 0,1 4,17H13.73L11.73,15H4A1,1 0 0,1 3,14V10A1,1 0 0,1 4,9H5.73L3.68,6.95C3.38,6.85 3.15,6.62 3.05,6.32L1,4.27L2.28,3L22,22.72M20,9A1,1 0 0,1 21,10V14A1,1 0 0,1 20,15H16.82L10.82,9H20M20,17A1,1 0 0,1 21,18V19.18L18.82,17H20M9,5H10V3H9V5M9,13H9.73L9,12.27V13M9,21H10V19H9V21M5,11V13H7V11H5M5,19V21H7V19H5Z' />{' '}
			</svg>
		)
	}

	export const Lock = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M12,17A2,2 0 0,0 14,15C14,13.89 13.1,13 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V10C4,8.89 4.9,8 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3Z' />
			</svg>
		)
	}

	export const LockOpen = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V10A2,2 0 0,1 6,8H15V6A3,3 0 0,0 12,3A3,3 0 0,0 9,6H7A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,17A2,2 0 0,0 14,15A2,2 0 0,0 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17Z' />
			</svg>
		)
	}

	export const Send = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M2,21L23,12L2,3V10L17,12L2,14V21Z' />
			</svg>
		)
	}

	export const CalendarToday = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M7,10H12V15H7M19,19H5V8H19M19,3H18V1H16V3H8V1H6V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3Z' />
			</svg>
		)
	}

	export const RemoteControl = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M9,2C7.89,2 7,2.89 7,4V20C7,21.11 7.89,22 9,22H15C16.11,22 17,21.11 17,20V4C17,2.89 16.11,2 15,2H13V4H11V2H9M11,6H13V8H15V10H13V12H11V10H9V8H11V6M9,14H11V16H9V14M13,14H15V16H13V14M9,18H11V20H9V18M13,18H15V20H13V18Z' />
			</svg>
		)
	}

	export const Info = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z' />
			</svg>
		)
	}

	export const Leaf = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22L6.66,19.7C7.14,19.87 7.64,20 8,20C19,20 22,3 22,3C21,5 14,5.25 9,6.25C4,7.25 2,11.5 2,13.5C2,15.5 3.75,17.25 3.75,17.25C7,8 17,8 17,8Z' />
			</svg>
		)
	}

	export const SnowFlake = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M20.79,13.95L18.46,14.57L16.46,13.44V10.56L18.46,9.43L20.79,10.05L21.31,8.12L19.54,7.65L20,5.88L18.07,5.36L17.45,7.69L15.45,8.82L13,7.38V5.12L14.71,3.41L13.29,2L12,3.29L10.71,2L9.29,3.41L11,5.12V7.38L8.5,8.82L6.5,7.69L5.92,5.36L4,5.88L4.47,7.65L2.7,8.12L3.22,10.05L5.55,9.43L7.55,10.56V13.45L5.55,14.58L3.22,13.96L2.7,15.89L4.47,16.36L4,18.12L5.93,18.64L6.55,16.31L8.55,15.18L11,16.62V18.88L9.29,20.59L10.71,22L12,20.71L13.29,22L14.7,20.59L13,18.88V16.62L15.5,15.17L17.5,16.3L18.12,18.63L20,18.12L19.53,16.35L21.3,15.88L20.79,13.95M9.5,10.56L12,9.11L14.5,10.56V13.44L12,14.89L9.5,13.44V10.56Z' />
			</svg>
		)
	}

	export const Flower = ({ size = 18, stroke = 1, color = 'currentColor', ...props }: IconProps) => {
		return (
			<svg fill={color} height={size} strokeWidth={stroke} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' {...props}>
				<path d='M3,13A9,9 0 0,0 12,22C12,17 7.97,13 3,13M12,5.5A2.5,2.5 0 0,1 14.5,8A2.5,2.5 0 0,1 12,10.5A2.5,2.5 0 0,1 9.5,8A2.5,2.5 0 0,1 12,5.5M5.6,10.25A2.5,2.5 0 0,0 8.1,12.75C8.63,12.75 9.12,12.58 9.5,12.31C9.5,12.37 9.5,12.43 9.5,12.5A2.5,2.5 0 0,0 12,15A2.5,2.5 0 0,0 14.5,12.5C14.5,12.43 14.5,12.37 14.5,12.31C14.88,12.58 15.37,12.75 15.9,12.75C17.28,12.75 18.4,11.63 18.4,10.25C18.4,9.25 17.81,8.4 16.97,8C17.81,7.6 18.4,6.74 18.4,5.75C18.4,4.37 17.28,3.25 15.9,3.25C15.37,3.25 14.88,3.41 14.5,3.69C14.5,3.63 14.5,3.56 14.5,3.5A2.5,2.5 0 0,0 12,1A2.5,2.5 0 0,0 9.5,3.5C9.5,3.56 9.5,3.63 9.5,3.69C9.12,3.41 8.63,3.25 8.1,3.25A2.5,2.5 0 0,0 5.6,5.75C5.6,6.74 6.19,7.6 7.03,8C6.19,8.4 5.6,9.25 5.6,10.25M12,22A9,9 0 0,0 21,13C16,13 12,17 12,22Z' />
			</svg>
		)
	}
}
