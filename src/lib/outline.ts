import type { Rgb } from './types'

export type OutlineSettings = {
  /** Edge sensitivity 0–100 (higher = more internal detail lines). */
  sensitivity: number
  /** Stroke thickness in pixels (1–6). */
  thickness: number
  /** Invert: white strokes on transparent instead of black. */
  invert: boolean
  /** Max working dimension when outlining from a raw image. */
  maxDim: number
}

export const DEFAULT_OUTLINE_SETTINGS: OutlineSettings = {
  // User default — strong structural detail without mush
  sensitivity: 80,
  thickness: 2,
  invert: false,
  maxDim: 1400,
}

export type OutlineResult = {
  pngBlob: Blob
  pngUrl: string
  widthPx: number
  heightPx: number
}

/**
 * Build a crisp stroke PNG from a quantized label map.
 * Lines are drawn only where two different fills meet (or fill meets transparent)
 * — same structure as pin metal walls. No Canny texture noise.
 */
export async function extractOutlineFromLabels(
  labels: Uint16Array,
  width: number,
  height: number,
  settings: OutlineSettings,
): Promise<OutlineResult> {
  const n = width * height
  let mask = new Uint8Array(n)

  // Draw a 1px wall wherever neighboring labels differ (fill↔fill or fill↔void)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x
      const a = labels[i]
      const b = labels[i + 1]
      if (a !== b && (a !== 0xffff || b !== 0xffff)) {
        if (a !== 0xffff) mask[i] = 255
        if (b !== 0xffff) mask[i + 1] = 255
      }
    }
  }
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const a = labels[i]
      const b = labels[i + width]
      if (a !== b && (a !== 0xffff || b !== 0xffff)) {
        if (a !== 0xffff) mask[i] = 255
        if (b !== 0xffff) mask[i + width] = 255
      }
    }
  }

  // Sensitivity: lower = only strongest boundaries (longer continuous runs)
  // Higher = keep all boundaries. Filter short internal strokes when low.
  if (settings.sensitivity < 70) {
    const minLen = Math.round(8 + ((70 - settings.sensitivity) / 70) * 40)
    mask = keepLargeComponents(mask, width, height, minLen)
  }

  const thickness = Math.max(1, Math.min(6, Math.round(settings.thickness)))
  if (thickness > 1) {
    mask = dilate(mask, width, height, thickness - 1)
  }

  return rasterizeMask(mask, width, height, settings.invert)
}

/**
 * Fallback: simple contrast edges from the source image when no labels exist.
 * Much less aggressive than full Canny — keeps something visible.
 */
export async function extractOutlinePng(
  source: HTMLImageElement | ImageBitmap,
  settings: OutlineSettings,
): Promise<OutlineResult> {
  const srcW = 'naturalWidth' in source ? source.naturalWidth : source.width
  const srcH = 'naturalHeight' in source ? source.naturalHeight : source.height
  const scale = Math.min(1, settings.maxDim / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)
  const src = ctx.getImageData(0, 0, w, h)
  const n = w * h

  const gray = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    // Treat near-white as uniform so paper grain isn't edged
    const y = 0.299 * src.data[o] + 0.587 * src.data[o + 1] + 0.114 * src.data[o + 2]
    gray[i] = y > 248 ? 255 : y
  }

  // Stronger blur kills grain before Sobel
  const blurred = boxBlurGray(gray, w, h, 2)
  const gxArr = new Float32Array(n)
  const gyArr = new Float32Array(n)
  const mag = new Float32Array(n)
  let maxMag = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx =
        -blurred[i - w - 1] +
        blurred[i - w + 1] -
        2 * blurred[i - 1] +
        2 * blurred[i + 1] -
        blurred[i + w - 1] +
        blurred[i + w + 1]
      const gy =
        -blurred[i - w - 1] -
        2 * blurred[i - w] -
        blurred[i - w + 1] +
        blurred[i + w - 1] +
        2 * blurred[i + w] +
        blurred[i + w + 1]
      gxArr[i] = gx
      gyArr[i] = gy
      const m = Math.hypot(gx, gy)
      mag[i] = m
      if (m > maxMag) maxMag = m
    }
  }

  if (maxMag < 1e-6) {
    return rasterizeMask(new Uint8Array(n), w, h, settings.invert)
  }

  // NMS → thin crisp ridges (less grainy blobs)
  const thin = nonMaxSuppress(mag, gxArr, gyArr, w, h)

  // Higher sensitivity → lower threshold (more detail). Default 80 keeps structure.
  const t = 1 - settings.sensitivity / 100
  const high = maxMag * (0.1 + t * 0.38)
  const low = high * 0.4

  const edge = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (thin[i] >= high) edge[i] = 2
    else if (thin[i] >= low) edge[i] = 1
  }

  // Hysteresis
  const stack: number[] = []
  for (let i = 0; i < n; i++) if (edge[i] === 2) stack.push(i)
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    const y = (i / w) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const ni = ny * w + nx
        if (edge[ni] === 1) {
          edge[ni] = 2
          stack.push(ni)
        }
      }
    }
  }

  let mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) mask[i] = edge[i] === 2 ? 255 : 0

  // Drop dust / freckles; keep real strokes (scale with sensitivity)
  const minComp = Math.max(
    8,
    Math.round(w * h * (0.00004 + (100 - settings.sensitivity) * 0.0000015)),
  )
  mask = keepLargeComponents(mask, w, h, minComp)
  // Morphological open: kill single-pixel grain then restore stroke body
  mask = erode(mask, w, h, 1)
  mask = dilate(mask, w, h, 1)

  const thickness = Math.max(1, Math.min(6, Math.round(settings.thickness)))
  if (thickness > 1) mask = dilate(mask, w, h, thickness - 1)

  return rasterizeMask(mask, w, h, settings.invert)
}

