import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createSessionCache,
  runNodeScript,
  startVisionServer,
  visionEnv,
} from './test-helpers.mjs'

const hookScript = join(import.meta.dirname, '..', 'scripts', 'image-hook.mjs')

async function runHook(payload, env) {
  return runNodeScript(hookScript, {
    cwd: import.meta.dirname,
    env,
    input: `${JSON.stringify(payload)}\n`,
  })
}

test('descreve um marcador [Image #N] usando a imagem da sessão', async t => {
  const sessionId = 'session-one'
  const { verbooHome } = await createSessionCache(t, sessionId, ['1.png'])

  const server = await startVisionServer(async (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    for await (const chunk of request) body += chunk
    const parsed = JSON.parse(body)

    assert.equal(request.url, '/v1/chat/completions')
    assert.equal(parsed.model, 'kimi-k2.7')
    assert.match(parsed.messages[0].content[1].image_url.url, /^data:image\/png;base64,/)

    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'A imagem mostra um painel.' } }] }))
  })
  t.after(server.close)

  const result = await runHook(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: 'D:\\Projetos\\exemplo',
      prompt: '[Image #1] O que aparece aqui?',
    },
    visionEnv(verbooHome, server.baseUrl),
  )

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  const output = JSON.parse(result.stdout)
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
  assert.match(output.hookSpecificOutput.additionalContext, /A imagem mostra um painel\./)
})

test('usa o modelo de fallback quando o modelo principal falha', async t => {
  const sessionId = 'session-fallback'
  const { verbooHome } = await createSessionCache(t, sessionId, ['2.png'])

  const requestedModels = []
  const server = await startVisionServer(async (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    for await (const chunk of request) body += chunk
    const { model } = JSON.parse(body)
    requestedModels.push(model)

    if (model === 'kimi-k2.7') {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'temporariamente indisponível' } }))
      return
    }

    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'Descrição retornada pelo Qwen.' } }] }))
  })
  t.after(server.close)

  const result = await runHook(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: 'D:\\Projetos\\exemplo',
      prompt: '[Image #2] Leia o erro exibido.',
    },
    visionEnv(verbooHome, server.baseUrl, {
      VISION_FALLBACK_MODELS: 'ultra/qwen3.6-27b',
    }),
  )

  assert.equal(result.exitCode, 0)
  assert.deepEqual(requestedModels, ['kimi-k2.7', 'qwen3.6-27b'])
  const output = JSON.parse(result.stdout)
  assert.match(output.hookSpecificOutput.additionalContext, /Descrição retornada pelo Qwen\./)
})

test('avisa e libera o turno quando todos os modelos falham', async t => {
  const sessionId = 'session-fail-open'
  const { verbooHome } = await createSessionCache(t, sessionId, ['3.png'])

  const server = await startVisionServer(async (request, response) => {
    for await (const _chunk of request) {
      // Consome o body antes de responder para não encerrar o socket durante o upload.
    }
    response.writeHead(429, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'rate limited' } }))
  })
  t.after(server.close)

  const result = await runHook(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: 'D:\\Projetos\\exemplo',
      prompt: '[Image #3] Leia esta imagem.',
    },
    visionEnv(verbooHome, server.baseUrl, {
      VISION_API_KEY: 'secret-that-must-not-leak',
      VISION_FALLBACK_MODELS: 'ultra/qwen3.6-27b',
    }),
  )

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /secret-that-must-not-leak/)
  const output = JSON.parse(result.stdout)
  assert.match(output.hookSpecificOutput.additionalContext, /não foi possível descrever a imagem/i)
  assert.match(output.hookSpecificOutput.additionalContext, /continue respondendo/i)
})

test('envia múltiplas imagens uma vez e preserva a pergunta do usuário', async t => {
  const sessionId = 'session-multiple'
  const { verbooHome } = await createSessionCache(t, sessionId, ['1.png', '2.jpg'])

  let requestContent
  const server = await startVisionServer(async (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    for await (const chunk of request) body += chunk
    requestContent = JSON.parse(body).messages[0].content
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'Comparação concluída.' } }] }))
  })
  t.after(server.close)

  const result = await runHook(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: 'D:\\Projetos\\exemplo',
      prompt: '[Image #1] Compare com [Image #2] e confira novamente [Image #1].',
    },
    visionEnv(verbooHome, server.baseUrl),
  )

  assert.equal(result.exitCode, 0)
  assert.equal(requestContent[0].text, 'Compare com  e confira novamente .')
  assert.equal(requestContent.filter(block => block.type === 'image_url').length, 2)
  assert.match(requestContent[1].image_url.url, /^data:image\/png;base64,/)
  assert.match(requestContent[2].image_url.url, /^data:image\/jpeg;base64,/)
})

