import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createSessionCache,
  pngFixture,
  runNodeScript,
  startVisionServer,
  visionEnv,
} from './test-helpers.mjs'

const describeScript = join(import.meta.dirname, '..', 'scripts', 'describe-image.mjs')

async function runDescribe(args, env) {
  return runNodeScript(describeScript, { args, env })
}

test('descreve um caminho explícito pela CLI manual', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'verboo-describe-test-'))
  const imagePath = join(directory, 'imagem de teste.png')
  await writeFile(imagePath, pngFixture)
  t.after(() => rm(directory, { recursive: true, force: true }))

  let receivedQuestion
  const server = await startVisionServer(async (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    for await (const chunk of request) body += chunk
    receivedQuestion = JSON.parse(body).messages[0].content[0].text
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'Texto manual reconhecido.' } }] }))
  })
  t.after(server.close)

  const result = await runDescribe(
    [imagePath, 'Qual texto está visível?'],
    visionEnv(undefined, server.baseUrl),
  )

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  assert.equal(receivedQuestion, 'Qual texto está visível?')
  assert.match(result.stdout, /imagem de teste\.png/)
  assert.match(result.stdout, /ultra\/kimi-k2\.7/)
  assert.match(result.stdout, /Texto manual reconhecido\./)
})

test('resolve latest para a imagem mais recente do cache do Verboo', async t => {
  const { verbooHome } = await createSessionCache(t, 'session-latest', ['7.png'])

  const server = await startVisionServer(async (request, response) => {
    for await (const _chunk of request) {
      // Consome o body da chamada.
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'Imagem mais recente.' } }] }))
  })
  t.after(server.close)

  const result = await runDescribe(['latest'], visionEnv(verbooHome, server.baseUrl))

  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /7\.png/)
  assert.match(result.stdout, /Imagem mais recente\./)
})
