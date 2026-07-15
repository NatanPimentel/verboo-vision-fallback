import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  createSessionCache,
  createTempDirectory,
  pngFixture,
  readRequestJson,
  runNodeScript,
  startVisionServer,
  visionEnv,
} from './test-helpers.mjs'

const describeScript = join(import.meta.dirname, '..', 'scripts', 'describe-image.mjs')

async function runDescribe(args, env, cwd) {
  return runNodeScript(describeScript, { args, cwd, env })
}

test('CLI descreve caminho explícito e preserva o ID opaco do modelo', async t => {
  const directory = await createTempDirectory(t, 'verboo-describe-path-')
  const imagePath = join(directory, 'imagem de teste.png')
  await writeFile(imagePath, pngFixture)
  let body
  const server = await startVisionServer(async (request, response) => {
    body = await readRequestJson(request)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'Texto manual reconhecido.' } }] }))
  })
  t.after(server.close)

  const model = 'ultra/early-adopters/Kimi-K2.7'
  const result = await runDescribe(
    [imagePath, 'Qual texto está visível?'],
    visionEnv(undefined, server.baseUrl, { VISION_MODEL: model }),
    directory,
  )

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  assert.equal(body.model, model)
  assert.equal(body.messages[0].content[0].text, 'Qual texto está visível?')
  assert.match(result.stdout, /imagem de teste\.png/)
  assert.match(result.stdout, /ultra\/early-adopters\/Kimi-K2\.7/)
  assert.match(result.stdout, /Texto manual reconhecido\./)
})

test('CLI resolve nome de arquivo no diretório atual e usa pergunta opcional padrão', async t => {
  const directory = await createTempDirectory(t, 'verboo-describe-name-')
  await writeFile(join(directory, 'captura.png'), pngFixture)
  let question
  const server = await startVisionServer(async (request, response) => {
    question = (await readRequestJson(request)).messages[0].content[0].text
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'Imagem pelo nome.' } }] }))
  })
  t.after(server.close)

  const result = await runDescribe(['captura.png'], visionEnv(undefined, server.baseUrl), directory)

  assert.equal(result.exitCode, 0)
  assert.equal(question, 'Descreva esta imagem de forma curta e objetiva, em no máximo 3 parágrafos. Foque no conteúdo visual principal e em textos legíveis.')
  assert.match(result.stdout, /Imagem pelo nome\./)
})

test('CLI latest usa exclusivamente o cache da raiz VERBOO_CONFIG_DIR', async t => {
  const { configRoot } = await createSessionCache(t, 'session-latest', ['7.png'])
  const server = await startVisionServer(async (request, response) => {
    await readRequestJson(request)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'Imagem mais recente.' } }] }))
  })
  t.after(server.close)

  const result = await runDescribe(['latest'], visionEnv(configRoot, server.baseUrl))

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  assert.match(result.stdout, /7\.png/)
  assert.match(result.stdout, /Imagem mais recente\./)
})

test('CLI rejeita [Image #N] em vez de adivinhar latest', async t => {
  const { configRoot } = await createSessionCache(t, 'session-manual-marker', ['1.png'])
  let requests = 0
  const server = await startVisionServer(async (_request, response) => {
    requests += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'não deveria chamar' } }] }))
  })
  t.after(server.close)

  const result = await runDescribe(['[Image #1]'], visionEnv(configRoot, server.baseUrl))

  assert.equal(result.exitCode, 1)
  assert.equal(requests, 0)
  assert.match(result.stderr, /Não foi possível localizar uma imagem regular compatível/i)
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /latest|1\.png/i)
})

test('CLI doctor executa GET /models e uma inferência visual mínima', async t => {
  const primary = 'ultra/doctor-primary'
  const fallback = 'vendor/doctor-fallback'
  const requests = []
  const server = await startVisionServer(async (request, response) => {
    requests.push(request.url)
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: primary }, { id: fallback }] }))
      return
    }
    const body = await readRequestJson(request)
    assert.match(body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/)
    assert.ok([primary, fallback].includes(body.model))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
  })
  t.after(server.close)

  const result = await runDescribe(['doctor'], visionEnv(undefined, server.baseUrl, {
    VISION_MODEL: primary,
    VISION_FALLBACK_MODELS: fallback,
  }))

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  assert.match(result.stdout, /Doctor concluído/i)
  assert.match(result.stdout, /GET \/models/i)
  assert.match(result.stdout, new RegExp(fallback))
  assert.deepEqual(requests, ['/v1/models', '/v1/chat/completions', '/v1/chat/completions'])
})

test('CLI doctor retorna diagnóstico público e códigos de uso coerentes', async t => {
  const server = await startVisionServer(async (_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end('{"error":{"message":"segredo remoto"}}')
  })
  t.after(server.close)

  const failedDoctor = await runDescribe(['doctor'], visionEnv(undefined, server.baseUrl, {
    VISION_API_KEY: 'secret-doctor-key',
  }))
  assert.equal(failedDoctor.exitCode, 1)
  assert.match(failedDoctor.stderr, /Doctor falhou:.*HTTP 401/i)
  assert.doesNotMatch(`${failedDoctor.stdout}${failedDoctor.stderr}`, /secret-doctor-key|segredo remoto/)

  const usage = await runDescribe([], {})
  assert.equal(usage.exitCode, 2)
  assert.match(usage.stderr, /Uso:/)

  const doctorWithExtraArgument = await runDescribe(['doctor', 'extra'], {})
  assert.equal(doctorWithExtraArgument.exitCode, 2)
  assert.match(doctorWithExtraArgument.stderr, /Uso:/)
})
