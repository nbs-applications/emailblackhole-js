export interface EmailMessage {
  id: string
  /** Grows within the inbox; use it as `after`. */
  seq: number
  receivedAt: string
  subject: string
  from: { name?: string; address: string }[]
  to: { name?: string; address: string }[]
  text: string
  html: string
  /** Every URL found in the message. */
  links: string[]
  /** One-time codes found in the message. */
  codes: string[]
  [key: string]: unknown
}

export interface WaitFilter {
  /** Only messages with a higher `seq` (take it from `mark()` before triggering the email). */
  after?: number
  /** Recipient address (substring, case-insensitive). */
  to?: string
  from?: string
  /** Text the subject must contain (case-insensitive). */
  subject?: string
  /** Default 60. */
  timeoutSeconds?: number
}

export interface Inbox {
  id: string
  describe(): Promise<Record<string, unknown>>
  messages(): Promise<EmailMessage[]>
  mark(): Promise<number>
  waitForEmail(filter?: WaitFilter): Promise<EmailMessage>
  clear(): Promise<void>
}

export class EmailTimeoutError extends Error {}

/** Reads EBH_URL, EBH_ID and EBH_SECRET (or EBH_SESSION=id:secret) from the environment or ./.env. */
export function inbox(options?: { url?: string; id?: string; secret?: string }): Inbox
export function extractLink(message: EmailMessage, contains?: string): string | undefined
export function extractCode(message: EmailMessage): string | undefined
