import type { Mat3 } from 'nebulosa/src/math/linear-algebra/mat3'
import type { Vec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { type DiscViewport, discToBody, EARTHSHINE, sunlight, TERMINATOR_END, TERMINATOR_START, textureCoordinates } from './moon.geometry'

// Renderer of the Moon drawings: an orthographic sphere textured with the NASA color map, lit from the Sun's
// body-fixed direction, through the view matrix and viewport of moon.geometry.ts, so the markers drawn over it
// line up. WebGL2 draws one full-canvas triangle whose fragment shader inverts the projection per pixel; without
// WebGL2 (or after its context is lost for good) the same math runs on the CPU into a 2D canvas at a capped
// resolution. A frame is drawn only when render is called, never in a loop. The texture's colors are illustrative:
// they are multiplied in sRGB as NASA encoded them.

// Largest side, in device pixels, of a CPU-rendered frame; larger canvases are upscaled by the browser.
const CPU_MAX_SIDE = 768

// Vertex shader: one triangle covering the clip space.
const VERTEX_SHADER = `#version 300 es
void main() {
	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

// Fragment shader: the inverse orthographic projection of moon.geometry.ts (discToBody, textureCoordinates,
// sunlight), with an antialiased limb.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uTexture;
uniform mat3 uCameraToBody;
uniform vec3 uSun;
uniform vec2 uCenter;
uniform float uRadius;
out vec4 color;
const float PI = 3.141592653589793;
void main() {
	vec2 p = (gl_FragCoord.xy - uCenter) / uRadius;
	float r = length(p);
	if (r > 1.0 + 1.0 / uRadius) discard;
	vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r * r)));
	vec3 b = uCameraToBody * n;
	vec2 uv = vec2(atan(b.y, b.x) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(b.z, -1.0, 1.0)) / PI);
	float t = clamp((dot(b, uSun) - ${TERMINATOR_START.toFixed(4)}) / (${TERMINATOR_END.toFixed(4)} - ${TERMINATOR_START.toFixed(4)}), 0.0, 1.0);
	float light = ${EARTHSHINE.toFixed(4)} + (1.0 - ${EARTHSHINE.toFixed(4)}) * t * t * (3.0 - 2.0 * t);
	float alpha = clamp((1.0 - r) * uRadius + 0.5, 0.0, 1.0);
	color = vec4(texture(uTexture, uv).rgb * light * alpha, alpha);
}`

// What a frame draws.
export interface MoonScene {
	// Rotation from the body-fixed frame to the drawn view (moon.geometry.ts viewMatrix).
	readonly view: Mat3
	// Unit vector toward the Sun in the body-fixed frame.
	readonly sun: Vec3
	// Where the disk is, in CSS pixels.
	readonly viewport: DiscViewport
	// Device pixels per CSS pixel.
	readonly pixelRatio: number
}

// Pixels of a texture, RGBA row by row from the top-left.
export interface MoonTexturePixels {
	// RGBA samples.
	readonly data: Uint8ClampedArray
	// Width in pixels.
	readonly width: number
	// Height in pixels.
	readonly height: number
}

// Draws a scene into RGBA pixels of a frame of a size in pixels, scaling the CSS viewport by `scale` device pixels
// per CSS pixel, sampling the texture at its nearest pixel. Pixels off the disk are left transparent.
export function renderMoonPixels(target: Uint8ClampedArray, width: number, height: number, texture: MoonTexturePixels, scene: Omit<MoonScene, 'pixelRatio'>, scale: number) {
	target.fill(0)
	const { centerX, centerY, radius } = scene.viewport
	const r = radius * scale
	const x0 = Math.max(0, Math.floor(centerX * scale - r))
	const x1 = Math.min(width, Math.ceil(centerX * scale + r))
	const y0 = Math.max(0, Math.floor(centerY * scale - r))
	const y1 = Math.min(height, Math.ceil(centerY * scale + r))

	for (let py = y0; py < y1; py++) {
		const y = (centerY * scale - (py + 0.5)) / r

		for (let px = x0; px < x1; px++) {
			const body = discToBody(scene.view, (px + 0.5 - centerX * scale) / r, y)
			if (!body) continue

			const [u, v] = textureCoordinates(body)
			const tx = Math.min(texture.width - 1, Math.floor(u * texture.width))
			const ty = Math.min(texture.height - 1, Math.floor(v * texture.height))
			const source = (ty * texture.width + tx) * 4
			const light = sunlight(body, scene.sun)
			const index = (py * width + px) * 4
			target[index] = texture.data[source] * light
			target[index + 1] = texture.data[source + 1] * light
			target[index + 2] = texture.data[source + 2] * light
			target[index + 3] = 255
		}
	}
}

// GPU resources of a WebGL2 context.
interface GpuState {
	// Context.
	readonly gl: WebGL2RenderingContext
	// Linked program.
	readonly program: WebGLProgram
	// Texture of the color map, once uploaded.
	texture?: WebGLTexture
	// Uniform locations.
	readonly uniforms: { readonly texture: WebGLUniformLocation | null; readonly cameraToBody: WebGLUniformLocation | null; readonly sun: WebGLUniformLocation | null; readonly center: WebGLUniformLocation | null; readonly radius: WebGLUniformLocation | null }
}

// Compiles and links the program of a context, throwing with the driver's log on failure.
function createProgram(gl: WebGL2RenderingContext) {
	const program = gl.createProgram()

	for (const [type, source] of [
		[gl.VERTEX_SHADER, VERTEX_SHADER],
		[gl.FRAGMENT_SHADER, FRAGMENT_SHADER],
	] as const) {
		const shader = gl.createShader(type)!
		gl.shaderSource(shader, source)
		gl.compileShader(shader)
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`Moon shader: ${gl.getShaderInfoLog(shader)}`)
		gl.attachShader(program, shader)
		gl.deleteShader(shader)
	}

	gl.linkProgram(program)
	if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`Moon program: ${gl.getProgramInfoLog(program)}`)
	return program
}

