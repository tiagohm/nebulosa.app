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
	bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
	close: 'M6 6l12 12M18 6L6 18',
	capture: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 3v5M21 12h-5M12 21v-5M3 12h5',
	images: 'M4 5h16v14H4zM4 16l5-5l4 4l2-2l5 5M15.5 8a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
	sky: 'M12 3l2.6 5.5l6 .8l-4.4 4.2l1.1 6L12 16.6l-5.3 2.9l1.1-6l-4.4-4.2l6-.8z',
	tools: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
	panel: 'M4 5h16v14H4zM15 5v14',
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
