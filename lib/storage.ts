import fs from 'fs'
import path from 'path'

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
