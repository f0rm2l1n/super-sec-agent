import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export type InboxKind = 'question' | 'correction'
export type InboxMessage = { id: string; text: string; kind: InboxKind }

const id = z.string().uuid()
const maxBytes = 20_000

/**
 * File-backed local intake. Only the two explicit inbox directories are read;
 * project Markdown elsewhere remains research data. A claimed file is moved
 * atomically to processing, then to processed after the durable local trigger
 * has been recorded. Files left in processing after a crash are reclaimed.
 */
export class LocalInbox {
  private readonly roots: Record<InboxKind, string>
  private readonly processing: Record<InboxKind, string>
  private readonly processed: Record<InboxKind, string>
  private readonly errors: Record<InboxKind, string>

  constructor(private readonly root: string, private readonly send: (message: InboxMessage) => unknown) {
    this.roots = {
      question: join(root, 'interactions', 'inbox', 'requests'),
      correction: join(root, 'interactions', 'inbox', 'corrections'),
    }
    this.processing = {
      question: join(root, 'interactions', 'inbox', 'processing', 'requests'),
      correction: join(root, 'interactions', 'inbox', 'processing', 'corrections'),
    }
    this.processed = {
      question: join(root, 'interactions', 'inbox', 'processed', 'requests'),
      correction: join(root, 'interactions', 'inbox', 'processed', 'corrections'),
    }
    this.errors = {
      question: join(root, 'interactions', 'inbox', 'errors', 'requests'),
      correction: join(root, 'interactions', 'inbox', 'errors', 'corrections'),
    }
    for (const kind of ['question', 'correction'] as const) {
      for (const directory of [this.roots[kind], this.processing[kind], this.processed[kind], this.errors[kind]]) {
        mkdirSync(directory, { recursive: true })
      }
      this.reclaim(kind)
    }
  }

  poll(): { accepted: number; pending: number; errors: number } {
    let accepted = 0
    for (const kind of ['question', 'correction'] as const) {
      for (const name of readdirSync(this.roots[kind]).filter(name => name.endsWith('.md')).sort()) {
        const source = join(this.roots[kind], name)
        const claimed = join(this.processing[kind], name)
        try {
          renameSync(source, claimed)
        } catch {
          continue
        }
        let message: InboxMessage
        try {
          message = this.read(kind, name, claimed)
        } catch (error) {
          this.quarantine(kind, name, claimed, error instanceof Error ? error.message : String(error))
          continue
        }
        try {
          this.send(message)
          const destination = join(this.processed[kind], name)
          if (existsSync(destination)) unlinkSync(claimed)
          else renameSync(claimed, destination)
          accepted++
        } catch {
          // Operational failures such as source drift remain actionable and
          // retryable; only malformed files are quarantined permanently.
          renameSync(claimed, join(this.roots[kind], name))
        }
      }
    }
    return { accepted, pending: this.pending(), errors: this.errorCount() }
  }

  view() {
    return { pending: this.pending(), errors: this.errorCount() }
  }

  private read(kind: InboxKind, name: string, path: string): InboxMessage {
    const match = name.match(/^(.+)\.md$/)
    const parsed = match ? id.safeParse(match[1]) : undefined
    if (!parsed?.success) throw new Error('Inbox filename must be a UUID with a .md extension')
    if (statSync(path).size > maxBytes) throw new Error(`Inbox message exceeds ${maxBytes} bytes`)
    const text = readFileSync(path, 'utf8').trim()
    if (!text) throw new Error('Inbox message must not be empty')
    return { id: parsed.data, text, kind }
  }

  private reclaim(kind: InboxKind) {
    for (const name of readdirSync(this.processing[kind])) {
      if (!name.endsWith('.md')) continue
      const source = join(this.processing[kind], name), destination = join(this.roots[kind], name)
      if (existsSync(destination)) unlinkSync(source)
      else renameSync(source, destination)
    }
  }

  private quarantine(kind: InboxKind, name: string, source: string, reason: string) {
    const destination = join(this.errors[kind], existsSync(join(this.errors[kind], name)) ? `${randomUUID()}.md` : name)
    renameSync(source, destination)
    writeFileSync(`${destination}.error.json`, `${JSON.stringify({ file: name, reason, at: new Date().toISOString() }, null, 2)}\n`)
  }

  private pending() {
    return (['question', 'correction'] as const).reduce((count, kind) => count + readdirSync(this.roots[kind]).filter(name => name.endsWith('.md')).length, 0)
  }

  private errorCount() {
    return (['question', 'correction'] as const).reduce((count, kind) => count + readdirSync(this.errors[kind]).filter(name => name.endsWith('.md')).length, 0)
  }
}
