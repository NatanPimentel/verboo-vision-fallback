#!/usr/bin/env node

import { lstat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { imageCacheRoot, imageMimeTypes, latestCachedImage } from './cache.mjs'
import { describeImages, doctorDiagnostic, runDoctor, VisionClientError } from './vision-client.mjs'

async function isImageFile(filePath) {
  if (!imageMimeTypes.has(extname(filePath).toLowerCase())) return false
  try {
    return (await lstat(filePath)).isFile()
  } catch {
    return false
  }
}

async function resolveImage(input, env = process.env) {
  if (input.toLowerCase() === 'latest') {
    return latestCachedImage(imageCacheRoot(env))
  }

  // `[Image #N]` belongs to the hook protocol because it needs a session_id.
  // The manual CLI must never guess a session by falling back to `latest`.
  if (/^\[Image #\d+\]$/i.test(input)) return null

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

function usage() {
  return [
    'Uso:',
    '  node scripts/describe-image.mjs <caminho|nome|latest> [pergunta]',
    '  node scripts/describe-image.mjs doctor',
  ].join('\n')
}

async function main() {
  const [imageInput, ...questionParts] = process.argv.slice(2)
  if (!imageInput) {
    process.stderr.write(`${usage()}\n`)
    process.exitCode = 2
    return
  }

  if (imageInput.toLowerCase() === 'doctor') {
    if (questionParts.length > 0) {
      process.stderr.write(`${usage()}\n`)
      process.exitCode = 2
      return
    }
    try {
      const result = await runDoctor({ env: process.env })
      process.stdout.write(
        `Doctor concluído: GET /models confirmou os modelos configurados e ${result.testedModels.join(', ')} aceitaram a imagem de teste.\n`,
      )
    } catch (error) {
      process.stderr.write(`Doctor falhou: ${doctorDiagnostic(error)}\n`)
      process.exitCode = 1
    }
    return
  }

  const imagePath = await resolveImage(imageInput, process.env)
  if (!imagePath) {
    process.stderr.write('Não foi possível localizar uma imagem regular compatível.\n')
    process.exitCode = 1
    return
  }

  const question = questionParts.join(' ').trim()
  try {
    const result = await describeImages({
      imagePaths: [imagePath],
      question: question || undefined,
      env: process.env,
    })
    process.stdout.write(
      `[Descrição da imagem ${basename(imagePath)} usando ${result.model}]:\n\n${result.description}\n`,
    )
  } catch (error) {
    const message =
      error instanceof VisionClientError
        ? doctorDiagnostic(error)
        : 'Não foi possível descrever a imagem.'
    process.stderr.write(`Falha ao descrever a imagem: ${message}\n`)
    process.exitCode = 1
  }
}

try {
  await main()
} catch {
  process.stderr.write('Não foi possível executar a descrição de imagem.\n')
  process.exitCode = 1
}
