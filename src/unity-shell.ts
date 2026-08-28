/**
 * Warm `unity shell --protocol ndjson` sessions: one long-lived CLI process
 * answering many envelope commands, so live-Editor tools skip the per-call
 * CLI start cost. Requests are `{"id","argv"}` JSON lines on stdin; responses
 * are `{"id","exitCode","envelope"}` lines on stdout, serialized one at a
 * time (REPL semantics). A request abort kills the whole session tree —
 * one request inside a shared process cannot be cancelled alone — and the
 * next call respawns lazily.
 * @module unity-plugin/unity-shell
 */

import type { Writable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { UnityJson, UnityJsonResult } from './unity-cli.ts'

/** Constant spawn facts shared by every session of one pool. */
export interface UnityShellPoolSpec {
  /** The `unity` executable — a PATH-resolved name or an absolute path. */
  bin: string
  /** Explicit environment entries merged after the subprocess seam's credential scrub. */
  env: Record<string, string>
  /** TERM-to-KILL escalation grace in milliseconds. */
  graceMs: number
  /** Cap on one response line and on the collected stderr tail, in bytes. */
  outputMaxBytes: number
  /** Idle milliseconds after which a session with no queued work is disposed. */
  idleMs: number
}

/** One queued shell request awaiting its response line. */
interface PendingRequest {
  id: number
  argv: readonly string[]
  signal: AbortSignal
  resolve: (result: UnityJsonResult) => void
  reject: (error: Error) => void
  /** Removes this request's abort listener once it settles. */
  unlisten: () => void
}

/** Tail of collected stderr kept in a thrown diagnostic, in characters. */
const DIAGNOSTIC_TAIL_CHARS = 2000

/** @returns the last {@link DIAGNOSTIC_TAIL_CHARS} characters of `text`. */
function diagnosticTail(text: string): string {
  return text.length > DIAGNOSTIC_TAIL_CHARS ? text.slice(-DIAGNOSTIC_TAIL_CHARS) : text
}

/**
 * One live `unity shell` process. Requests are serialized: a request is
 * written only after the previous response line arrived, so response-to-id
 * matching can never interleave. Any protocol breach — a non-JSON line, an
 * id mismatch, an oversized line, process exit — is fatal to the session:
 * every pending request rejects and the pool discards the session.
 */
class UnityShellSession {
  private readonly spec: UnityShellPoolSpec
  private readonly handle: SubprocessHandle
  private readonly stdin: Writable
  private buffer = ''
  private readonly queue: PendingRequest[] = []
  private inflight: PendingRequest | undefined
  private nextId = 1
  private deadError: Error | undefined

  /** Fires after each settled request that leaves the session idle. */
  onIdle: (() => void) | undefined

  /**
   * Spawn the shell process and wire protocol decoding.
   * @param ctx - plugin context carrying the `subprocess` service.
   * @param spec - constant spawn facts.
   * @param cwd - working directory of the shell process.
   */
  constructor(ctx: Context, spec: UnityShellPoolSpec, cwd: string) {
    this.spec = spec
    this.handle = ctx.subprocess.spawn({
      argv: [spec.bin, 'shell', '--protocol', 'ndjson', '--non-interactive', '--no-banner', '--quiet'],
      cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: spec.outputMaxBytes },
      },
      graceMs: spec.graceMs,
      env: spec.env,
    })
    // 'pipe' dispositions guarantee both streams on the handle.
    const stdout = this.handle.stdout
    const stdin = this.handle.stdin
    if (stdout === undefined || stdin === undefined) {
      this.handle.terminate()
      throw new Error('unity shell spawn returned no piped stdio (subprocess provider contract breach)')
    }
    this.stdin = stdin
    stdout.setEncoding('utf8')
    stdout.on('data', (chunk: string) => { this.onStdout(chunk) })
    this.handle.done.then(
      (outcome) => {
        const exit = outcome.exitCode === null ? `killed by ${outcome.signal ?? 'signal'}` : `exit code ${outcome.exitCode}`
        this.fail(new Error(
          `unity shell session ended (${exit}). If this unity CLI version lacks \`unity shell\`, `
          + `set warmShell: false in the unity-plugin config.${this.stderrTailSuffix()}`,
        ))
      },
      (error: unknown) => {
        this.fail(new Error(
          `unity shell failed to start (is ${JSON.stringify(this.spec.bin)} installed and on PATH? `
          + `See https://docs.unity3d.com/hub/manual/CLI.html)${this.stderrTailSuffix()}`,
          { cause: error },
        ))
      },
    )
  }

  /** True once the session rejected and must be discarded. */
  get dead(): boolean {
    return this.deadError !== undefined
  }

  /** True while no request is in flight or queued. */
  get idle(): boolean {
    return this.inflight === undefined && this.queue.length === 0
  }

  /**
   * Run one envelope command through the warm process.
   * @param argv - CLI argv after `unity`, sent verbatim as the request's argv array.
   * @param signal - abort (tool timeout or caller cancellation); aborting an in-flight request kills the session.
   * @returns the response's exit code and parsed envelope.
   */
  request(argv: readonly string[], signal: AbortSignal): Promise<UnityJsonResult> {
    return new Promise<UnityJsonResult>((resolve, reject) => {
      if (this.deadError !== undefined) {
        reject(this.deadError)
        return
      }
      if (signal.aborted) {
        reject(new Error('unity shell request was aborted before start (tool timeout or caller cancellation)'))
        return
      }
      const pending: PendingRequest = { id: this.nextId++, argv, signal, resolve, reject, unlisten: () => {} }
      const onAbort = (): void => { this.abort(pending) }
      signal.addEventListener('abort', onAbort, { once: true })
      pending.unlisten = () => { signal.removeEventListener('abort', onAbort) }
      this.queue.push(pending)
      this.pump()
    })
  }

  /** Idempotently end the session: close stdin, reject outstanding requests, and start the TERM-to-KILL escalation. */
  dispose(): void {
    try {
      this.stdin.end()
    } catch {
      // The pipe may already be destroyed by process exit; fail() below settles the tree either way.
    }
    this.fail(new Error('unity shell session was disposed'))
  }

  /** Write the next queued request when none is in flight. */
  private pump(): void {
    if (this.deadError !== undefined || this.inflight !== undefined) return
    const next = this.queue.shift()
    if (next === undefined) return
    this.inflight = next
    try {
      this.stdin.write(`${JSON.stringify({ id: next.id, argv: next.argv })}\n`, () => {
        // A write error means the child is gone or dying; handle.done settles
        // next with the authoritative spawn/exit error, which fails the
        // session. Failing here first would mask that error (e.g. reporting
        // EPIPE for a missing binary).
      })
    } catch {
      // A destroyed stdin stream throws synchronously; same deferral as above.
    }
  }

  /** Decode complete response lines from a stdout chunk. */
  private onStdout(chunk: string): void {
    if (this.deadError !== undefined) return
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (line.trim().length > 0) this.onLine(line)
      if (this.deadError !== undefined) return
      newline = this.buffer.indexOf('\n')
    }
    if (this.buffer.length > this.spec.outputMaxBytes) {
      this.fail(new Error(
        `unity shell response exceeded the configured outputMaxBytes cap (${this.spec.outputMaxBytes}); raise it in the plugin config`,
      ))
    }
  }

  /** Match one response line to the in-flight request and settle it. */
  private onLine(line: string): void {
    let parsed: UnityJson
    try {
      parsed = JSON.parse(line) as UnityJson
    } catch {
      this.fail(new Error(`unity shell wrote a non-JSON line: ${diagnosticTail(line)}`))
      return
    }
    const inflight = this.inflight
    if (
      typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
      || inflight === undefined || parsed.id !== inflight.id
      || typeof parsed.exitCode !== 'number' || !('envelope' in parsed)
    ) {
      this.fail(new Error(`unity shell wrote an unexpected response line: ${diagnosticTail(line)}`))
      return
    }
    this.inflight = undefined
    inflight.unlisten()
    inflight.resolve({ exitCode: parsed.exitCode, envelope: parsed.envelope })
    this.pump()
    if (this.idle) this.onIdle?.()
  }

  /** Settle one request's abort: dequeue a waiting request, kill the session for an in-flight one. */
  private abort(pending: PendingRequest): void {
    const queued = this.queue.indexOf(pending)
    if (queued !== -1) {
      this.queue.splice(queued, 1)
      pending.unlisten()
      pending.reject(new Error('unity shell request was aborted (tool timeout or caller cancellation)'))
      if (this.idle) this.onIdle?.()
      return
    }
    if (this.inflight === pending) {
      this.fail(new Error('unity shell request was aborted (tool timeout or caller cancellation); the warm session was killed and will respawn on the next call'))
    }
  }

  /** Mark the session dead, reject everything outstanding, and terminate the tree. */
  private fail(error: Error): void {
    if (this.deadError !== undefined) return
    this.deadError = error
    const outstanding = [...(this.inflight === undefined ? [] : [this.inflight]), ...this.queue]
    this.inflight = undefined
    this.queue.length = 0
    for (const pending of outstanding) {
      pending.unlisten()
      pending.reject(error)
    }
    this.handle.terminate()
    this.onIdle?.()
  }

  /** @returns a `\nstderr tail:` suffix for diagnostics, empty when nothing was captured. */
  private stderrTailSuffix(): string {
    const tail = this.handle.collected.stderr?.readFrom(0).text ?? ''
    return tail.length === 0 ? '' : `\nstderr tail:\n${diagnosticTail(tail)}`
  }
}

