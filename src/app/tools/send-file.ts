/** The worker's `orchestrator_send_file` tool: sends files with the ticket's result back to the conversation it started in. */
import { stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { z } from 'zod'
import { tool, type Tool } from './tool.ts'

/** How many files one call may send, matching what the Channels accept in a batch. */
export const MAX_SENT_FILES = 10
/** The largest file a worker may send through this tool, in bytes; larger files belong on a share link. */
export const MAX_SENT_FILE_BYTES = 50 * 1024 * 1024

/** What the tool needs of the Engine; typed without importing the core to keep the tool module free of load-time cycles. */
export interface SendFileHost {
  readonly engine: { replyWithFiles(ticketId: string, text: string, attachments: { path: string; name?: string }[]): { id: string; status: 'pending' | 'sent' | 'dropped'; reused: boolean } }
  sendReplies(): Promise<void>
}
/** The only Ticket field the tool reads. */
export interface SendFileTicket { readonly id: string }

const Schema = z.object({
  text: z.string().trim().min(1).describe('The message that goes first; Markdown where the Channel supports it.'),
  files: z.array(z.string().min(1)).min(1).max(MAX_SENT_FILES)
    .describe('Absolute paths of files on this host, such as files the ticket produced or downloaded.'),
}).strict()

/** Refuses a path that is not an existing regular file of sendable size, so a typo fails here rather than mid-send. */
async function checkFile(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`Not an absolute path: ${path}`)
  const info = await stat(path).catch(() => undefined)
  if (!info) throw new Error(`No such file: ${path}`)
  if (!info.isFile()) throw new Error(`Not a regular file: ${path}`)
  if (info.size > MAX_SENT_FILE_BYTES) throw new Error(`Too large to send (${info.size} bytes, limit ${MAX_SENT_FILE_BYTES}): ${path}`)
  return path
}

export function sendFileTool(host: SendFileHost, ticket: SendFileTicket): Tool {
  return tool({
    name: 'orchestrator_send_file',
    description: 'Send one message and files back to the conversation the ticket started in, such as an image the work produced. '
      + 'The Channel decides whether it can carry files; a Channel that cannot keeps the text only. '
      + 'Prefer this over describing a file the person cannot open.',
    schema: Schema,
    execute: async args => {
      const files = await Promise.all(args.files.map(checkFile))
      const reply = host.engine.replyWithFiles(ticket.id, args.text, files.map(path => ({ path, name: basename(path) })))
      if (reply.status !== 'sent') await host.sendReplies()
      return { reply_id: reply.id, status: reply.status, reused: reply.reused, files: files.map(path => basename(path)) }
    },
  })
}
