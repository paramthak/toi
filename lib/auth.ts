import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'

const JWT_SECRET = process.env.JWT_SECRET || 'creativeiq-fallback-secret'
const COOKIE_NAME = 'creativeiq_token'

export interface JWTPayload {
  username: string
  iat?: number
  exp?: number
}

export function signToken(username: string): string {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload
  } catch {
    return null
  }
}

export async function validateCredentials(
  username: string,
  password: string
): Promise<boolean> {
  const adminUsername = process.env.ADMIN_USERNAME || 'okok'
  const adminPassword = process.env.ADMIN_PASSWORD || 'okok'
  return username === adminUsername && password === adminPassword
}

export async function getAuthUser(): Promise<JWTPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}

export { COOKIE_NAME }
