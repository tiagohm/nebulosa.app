export type ImageCalibrationFileType = Exclude<keyof ImageCalibration, 'enabled'>

export interface ImageCalibration {
	enabled: boolean
	readonly dark: ImageCalibrationFile
	readonly flat: ImageCalibrationFile
	readonly bias: ImageCalibrationFile
	readonly darkFlat: ImageCalibrationFile
}

export interface ImageCalibrationFile {
	enabled: boolean
	path?: string
}

export const DEFAULT_IMAGE_CALIBRATION: ImageCalibration = {
	enabled: false,
	dark: {
		enabled: false,
	},
	flat: {
		enabled: false,
	},
	bias: {
		enabled: false,
	},
	darkFlat: {
		enabled: false,
	},
}
