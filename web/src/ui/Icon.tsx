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
	info: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20M12 16v-4M12 8h.01',
	success: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20M8 12l3 3l5-6',
	warning: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0M12 9v4M12 17h.01',
	error: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20M15 9l-6 6M9 9l6 6',
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
	meteor: 'M16.5 6a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M15.5 8.5L4 20M14 6.5L8 12.5M17.5 10L11.5 16',
	sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
	calculator: 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01',
	compass: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M15.5 8.5l-2 5l-5 2l2-5z',
	// The dashed meridian, a target east of it, and the arc it tracks across the meridian with its direction.
	meridian: 'M12 3v2M12 8v2M12 13v2M12 18v3M7.5 9.2A9 9 0 0 1 21 17M19.3 15.3L21 17l1.7-1.7M5.6 9.1a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
	folder: 'M3 6h6l2 2h10v11H3z',
	file: 'M6 3h8l4 4v14H6zM14 3v4h4',
	arrow: 'M12 19V5M6 11l6-6l6 6',
	reticle: 'M12 3v6M12 15v6M3 12h6M15 12h6M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10',
	original: 'M4 5h16v14H4zM12 5v14M12 10l5-5M12 15l8-8M12 19l8-8M16 19l4-4',
	debayer: 'M4 4h16v16H4zM12 4v16M4 12h16',
	stretch: 'M4 4v16h16M4 20C11 20 13 6 20 6',
	contrast: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 3v18M12 7.5h5.5M12 12h9M12 16.5h5.5',
	color: 'M12 3.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M8.5 10a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M15.5 10a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9',
	invert: 'M4 4h16v16H4zM4 20L20 4M10 20l10-10M15 20l5-5',
	play: 'M8 5v14l11-7z',
	pause: 'M8 5v14M16 5v14',
	stop: 'M7 7h10v10H7z',
	stepBack: 'M15 6l-6 6l6 6',
	stepForward: 'M9 6l6 6l-6 6',
	skipToEnd: 'M5 6l6 6l-6 6M11 6l6 6l-6 6M19 5v14',
	save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
	clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2',
	// A tilted elliptic orbit with the central body at its focus and a small body on the orbit.
	orbit: 'M4.21 16.5A9 6.5 -30 1 1 19.79 7.5A9 6.5 -30 1 1 4.21 16.5M4.81 15.11a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M7.25 6.37a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
	layers: 'M12 4l9 5l-9 5l-9-5zM3 14l9 5l9-5',
	stack: 'M9 3h12v12H9zM6 6v12h12M3 9v12h12',
	frame: 'M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M9 9h6v6H9z',
	pin: 'M9 4h6l-1 6l3 3H7l3-3zM12 13v7',
	location: 'M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11zM12 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
	sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
	moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
	// Jupiter: a slightly oblate disk with two belts and the Great Red Spot below the southern one.
	jupiter: 'M4 12a8 7.5 0 1 0 16 0a8 7.5 0 1 0-16 0M4.5 9.5h15M4.3 14h15.4M13 16.4a1.5 1 0 1 0 3 0a1.5 1 0 1 0-3 0',
	// Saturn: a small disk crossed by a tilted ring.
	saturn: 'M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0M2 15.6A10.4 3.4 -20 1 0 22 8.4A10.4 3.4 -20 1 0 2 15.6',
	cloud: 'M7 18.5a4.5 4.5 0 0 1-.7-8.95A6 6 0 0 1 17.8 8.6a5 5 0 0 1-.8 9.9z',
	server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01M12 7h4M12 17h4',
	grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
	plus: 'M12 5v14M5 12h14',
	duplicate: 'M9 9h11v11H9zM15 9V4H4v11h5',
	trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
	edit: 'M4 20v-4L15 5l4 4L8 20zM13 7l4 4',
	// A video camera: its body and the lens cone.
	video: 'M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5',
	// Arrows out to two opposite corners.
	expand: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
	// A small window inside a larger one.
	pictureInPicture: 'M3 5h18v14H3zM12 12h7v5h-7z',
	// A window docked at the bottom left of the screen.
	dock: 'M3 5h18v14H3zM5 13h7v4H5z',
	// Three dots in a row: more entries than the row has room for.
	more: 'M3.75 12a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0-2.5 0M10.75 12a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0-2.5 0M17.75 12a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0-2.5 0',
	// A histogram of pixel values over its baseline.
	histogram: 'M3 20h18M5.5 20v-3M8.5 20v-7M11.5 20V5M14.5 20v-9M17.5 20v-5',
	// A framed image crossed by curved lines of right ascension and declination.
	plateSolve: 'M4 4h16v16H4zM4 10c5-2 11-2 16 0M4 15.5c5-2 11-2 16 0M10 4c-1.5 5-1.5 11 0 16M15 4c1.5 5 1.5 11 0 16',
	// Three stars, each ringed by its detection circle.
	starDetection: 'M4 8a3 3 0 1 0 6 0a3 3 0 1 0-6 0M7 8h.01M14 6a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M16.5 6h.01M10.5 16a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M14 16h.01',
	// The radial profile of a star, a bell over its baseline, with its full width at half maximum.
	starProfile: 'M2 19.5c4 0 5.5-1 7-6.5s1.5-7 3-7s1.5 1.5 3 7s3 6.5 7 6.5M9 13h6M9 11.5v3M15 11.5v3',
	// A trail crossing the field between detection corners, among point-like stars.
	streakDetection: 'M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M7.5 16.5l9-9M7 8h.01M17 16.5h.01M12.5 17h.01',
	// An object ringed and labeled by a leader line.
	annotation: 'M5 16a3 3 0 1 0 6 0a3 3 0 1 0-6 0M10.2 13.8L15 9h6M15 5.5h6',
	// A wand with sparkles: transforms that produce a new image.
	wand: 'M4 20l10-10M14 10l2-2M17 2.5v3M15.5 4h3M20.5 8v2M19.5 9h2M10.5 3.5v2M9.5 4.5h2',
	// The blades of a camera aperture: an exposure.
	shutter: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20M14.31 8l5.74 9.94M9.69 8h11.48M7.38 12l5.74-9.94M9.69 16L3.95 6.06M14.31 16H2.83M16.62 12l-5.74 9.94',
	// Stacked frames with a play mark: frames integrated as they arrive.
	liveStack: 'M8 3h13v13H8zM5 6v13h13M2 9v13h13M12.5 6.5v6l5-3z',
	// A focus curve, its samples, and the best focus at its minimum.
	focusCurve: 'M3 3v18h18M6.5 5Q12.5 25 18.5 5M8.15 12.5a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M11.3 15a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M14.45 12.5a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0',
	// Arrows to the four directions.
	move: 'M12 3v18M3 12h18M9 6l3-3l3 3M9 18l3 3l3-3M6 9l-3 3l3 3M18 9l3 3l-3 3',
	// A guide star locked inside its tracking box.
	guideStar: 'M7 7h10v10H7zM12 3v4M12 17v4M3 12h4M17 12h4M12 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
	// The V-shaped trail of a star drifting east and back west.
	darv: 'M5.5 6.5L12 19l6.5-12.5M3 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
	// Three points on the arc the mount turns about the pole.
	threePoint: 'M5.07 17A8 8 0 1 1 18.93 17M3.57 17a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M10.5 5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M17.43 17a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M12 11v4M10 13h4',
	// A polar scope reticle with the polestar on its circle.
	polarScope: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M14.04 8.46a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
	// Points spread over the sky dome, above the horizon.
	pointingModel: 'M2 18h20M3 18a9 9 0 0 1 18 0M7 15a1 1 0 1 0 2 0a1 1 0 1 0-2 0M11 15a1 1 0 1 0 2 0a1 1 0 1 0-2 0M15 15a1 1 0 1 0 2 0a1 1 0 1 0-2 0M9 11.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0M13 11.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
	// A bullseye with an arrow reaching its center.
	target: 'M11 5a8 8 0 1 0 0 16a8 8 0 1 0 0-16M11 9a4 4 0 1 0 0 8a4 4 0 1 0 0-8M11 13l9-9M11 13h4M11 13V9M17 4v3h3',
	// An evenly lit frame with light around it.
	flatField: 'M7 7h10v10H7zM12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8',
	// Two stacked frames with a crescent: frames taken in the dark, kept for later.
	darkLibrary: 'M8 3h13v13H8zM5 6v13h13M17.86 10.55A3.36 3.36 0 1 1 13.45 6.14a2.73 2.73 0 0 0 4.41 4.41z',
	// The Sun with the edge of the Moon crossing its disk.
	solarEclipse: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10M10.79 7.15A5 5 0 0 0 15.71 15.35M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8',
	// The Moon entering the shadow of the Earth, the shaded part hatched.
	lunarEclipse: 'M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14M10.82 5.1A12 12 0 0 1 10.82 18.9M6.5 10l3.5-3.5M6 14.5l5.5-5.5M8 17l4-4',
	// A small body passing close to the Earth along its trajectory.
	closeApproach: 'M4 17a4 4 0 1 0 8 0a4 4 0 1 0-8 0M2 5.5Q8 9 12.5 9.6M12.5 9.7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18.5 9.4h.5M21 9h.5',
	// A cloud in front of a crescent Moon: the night's weather.
	cloudMoon: 'M10.2 8.5A6 6 0 0 1 16 4a4.5 4.5 0 0 0 6 6a6 6 0 0 1-3 5.2M13 16a3 3 0 1 1 0 6H7a5 5 0 1 1 4.9-6z',
	// Two planets lined up with the Sun on their orbits.
	planetAlignment: 'M1.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M10.13 6.86A8 8 0 0 1 10.13 17.14M15.49 2.36A15 15 0 0 1 15.49 21.64M10.2 12a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M16.8 12a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0',
	// A satellite: its body, two solar panels, and its antenna.
	satellite: 'M10 9h4v6h-4zM2.5 10h5v4h-5zM16.5 10h5v4h-5zM5 10v4M19 10v4M7.5 12H10M14 12h2.5M12 9V6M10.5 6h3',
	// An archive box: indexed frames kept for reuse.
	archive: 'M3 4h18v5H3zM5 9v11h14V9M10 13h4',
	// A remote control with its directional pad, sending a signal.
	remote: 'M8 9.5h8v11.5H8zM12 12.5v3M10.5 14h3M10.5 18.5h3M9.2 6.2a4 4 0 0 1 5.6 0M6.4 3.4a8 8 0 0 1 11.2 0',
	// A security camera on its wall bracket.
	cctv: 'M4.5 4.2l12.6 5.6l-2.7 6l-12.6-5.6zM17.1 9.8l3.4.6l-1.6 4.6l-3.2-1.5M7.8 13l-1 4.5H2.5M2.5 15v5M13 12.5h.01',
	// A database cylinder: stored ephemeris files.
	database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3s-3.6 3-8 3s-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
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
