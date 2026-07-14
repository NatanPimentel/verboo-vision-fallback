import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { resolveConfigRoot } from './vision-config.mjs'

export const imageMimeTypes = new Map([
  ['.bmp', 'image/bmp'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
])

const MAX_SESSION_ID_LENGTH = 256
const MAX_IMAGE_ID_DIGITS = 64

export function imageCacheRoot(env = process.env) {
  return resolve(resolveConfigRoot(env), 'image-cache')
}

export function isPathInside(parent, candidate) {
  const path = relative(resolve(parent), resolve(candidate))
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  )
}

export function normalizeImageId(value) {
  const raw = String(value ?? '')
  if (!/^\d+$/.test(raw) || raw.length > MAX_IMAGE_ID_DIGITS) return null
  return raw.replace(/^0+(?=\d)/, '')
}

export function normalizeSessionId(value) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFC').trim()
  if (
    normalized.length === 0 ||
    normalized.length > MAX_SESSION_ID_LENGTH ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('\0') ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.includes(':') ||
    isAbsolute(normalized)
  ) {
    return null
  }
  return normalized
}

async function realPathInside(parent, candidate) {
  try {
    const realParent = await realpath(parent)
    const realCandidate = await realpath(candidate)
    return isPathInside(realParent, realCandidate)
      ? { realParent, realCandidate }
      : null
  } catch {
    return null
  }
}

export async function findCachedImage(cacheRoot, sessionId, imageId) {
  const normalizedSessionId = normalizeSessionId(sessionId)
  const normalizedId = normalizeImageId(imageId)
  if (!normalizedSessionId || !normalizedId) return null

  const resolvedCacheRoot = resolve(cacheRoot)
  const sessionDirectory = resolve(resolvedCacheRoot, normalizedSessionId)
  if (!isPathInside(resolvedCacheRoot, sessionDirectory)) return null

  const safeDirectory = await realPathInside(
    resolvedCacheRoot,
    sessionDirectory,
  )
  if (!safeDirectory) return null

  try {
    const entries = await readdir(safeDirectory.realCandidate, {
      withFileTypes: true,
    })
    for (const entry of entries) {
      const extension = extname(entry.name).toLowerCase()
      if (!imageMimeTypes.has(extension)) continue
      if (entry.name.slice(0, -extension.length) !== normalizedId) continue

      const candidate = resolve(safeDirectory.realCandidate, entry.name)
      if (!isPathInside(safeDirectory.realCandidate, candidate)) continue
      // Do not turn an in-cache filename into a way to follow a symlink. The
      // realpath containment check below catches escapes too; lstat makes the
      // regular-file policy explicit even for symlinks that point back inside.
      const candidateStat = await lstat(candidate)
      if (!candidateStat.isFile()) continue
      const safeFile = await realPathInside(
        safeDirectory.realCandidate,
        candidate,
      )
      if (!safeFile) continue
      if ((await stat(safeFile.realCandidate)).isFile()) {
        return safeFile.realCandidate
      }
    }
  } catch {
    return null
  }

  return null
}

export async function latestCachedImage(cacheRoot) {
  const resolvedCacheRoot = resolve(cacheRoot)
  let safeRoot
  try {
    safeRoot = await realpath(resolvedCacheRoot)
  } catch {
    return null
  }

  const candidates = []
  try {
    const sessions = await readdir(safeRoot, { withFileTypes: true })
    for (const session of sessions) {
      if (!normalizeSessionId(session.name)) continue
      const sessionPath = resolve(safeRoot, session.name)
      if (!isPathInside(safeRoot, sessionPath)) continue

      let safeSession
      try {
        if (!(await lstat(sessionPath)).isDirectory()) continue
        safeSession = await realpath(sessionPath)
        if (!isPathInside(safeRoot, safeSession)) continue
        if (!(await stat(safeSession)).isDirectory()) continue
      } catch {
        continue
      }

      for (const file of await readdir(safeSession, { withFileTypes: true })) {
        const extension = extname(file.name).toLowerCase()
        if (!imageMimeTypes.has(extension)) continue
        if (!normalizeImageId(file.name.slice(0, -extension.length))) continue
        const filePath = resolve(safeSession, file.name)
        if (!isPathInside(safeSession, filePath)) continue
        try {
          if (!(await lstat(filePath)).isFile()) continue
        } catch {
          continue
        }
        const safeFile = await realPathInside(safeSession, filePath)
        if (!safeFile) continue
        try {
          const fileStat = await stat(safeFile.realCandidate)
          if (fileStat.isFile()) {
            candidates.push({
              filePath: safeFile.realCandidate,
              modifiedAt: fileStat.mtimeMs,
            })
          }
        } catch {
          // A cache entry can disappear while the manual command is scanning.
        }
      }
    }
  } catch {
    return null
  }

  candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return candidates[0]?.filePath ?? null
}
