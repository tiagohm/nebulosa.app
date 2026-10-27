import { cn } from 'cn'

// Shared line icons: the SVG path data of every icon in the application and the component that draws
// them, so the same glyph is reused instead of being redrawn inline.

// SVG path data of each icon, drawn in a 24×24 box with round caps and joins. The device-type icons are
// keyed by their device type, so a device type can name its icon directly.
export const ICONS = {
	camera: 'M4 7h3l1.5-2h7L17 7h3v12H4zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7',
	mount: 'M3.5 12.5L15 7l1.5 3L5 15.5zM15 7l3-1.5l1.5 3l-3 1.5M10.5 13.5V16M10.5 16L7 21M10.5 16L14 21M10.5 16v5',
	guideOutput: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
	focuser: 'M4 10h12v4H4zM16 8h4v8h-4zM8 6v4M8 14v4',
	wheel: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 6.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3M7 11.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3M17 11.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3M12 14.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
	rotator: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
	dome: 'M4 18a8 8 0 0 1 16 0M3 18h18M11 10.1V18M13 10.1V18',
	cover: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M8 12h8',
	flatPanel: 'M4 8h16v11H4zM8 4l1 2M12 3v3M16 4l-1 2',
	dewHeater: 'M5 20h14M8 4c-1.5 2 1.5 3 0 5s1.5 3 0 5M12 4c-1.5 2 1.5 3 0 5s1.5 3 0 5M16 4c-1.5 2 1.5 3 0 5s1.5 3 0 5',
	bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
	settings:
		'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
	close: 'M6 6l12 12M18 6L6 18',
	images: 'M4 5h16v14H4zM4 16l5-5l4 4l2-2l5 5M15.5 8a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
	sky: 'M12 3l2.6 5.5l6 .8l-4.4 4.2l1.1 6L12 16.6l-5.3 2.9l1.1-6l-4.4-4.2l6-.8z',
	tools: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
	panel: 'M4 5h16v14H4zM15 5v14',
	zoomIn: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.5 15.5L20 20M10.5 7.5v6M7.5 10.5h6',
	zoomOut: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.5 15.5L20 20M7.5 10.5h6',
	fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
	actualSize: 'M4 5h16v14H4zM8.5 9.5L10 8.5v7M14 9.5l1.5-1v7M12 11v.01M12 14v.01',
	streak: 'M4 20L20 4M9 20L20 9M4 15L15 4',
	sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
	calculator: 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01',
	compass: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M15.5 8.5l-2 5l-5 2l2-5z',
	folder: 'M3 6h6l2 2h10v11H3z',
	file: 'M6 3h8l4 4v14H6zM14 3v4h4',
	arrow: 'M12 19V5M6 11l6-6l6 6',
	reticle: 'M12 3v6M12 15v6M3 12h6M15 12h6M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10',
	original: 'M4 5h16v14H4zM12 5v14M12 10l5-5M12 15l8-8M12 19l8-8M16 19l4-4',
	play: 'M8 5v14l11-7z',
	pause: 'M8 5v14M16 5v14',
	stop: 'M7 7h10v10H7z',
	stepBack: 'M15 6l-6 6l6 6',
	stepForward: 'M9 6l6 6l-6 6',
	skipToEnd: 'M5 6l6 6l-6 6M11 6l6 6l-6 6M19 5v14',
	save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
	clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2',
	layers: 'M12 4l9 5l-9 5l-9-5zM3 14l9 5l9-5',
	frame: 'M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M9 9h6v6H9z',
	pin: 'M9 4h6l-1 6l3 3H7l3-3zM12 13v7',
	sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
	moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
	server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01M12 7h4M12 17h4',
} as const satisfies Readonly<Record<string, string>>

// Name of an icon in ICONS.
export type IconName = keyof typeof ICONS

export interface IconProps {
	// Icon to draw.
	readonly name: IconName
	// Classes of the SVG; sets its size, which defaults to 20 px, and its color through text color.
	readonly className?: string
	// Stroke width in units of the 24×24 box; the rendered width scales with the icon size.
	readonly strokeWidth?: number
}

// Decorative line icon stroked with the current text color.
export function Icon({ name, className, strokeWidth = 1.5 }: IconProps) {
	return (
		<svg viewBox="0 0 24 24" className={cn('size-5 flex-none', className)} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
			<path d={ICONS[name]} />
		</svg>
	)
}