// Renderer of one canvas. Call setTexture with the color map, render with each new scene, and dispose when the
// canvas goes away.
export class MoonRenderer {
	readonly #canvas: HTMLCanvasElement
	#gpu?: GpuState
	readonly #context2d?: CanvasRenderingContext2D
	#image?: TexImageSource
	#pixels?: MoonTexturePixels
	#scene?: MoonScene
	#frame = 0

	// Whether frames are drawn on the CPU because WebGL2 is unavailable.
	get fallback() {
		return !this.#gpu
	}

	// Creates the renderer of a canvas, on WebGL2 when the browser offers it.
	constructor(canvas: HTMLCanvasElement) {
		this.#canvas = canvas
		canvas.addEventListener('webglcontextlost', this.#lost)
		canvas.addEventListener('webglcontextrestored', this.#restored)
		this.#gpu = this.#createGpu()
		if (!this.#gpu) this.#context2d = canvas.getContext('2d') ?? undefined
	}

	// Sets the color map drawn from the next frame on.
	setTexture(image: TexImageSource) {
		this.#image = image
		this.#pixels = undefined
		if (this.#gpu) this.#upload(this.#gpu, image)
		this.#schedule()
	}

	// Draws a scene on the next animation frame; several calls before it draw only the last one.
	render(scene: MoonScene) {
		this.#scene = scene
		this.#schedule()
	}

	// Releases the GPU resources and the listeners.
	dispose() {
		cancelAnimationFrame(this.#frame)
		this.#canvas.removeEventListener('webglcontextlost', this.#lost)
		this.#canvas.removeEventListener('webglcontextrestored', this.#restored)

		if (this.#gpu && !this.#gpu.gl.isContextLost()) {
			this.#gpu.gl.deleteTexture(this.#gpu.texture ?? null)
			this.#gpu.gl.deleteProgram(this.#gpu.program)
		}

		this.#gpu = undefined
		this.#image = undefined
		this.#pixels = undefined
	}

	// Creates the WebGL2 resources; undefined when WebGL2 is unavailable.
	#createGpu(): GpuState | undefined {
		const gl = this.#canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false })
		if (!gl) return undefined

		const program = createProgram(gl)
		const uniform = (name: string) => gl.getUniformLocation(program, name)
		const gpu: GpuState = { gl, program, uniforms: { texture: uniform('uTexture'), cameraToBody: uniform('uCameraToBody'), sun: uniform('uSun'), center: uniform('uCenter'), radius: uniform('uRadius') } }
		if (this.#image) this.#upload(gpu, this.#image)
		return gpu
	}

	// Uploads the color map with mipmaps, wrapping in longitude.
	#upload(gpu: GpuState, image: TexImageSource) {
		const { gl } = gpu
		if (gpu.texture) gl.deleteTexture(gpu.texture)
		const texture = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D, texture)
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image)
		gl.generateMipmap(gl.TEXTURE_2D)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gpu.texture = texture
	}

	// Asks for one frame.
	#schedule() {
		cancelAnimationFrame(this.#frame)
		this.#frame = requestAnimationFrame(() => this.#draw())
	}

	// Draws the last scene, if there is a scene and a texture.
	#draw() {
		const scene = this.#scene
		if (!scene || !this.#image) return

		const width = Math.max(1, Math.round(scene.viewport.width * scene.pixelRatio))
		const height = Math.max(1, Math.round(scene.viewport.height * scene.pixelRatio))

		if (this.#gpu) {
			if (this.#canvas.width !== width || this.#canvas.height !== height) {
				this.#canvas.width = width
				this.#canvas.height = height
			}

			this.#drawGpu(this.#gpu, scene)
		} else if (this.#context2d) {
			this.#drawCpu(this.#context2d, scene, width, height)
		}
	}

	// Draws a scene with WebGL2.
	#drawGpu({ gl, program, texture, uniforms }: GpuState, scene: MoonScene) {
		if (gl.isContextLost() || !texture) return
		const { viewport, pixelRatio } = scene
		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
		gl.clearColor(0, 0, 0, 0)
		gl.clear(gl.COLOR_BUFFER_BIT)
		gl.useProgram(program)
		gl.activeTexture(gl.TEXTURE0)
		gl.bindTexture(gl.TEXTURE_2D, texture)
		gl.uniform1i(uniforms.texture, 0)
		// The row-major view matrix read as column-major is its transpose, the view-to-body rotation.
		gl.uniformMatrix3fv(uniforms.cameraToBody, false, scene.view)
		gl.uniform3fv(uniforms.sun, scene.sun)
		gl.uniform2f(uniforms.center, viewport.centerX * pixelRatio, gl.drawingBufferHeight - viewport.centerY * pixelRatio)
		gl.uniform1f(uniforms.radius, viewport.radius * pixelRatio)
		gl.drawArrays(gl.TRIANGLES, 0, 3)
	}

	// Draws a scene on the CPU, at most CPU_MAX_SIDE pixels on a side.
	#drawCpu(context: CanvasRenderingContext2D, scene: MoonScene, width: number, height: number) {
		const scale = Math.min(1, CPU_MAX_SIDE / Math.max(width, height))
		const w = Math.max(1, Math.round(width * scale))
		const h = Math.max(1, Math.round(height * scale))
		this.#pixels ??= texturePixels(this.#image!)

		if (this.#canvas.width !== w || this.#canvas.height !== h) {
			this.#canvas.width = w
			this.#canvas.height = h
		}

		const frame = context.createImageData(w, h)
		renderMoonPixels(frame.data, w, h, this.#pixels, scene, scene.pixelRatio * scale)
		context.putImageData(frame, 0, 0)
	}

	// Stops drawing until the context is restored.
	readonly #lost = (event: Event) => {
		event.preventDefault()
		cancelAnimationFrame(this.#frame)
	}

	// Recreates the GPU resources and draws the last scene again.
	readonly #restored = () => {
		this.#gpu = this.#createGpu()
		this.#schedule()
	}
}

// Reads the pixels of a color map through a 2D canvas, for the CPU renderer.
function texturePixels(image: TexImageSource): MoonTexturePixels {
	const width = 'naturalWidth' in image ? image.naturalWidth : (image as { width: number }).width
	const height = 'naturalHeight' in image ? image.naturalHeight : (image as { height: number }).height
	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const context = canvas.getContext('2d')!
	context.drawImage(image as CanvasImageSource, 0, 0)
	return { data: context.getImageData(0, 0, width, height).data, width, height }
}
