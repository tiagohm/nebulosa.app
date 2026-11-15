// Layout of the camera model catalog the Equipment Catalog editor offers to fill a camera from: the cameras of the AstroBin
// equipment database and the unbinned sensor of each one, written by `bun make:cameras` into web/assets/cameras.json.gz and
// read by the web client. Nothing on the server reads it; the layout lives here so the generator and the client share it.

// Version of the catalog layout; the generator writes it and a reader of another version rejects the file.
export const CAMERA_MODEL_CATALOG_SCHEMA = 1

// One camera model and the sensor it declares.
export interface CameraModel {
	// Brand and name of the camera, as AstroBin lists them, such as "ZWO ASI2600MM Pro"; unique without regard to case.
	readonly model: string
	// Brand and name of its sensor, such as "Sony IMX571"; absent when AstroBin names none.
	readonly sensor?: string
	// Unbinned width and height of the full sensor, in pixels; whole and > 0.
	readonly width: number
	readonly height: number
	// Pixel size, in micrometers; > 0; absent when not declared.
	readonly pixelSize?: number
	// Bits per sample of the ADC, 1 to 32; absent when not declared.
	readonly bits?: number
	// Whether the sensor is a color (true) or a mono (false) one; absent when not declared. AstroBin never gives the CFA
	// pattern of a color sensor.
	readonly color?: boolean
}

// Camera model catalog file.
export interface CameraModelCatalog {
	// Layout version, CAMERA_MODEL_CATALOG_SCHEMA.
	readonly schema: number
	// When the file was generated, ISO 8601.
	readonly generatedAt: string
	// URL of the database the models were read from; absent for the empty catalog of `bun make:cameras --empty`.
	readonly source?: string
	// Every camera model with a declared sensor, sorted by model without regard to case.
	readonly models: readonly CameraModel[]
}
