// Email Blackhole helper for tests: take a mark, trigger the email, wait for it, read the link or code.
// Zero dependencies; it only calls the HTTP API (https://emailblackhole.io/api/openapi.yaml).

/** Thrown when no matching email arrived in time. */
export class EmailTimeoutError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EmailTimeoutError'
  }
}

function loadDotEnv() {
  try {
    process.loadEnvFile?.() // Node 20.12+: reads ./.env if it exists; variables already set win
  } catch {
    /* no .env file: fine */
  }
}

/**
 * The inbox to use. By default it reads the variables from the "Copy as .env" button on the website:
 * EBH_URL, EBH_ID and EBH_SECRET (or EBH_SESSION=<id>:<secret>). Options override the environment.
 *
 * @param {{ url?: string, id?: string, secret?: string }} [options]
 */
export function inbox(options = {}) {
  loadDotEnv()
  const env = process.env
  let id = options.id ?? env.EBH_ID
  let secret = options.secret ?? env.EBH_SECRET
  if ((!id || !secret) && env.EBH_SESSION?.includes(':')) {
    ;[id, secret] = env.EBH_SESSION.split(':')
  }
  if (!id || !secret) {
    throw new Error(
      'Email Blackhole: no inbox settings found. Open https://emailblackhole.io, press "Copy as .env", paste the ' +
        'block into .env (git-ignored) and run again. Needed: EBH_URL, EBH_ID, EBH_SECRET.',
    )
  }
  const base = (options.url ?? env.EBH_URL ?? 'https://emailblackhole.io').replace(/\/+$/, '')
  const root = `${base}/api/sessions/${encodeURIComponent(id)}`
  const headers = { Authorization: `Bearer ${secret}` }

  async function call(path, init = {}) {
    const res = await fetch(`${root}${path}`, { ...init, headers })
    if (res.status === 401 || res.status === 404) {
      throw new Error(
        `Email Blackhole: the inbox ${id} was refused (HTTP ${res.status}). A free session ends after 60 minutes ` +
          'without use: open the website and copy a fresh .env block.',
      )
    }
    return res
  }

  return {
    id,
    /** SMTP and address details of the inbox (host, port, public address, expiry). */
    async describe() {
      const res = await call('')
      if (!res.ok) throw new Error(`Email Blackhole: HTTP ${res.status}`)
      return res.json()
    },

    /** All messages, oldest first. */
    async messages() {
      const res = await call('/messages')
      if (!res.ok) throw new Error(`Email Blackhole: HTTP ${res.status}`)
      return (await res.json()).messages
    },

    /** The inbox position now. Pass it as `after` so earlier mail can never satisfy this wait. */
    async mark() {
      const messages = await this.messages()
      return messages.reduce((max, m) => Math.max(max, m.seq), 0)
    },

    /**
     * Wait for a message newer than `after`, optionally for one recipient (`to`), sender (`from`) and subject
     * text. Resolves to the message ({ subject, text, html, links, codes, ... }).
     *
     * @param {{ after?: number, to?: string, from?: string, subject?: string, timeoutSeconds?: number }} [filter]
     */
    async waitForEmail({ after = 0, to, from, subject, timeoutSeconds = 60 } = {}) {
      const deadline = Date.now() + timeoutSeconds * 1000
      while (Date.now() < deadline) {
        const left = Math.max(1, Math.min(30, Math.ceil((deadline - Date.now()) / 1000)))
        const q = new URLSearchParams({ after: String(after), timeout: String(left) })
        if (to) q.set('to', to)
        if (from) q.set('from', from)
        if (subject) q.set('subject', subject)
        const res = await call(`/wait?${q}`)
        if (res.status === 200) return (await res.json()).messages[0]
        if (res.status === 204) continue // nothing yet; ask again until our own deadline
        if (res.status === 503) {
          await new Promise((r) => setTimeout(r, 1000)) // server restarting
          continue
        }
        throw new Error(`Email Blackhole: waiting failed with HTTP ${res.status}`)
      }
      throw new EmailTimeoutError(
        `No email${to ? ` for ${to}` : ''}${subject ? ` with subject containing "${subject}"` : ''} arrived within ${timeoutSeconds} s`,
      )
    },

    /** Delete every message in the inbox. */
    async clear() {
      const res = await call('/messages', { method: 'DELETE' })
      if (!res.ok) throw new Error(`Email Blackhole: HTTP ${res.status}`)
    },
  }
}

/** First link of a message, optionally the first whose URL contains `contains`. Undefined if none. */
export function extractLink(message, contains) {
  return message.links.find((l) => !contains || l.includes(contains))
}

/** First one-time code Email Blackhole found in the message. Undefined if none. */
export function extractCode(message) {
  return message.codes[0]
}
