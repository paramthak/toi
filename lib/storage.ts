import fs from 'fs'
import path from 'path'
import sharp from 'sharp'

function getUploadDir(): string {
  const dir = process.env.UPLOAD_DIR || './uploads'
  const absoluteDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir)
  if (!fs.existsSync(absoluteDir)) {
    fs.mkdirSync(absoluteDir, { recursive: true })
  }
  return absoluteDir
}

export async function saveBase64Image(
  base64Data: string,
  mimeType: string,
  filename?: string
): Promise<string> {
  const uploadDir = getUploadDir()
  const ext = mimeType.split('/')[1] || 'png'
  const name = filename || `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const filepath = path.join(uploadDir, name)

  const buffer = Buffer.from(base64Data, 'base64')
  fs.writeFileSync(filepath, buffer)

  // Return the public path
  return `/api/files/${name}`
}

export async function saveLogo(
  buffer: Buffer,
  originalName: string
): Promise<string> {
  const uploadDir = getUploadDir()
  const ext = path.extname(originalName) || '.png'
  const name = `logo-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
  const filepath = path.join(uploadDir, name)

  fs.writeFileSync(filepath, buffer)
  return `/api/files/${name}`
}

export function getFilePath(filename: string): string {
  const uploadDir = getUploadDir()
  return path.join(uploadDir, filename)
}

export function fileExists(filename: string): boolean {
  const filepath = getFilePath(filename)
  return fs.existsSync(filepath)
}

export function readFileAsBase64(filename: string): string {
  const filepath = getFilePath(filename)
  const buffer = fs.readFileSync(filepath)
  return buffer.toString('base64')
}

/**
 * Composites a logo onto the bottom-left corner of a generated image.
 * Logo is resized to ~11% of the image width, with a small padding.
 * Returns the composited image as base64 PNG.
 */
export async function compositeLogoOntoImage(
  imageBase64: string,
  logoBase64: string,
): Promise<string> {
  const imageBuffer = Buffer.from(imageBase64, 'base64')
  const logoBuffer = Buffer.from(logoBase64, 'base64')

  const imageInfo = await sharp(imageBuffer).metadata()
  const imageWidth = imageInfo.width || 1024
  const imageHeight = imageInfo.height || 1024

  // Resize logo to 11% of image width
  const logoTargetWidth = Math.round(imageWidth * 0.11)
  const resizedLogo = await sharp(logoBuffer)
    .resize(logoTargetWidth, null, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer()

  const logoInfo = await sharp(resizedLogo).metadata()
  const logoHeight = logoInfo.height || logoTargetWidth

  const padding = Math.round(imageWidth * 0.04)
  const left = padding
  const top = imageHeight - logoHeight - padding

  const composited = await sharp(imageBuffer)
    .composite([{ input: resizedLogo, left, top }])
    .png()
    .toBuffer()

  return composited.toString('base64')
}
