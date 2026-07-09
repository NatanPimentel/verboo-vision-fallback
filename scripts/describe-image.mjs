#!/usr/bin/env node

import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { describeImages, imageMimeTypes } from './vision-client.mjs'

async function isImageFile(filePath) {
  if (!imageMimeTypes.has(extname(filePath).toLowerCase())) return false
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

async function latestCachedImage(verbooHome) {
  const cacheRoot = join(verbooHome, 'image-cache')
  const candidates = []
  try {
    for (const session of await readdir(cacheRoot, { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const sessionPath = join(cacheRoot, session.name)
      for (const file of await readdir(sessionPath, { withFileTypes: true })) {
        if (!file.isFile()) continue
        const filePath = join(sessionPath, file.name)
        if (!imageMimeTypes.has(extname(file.name).toLowerCase())) continue
        candidates.push({ filePath, modifiedAt: (await stat(filePath)).mtimeMs })
      }
    }
  } catch {
    return null
  }
  candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return candidates[0]?.filePath ?? null
}

async function resolveImage(input, verbooHome) {
  if (/^(latest|\[Image #\d+\])$/i.test(input)) return latestCachedImage(verbooHome)

  const direct = isAbsolute(input) ? input : resolve(input)
  if (await isImageFile(direct)) return direct

  const commonDirectories = [
    process.cwd(),
    join(homedir(), 'Downloads'),
    join(homedir(), 'Pictures'),
    join(homedir(), 'Pictures', 'Screenshots'),
    join(homedir(), 'Desktop'),
  ]
  for (const directory of commonDirectories) {
    const candidate = join(directory, input)
    if (await isImageFile(candidate)) return candidate
  }
  return null
}

const [imageInput, ...questionParts] = process.argv.slice(2)
if (!imageInput) {
  console.error('Uso: node describe-image.mjs <caminho|latest> [pergunta]')
  process.exitCode = 1
} else {
  const verbooHome = process.env.VERBOO_HOME || join(homedir(), '.verboo')
  const imagePath = await resolveImage(imageInput, verbooHome)
  if (!imagePath) {
    console.error(`Não foi possível encontrar a imagem: ${imageInput}`)
    process.exitCode = 1
  } else {
    const rawQuestion = questionParts.join(' ').replace(/^with question:\s*/i, '').trim()
    try {
      const result = await describeImages({
        imagePaths: [imagePath],
        question: rawQuestion || undefined,
        verbooHome,
      })
      process.stdout.write(
        `[Descrição da imagem ${basename(imagePath)} usando ${result.model}]:\n\n${result.description}\n`,
      )
    } catch (error) {
      console.error(`Falha ao descrever a imagem: ${error.message}`)
      process.exitCode = 1
    }
  }
}