function nonMaxSuppress(
  mag: Float32Array,
  gx: Float32Array,
  gy: Float32Array,
  w: number,
  h: number,
): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const m = mag[i]
      if (m <= 0) continue
      const angle = (Math.atan2(gy[i], gx[i]) * 180) / Math.PI
      const a = angle < 0 ? angle + 180 : angle
      let m1 = 0
      let m2 = 0
      if ((a >= 0 && a < 22.5) || (a >= 157.5 && a <= 180)) {
        m1 = mag[i - 1]
        m2 = mag[i + 1]
      } else if (a >= 22.5 && a < 67.5) {
        m1 = mag[i - w + 1]
        m2 = mag[i + w - 1]
      } else if (a >= 67.5 && a < 112.5) {
        m1 = mag[i - w]
        m2 = mag[i + w]
      } else {
        m1 = mag[i - w - 1]
        m2 = mag[i + w + 1]
      }
      if (m >= m1 * 0.96 && m >= m2 * 0.96) out[i] = m
    }
  }
  return out
}

function erode(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      let keep = true
      for (let dy = -radius; dy <= radius && keep; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) {
            keep = false
            break
          }
        }
      }
      if (keep) out[y * w + x] = 255
    }
  }
  return out
}

async function rasterizeMask(
  mask: Uint8Array,
  w: number,
  h: number,
  invert: boolean,
): Promise<OutlineResult> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const out = ctx.createImageData(w, h)
  const stroke: Rgb = invert
    ? { r: 255, g: 255, b: 255 }
    : { r: 16, g: 14, b: 12 }

  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    if (mask[i]) {
      out.data[o] = stroke.r
      out.data[o + 1] = stroke.g
      out.data[o + 2] = stroke.b
      out.data[o + 3] = 255
    } else {
      out.data[o + 3] = 0
    }
  }
  ctx.putImageData(out, 0, 0)

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode outline PNG'))),
      'image/png',
    )
  })

  return {
    pngBlob,
    pngUrl: URL.createObjectURL(pngBlob),
    widthPx: w,
    heightPx: h,
  }
}

function keepLargeComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  minSize: number,
): Uint8Array {
  const n = w * h
  const seen = new Uint8Array(n)
  const out = new Uint8Array(n)
  const qx = new Int32Array(n)
  const qy = new Int32Array(n)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x
      if (!mask[start] || seen[start]) continue

      let head = 0
      let tail = 0
      qx[tail] = x
      qy[tail] = y
      tail++
      seen[start] = 1
      const pixels: number[] = [start]

      while (head < tail) {
        const cx = qx[head]
        const cy = qy[head]
        head++
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const ni = ny * w + nx
            if (!mask[ni] || seen[ni]) continue
            seen[ni] = 1
            qx[tail] = nx
            qy[tail] = ny
            tail++
            pixels.push(ni)
          }
        }
      }

      if (pixels.length >= minSize) {
        for (const p of pixels) out[p] = 255
      }
    }
  }
  return out
}

function boxBlurGray(
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  if (radius <= 0) return src
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const span = radius * 2 + 1

  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let x = -radius; x <= radius; x++) {
      const cx = Math.min(w - 1, Math.max(0, x))
      sum += src[y * w + cx]
    }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / span
      const leave = Math.min(w - 1, Math.max(0, x - radius))
      const enter = Math.min(w - 1, Math.max(0, x + radius + 1))
      sum += src[y * w + enter] - src[y * w + leave]
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) {
      const cy = Math.min(h - 1, Math.max(0, y))
      sum += tmp[cy * w + x]
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span
      const leave = Math.min(h - 1, Math.max(0, y - radius))
      const enter = Math.min(h - 1, Math.max(0, y + radius + 1))
      sum += tmp[enter * w + x] - tmp[leave * w + x]
    }
  }
  return out
}

function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(mask)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          out[ny * w + nx] = 255
        }
      }
    }
  }
  return out
}
