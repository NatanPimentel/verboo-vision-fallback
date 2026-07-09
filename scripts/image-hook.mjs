#!/usr/bin/env node

import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { describeImages, imageMimeTypes } from './vision-client.mjs'

async function readStdin() {
  let input = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) input += chunk
  return input
}

async function findCachedImage(verbooHome, sessionId, imageId) {
  try {
    const directory = join(verbooHome, 'image-cache', sessionId)
    const entries = await readdir(directory)
    const fileName = entries.find(entry => {
      const extension = extname(entry).toLowerCase()
      return entry.slice(0, -extension.length) === String(imageId) && imageMimeTypes.has(extension)
    })
    return fileName ? join(directory, fileName) : null
  } catch {
    return null
  }
}

function writeAdditionalContext(additionalContext) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext,
      },
    }),
  )
}

function failureContext(reason) {
  return `Aviso: não foi possível descrever a imagem anexada (${reason}). Continue respondendo ao usuário sem inventar detalhes visuais e informe brevemente que a análise da imagem falhou.`
}

async function main() {
  let payload
  try {
    payload = JSON.parse(await readStdin())
  } catch {
    return
  }

  const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
  const imageIds = [
    ...new Set([...prompt.matchAll(/\[Image #(\d+)\]/gi)].map(match => Number(match[1]))),
  ]
  if (imageIds.length === 0) return

  const verbooHome = process.env.VERBOO_HOME || join(homedir(), '.verboo')
  const resolvedImages = await Promise.all(
    imageIds.map(async imageId => ({
      imageId,
      imagePath: await findCachedImage(verbooHome, payload.session_id, imageId),
    })),
  )
  const missingIds = resolvedImages
    .filter(image => !image.imagePath)
    .map(image => image.imageId)
  if (missingIds.length > 0) {
    const missingLabel = missingIds.map(imageId => `imagem #${imageId}`).join(', ')
    const agreement = missingIds.length === 1 ? 'não encontrada' : 'não encontradas'
    writeAdditionalContext(failureContext(`${missingLabel} ${agreement} no cache da sessão`))
    return
  }
  const imagePaths = resolvedImages.map(image => image.imagePath)

  const question =
    prompt.replace(/\[Image #\d+\]/gi, '').trim() || 'Descreva detalhadamente esta imagem.'

  try {
    const result = await describeImages({
      imagePaths,
      question,
      cwd: payload.cwd,
      verbooHome,
    })
    writeAdditionalContext(
      `Descrição visual gerada automaticamente por ${result.model}:\n\n${result.description}`,
    )
  } catch (error) {
    writeAdditionalContext(failureContext(error.message))
  }
}

await main()
