/** `orchestrator_send_file`: a worker's files go out with its result reply, after checks that keep a typo from queuing. */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
// The tool module is loaded through the app's own graph (as the runtime loads it) so its imports resolve the way the
// other tool tests do; importing `tools/executor.ts` directly would load its cycle with `core` in a broken order.
import { sendFileTool } from '../src/app/resources.ts'
import { MAX_SENT_FILES } from '../src/app/tools/send-file.ts'
import type { Ticket } from '../src/core/index.ts'

const ticket = { id: 't1' } as Ticket

const host = (status: 'pending' | 'sent' = 'sent') => {
  const replyWithFiles = vi.fn(() => ({ id: 'r1', status, reused: false }))
  const sendReplies = vi.fn(async () => {})
  return { replyWithFiles, sendReplies, host: { engine: { replyWithFiles }, sendReplies } as never }
}

describe('orchestrator_send_file', () => {
  it('queues the files as a result reply and reports what it sent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'send-file-'))
    const path = join(directory, 'chart.png')
    await writeFile(path, 'png')
    const { host: toolHost, replyWithFiles, sendReplies } = host()
    const result = await sendFileTool(toolHost, ticket).execute({ text: 'the chart', files: [path] } as never,
      new AbortController().signal) as Record<string, unknown>
    expect(replyWithFiles).toHaveBeenCalledWith('t1', 'the chart', [{ path, name: 'chart.png' }])
    expect(result).toMatchObject({ reply_id: 'r1', status: 'sent', files: ['chart.png'] })
    expect(sendReplies).not.toHaveBeenCalled()
  })
  it('flushes replies while the message still waits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'send-file-'))
    const path = join(directory, 'a.txt')
    await writeFile(path, 'x')
    const { host: toolHost, sendReplies } = host('pending')
    await sendFileTool(toolHost, ticket).execute({ text: 'f', files: [path] } as never, new AbortController().signal)
    expect(sendReplies).toHaveBeenCalled()
  })
  it('refuses a missing file, a directory and a relative path before queuing anything', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'send-file-'))
    const { host: toolHost, replyWithFiles } = host()
    const run = (files: string[]) => sendFileTool(toolHost, ticket).execute({ text: 'f', files } as never, new AbortController().signal)
    await expect(run([join(directory, 'nope.txt')])).rejects.toThrow(/No such file/)
    await expect(run([directory])).rejects.toThrow(/Not a regular file/)
    await expect(run(['relative.txt'])).rejects.toThrow(/absolute path/)
    expect(replyWithFiles).not.toHaveBeenCalled()
  })
  it('allows at most ten files per call', () => {
    expect(MAX_SENT_FILES).toBe(10)
  })
})
