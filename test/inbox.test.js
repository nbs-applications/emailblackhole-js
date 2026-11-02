import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { inbox, extractLink, extractCode, EmailTimeoutError } from '../index.js'

// A stand-in for the Email Blackhole API: it only needs the three calls the package makes.
async function fakeServer(handler) {
  const seen = []
  const server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization })
    handler(req, res, seen)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() }
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

test('mark returns the highest seq and the secret is sent as a bearer token', async () => {
  const s = await fakeServer((req, res) => json(res, 200, { messages: [{ seq: 2 }, { seq: 7 }, { seq: 5 }] }))
  const ebh = inbox({ url: s.url, id: 'abc', secret: 'sekret' })
  assert.equal(await ebh.mark(), 7)
  assert.equal(s.seen[0].url, '/api/sessions/abc/messages')
  assert.equal(s.seen[0].auth, 'Bearer sekret')
  s.close()
})

test('mark of an empty inbox is 0', async () => {
  const s = await fakeServer((req, res) => json(res, 200, { messages: [] }))
  assert.equal(await inbox({ url: s.url, id: 'abc', secret: 's' }).mark(), 0)
  s.close()
})

test('waitForEmail sends the filters, keeps asking after a 204 and returns the message', async () => {
  let calls = 0
  const s = await fakeServer((req, res) => {
    calls++
    if (calls === 1) {
      res.writeHead(204).end()
      return
    }
    json(res, 200, { messages: [{ seq: 3, subject: 'Reset your password', links: ['https://app.test/reset?t=1'], codes: ['123456'] }] })
  })
  const ebh = inbox({ url: s.url, id: 'abc', secret: 's' })
  const message = await ebh.waitForEmail({ after: 2, to: 'a@example.com', subject: 'reset', timeoutSeconds: 10 })
  assert.equal(calls, 2)
  const q = new URL(s.seen[1].url, 'http://x').searchParams
  assert.equal(q.get('after'), '2')
  assert.equal(q.get('to'), 'a@example.com')
  assert.equal(q.get('subject'), 'reset')
  assert.equal(extractLink(message), 'https://app.test/reset?t=1')
  assert.equal(extractLink(message, 'nothing'), undefined)
  assert.equal(extractCode(message), '123456')
  s.close()
})

test('waitForEmail throws EmailTimeoutError when nothing arrives', async () => {
  const s = await fakeServer((req, res) => res.writeHead(204).end())
  const ebh = inbox({ url: s.url, id: 'abc', secret: 's' })
  await assert.rejects(ebh.waitForEmail({ to: 'x@example.com', timeoutSeconds: 1 }), EmailTimeoutError)
  s.close()
})

test('an ended session gives a message that says what to do', async () => {
  const s = await fakeServer((req, res) => json(res, 404, { error: 'not found' }))
  await assert.rejects(inbox({ url: s.url, id: 'abc', secret: 's' }).mark(), /copy a fresh \.env block/)
  s.close()
})

test('missing settings say where to get them', () => {
  const saved = { ...process.env }
  for (const k of ['EBH_ID', 'EBH_SECRET', 'EBH_SESSION']) delete process.env[k]
  try {
    assert.throws(() => inbox({}), /Copy as \.env/)
  } finally {
    Object.assign(process.env, saved)
  }
})

test('EBH_SESSION=<id>:<secret> is accepted', () => {
  const saved = { ...process.env }
  delete process.env.EBH_ID
  delete process.env.EBH_SECRET
  process.env.EBH_SESSION = 'abc:sekret'
  try {
    assert.equal(inbox({}).id, 'abc')
  } finally {
    Object.assign(process.env, saved)
    delete process.env.EBH_SESSION
  }
})