test('lê a credencial do opencode.json do projeto sem expô-la na saída', async t => {
  const projectDir = await mkdtemp(join(tmpdir(), 'verboo-project-test-'))
  const sessionId = 'session-config-key'
  const { verbooHome } = await createSessionCache(t, sessionId, ['4.png'])
  await writeFile(
    join(projectDir, 'opencode.json'),
    JSON.stringify({ provider: { verboo: { options: { apiKey: 'key-from-project-config' } } } }),
  )
  t.after(() => rm(projectDir, { recursive: true, force: true }))

  let authorization
  const server = await startVisionServer(async (request, response) => {
    authorization = request.headers.authorization
    for await (const _chunk of request) {
      // Consome o body da chamada.
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'Credencial aceita.' } }] }))
  })
  t.after(server.close)

  const result = await runHook(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: projectDir,
      prompt: '[Image #4] Descreva.',
    },
    visionEnv(verbooHome, server.baseUrl, {
      VISION_API_KEY: '',
    }),
  )

  assert.equal(result.exitCode, 0)
  assert.equal(authorization, 'Bearer key-from-project-config')
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /key-from-project-config/)
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /Credencial aceita\./)
})

test('permanece silencioso quando o prompt não contém imagem', async () => {
  const result = await runHook(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session-without-image',
      cwd: 'D:\\Projetos\\exemplo',
      prompt: 'Explique este arquivo de código.',
    },
    {
      VISION_API_KEY: 'test-key',
      VISION_BASE_URL: 'http://127.0.0.1:1/v1',
    },
  )

  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

test('mantém JSON válido com aspas, barras e quebras de linha', async t => {
  const sessionId = 'session-special-characters'
  const { verbooHome } = await createSessionCache(t, sessionId, ['6.png'])
  let receivedQuestion
  const server = await startVisionServer(async (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    for await (const chunk of request) body += chunk
    receivedQuestion = JSON.parse(body).messages[0].content[0].text
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({ choices: [{ message: { content: 'Texto "A"\nC:\\temp' } }] }),
    )
  })
  t.after(server.close)

  const result = await runHook(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: 'D:\\Projetos\\exemplo',
      prompt: '[Image #6] Leia "status":\nC:\\temp?',
    },
    visionEnv(verbooHome, server.baseUrl),
  )

  assert.equal(result.exitCode, 0)
  assert.equal(receivedQuestion, 'Leia "status":\nC:\\temp?')
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /Texto "A"\nC:\\temp/)
})

test('não analisa parcialmente quando uma das imagens não está no cache', async t => {
  const sessionId = 'session-missing-image'
  const { verbooHome } = await createSessionCache(t, sessionId, ['1.png'])
  const result = await runHook(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: 'D:\\Projetos\\exemplo',
      prompt: '[Image #1] Compare com [Image #2].',
    },
    visionEnv(verbooHome, 'http://127.0.0.1:1/v1'),
  )

  assert.equal(result.exitCode, 0)
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext
  assert.match(context, /imagem #2 não encontrada no cache/i)
})

test('limita o modelo lento e conclui pelo fallback', async t => {
  const sessionId = 'session-timeout'
  const { verbooHome } = await createSessionCache(t, sessionId, ['5.png'])

  const server = await startVisionServer(async (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    for await (const chunk of request) body += chunk
    const { model } = JSON.parse(body)
    if (model === 'kimi-k2.7') {
      await new Promise(resolve => setTimeout(resolve, 150))
      if (!response.destroyed) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: 'Resposta atrasada.' } }] }))
      }
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'Fallback após timeout.' } }] }))
  })
  t.after(server.close)

  const startedAt = performance.now()
  const result = await runHook(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: 'D:\\Projetos\\exemplo',
      prompt: '[Image #5] Descreva.',
    },
    visionEnv(verbooHome, server.baseUrl, {
      VISION_FALLBACK_MODELS: 'ultra/qwen3.6-27b',
      VISION_TIMEOUT_MS: '40',
    }),
  )
  const elapsedMs = performance.now() - startedAt

  assert.equal(result.exitCode, 0)
  assert.ok(elapsedMs < 500, `hook levou ${elapsedMs.toFixed(0)}ms`)
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /Fallback após timeout\./)
})

test('reserva tempo para avisar antes do timeout total do hook', async t => {
  const sessionId = 'session-total-timeout'
  const { verbooHome } = await createSessionCache(t, sessionId, ['8.png'])
  const requestedModels = []
  const server = await startVisionServer(async (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    for await (const chunk of request) body += chunk
    requestedModels.push(JSON.parse(body).model)
    await new Promise(resolve => setTimeout(resolve, 150))
    if (!response.destroyed) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: 'Tarde demais.' } }] }))
    }
  })
  t.after(server.close)

  const startedAt = performance.now()
  const result = await runHook(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: 'D:\\Projetos\\exemplo',
      prompt: '[Image #8] Descreva.',
    },
    visionEnv(verbooHome, server.baseUrl, {
      VISION_FALLBACK_MODELS: 'ultra/qwen3.6-27b ultra/terceiro-modelo',
      VISION_TIMEOUT_MS: '1000',
      VISION_TOTAL_TIMEOUT_MS: '60',
    }),
  )
  const elapsedMs = performance.now() - startedAt

  assert.equal(result.exitCode, 0)
  assert.ok(elapsedMs < 500, `hook levou ${elapsedMs.toFixed(0)}ms`)
  assert.deepEqual(requestedModels, ['kimi-k2.7'])
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /limite total excedido/i)
})