/**
 * Warm-session pool: at most one live shell per working directory, created
 * lazily, replaced after death on the next request, and disposed after
 * {@link UnityShellPoolSpec.idleMs} without queued work. The pool never
 * falls back to cold spawns itself — a dead session's error surfaces to the
 * caller, keeping degraded environments loud.
 */
export class UnityShellPool {
  private readonly ctx: Context
  private readonly spec: UnityShellPoolSpec
  private readonly sessions = new Map<string, { session: UnityShellSession, idleTimer: NodeJS.Timeout | undefined }>()

  /**
   * Build the pool.
   * @param ctx - plugin context carrying the `subprocess` service.
   * @param spec - constant spawn facts shared by every session.
   */
  constructor(ctx: Context, spec: UnityShellPoolSpec) {
    this.ctx = ctx
    this.spec = spec
  }

  /**
   * Run one envelope command through the cwd's warm session, spawning or
   * respawning it as needed.
   * @param cwd - working directory keying (and hosting) the session.
   * @param argv - CLI argv after `unity`, sent verbatim.
   * @param signal - abort forwarded to the request (and, in flight, the session).
   * @returns the response's exit code and parsed envelope.
   */
  async runJson(cwd: string, argv: readonly string[], signal: AbortSignal): Promise<UnityJsonResult> {
    let entry = this.sessions.get(cwd)
    if (entry === undefined || entry.session.dead) {
      if (entry !== undefined) this.drop(cwd)
      const session = new UnityShellSession(this.ctx, this.spec, cwd)
      entry = { session, idleTimer: undefined }
      session.onIdle = () => { this.onSessionIdle(cwd) }
      this.sessions.set(cwd, entry)
    }
    if (entry.idleTimer !== undefined) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    }
    return await entry.session.request(argv, signal)
  }

  /** Dispose every session; the pool remains usable and respawns on demand. */
  disposeAll(): void {
    for (const cwd of [...this.sessions.keys()]) this.drop(cwd)
  }

  /** Arm (or run) the idle reaper for one session that just went quiet. */
  private onSessionIdle(cwd: string): void {
    const entry = this.sessions.get(cwd)
    if (entry === undefined) return
    if (entry.session.dead) {
      this.drop(cwd)
      return
    }
    if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer)
    entry.idleTimer = setTimeout(() => {
      const current = this.sessions.get(cwd)
      if (current?.session.idle === true || current?.session.dead === true) this.drop(cwd)
    }, this.spec.idleMs)
    entry.idleTimer.unref()
  }

  /** Remove and dispose one session. */
  private drop(cwd: string): void {
    const entry = this.sessions.get(cwd)
    if (entry === undefined) return
    this.sessions.delete(cwd)
    if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer)
    entry.session.dispose()
  }
}
