/**
 * Spawn-backed `unity` CLI execution. Runs a plain argv vector through the
 * harness subprocess seam with bounded collected output, plus the
 * `--format json` variant whose stdout is one CLI JSON envelope.
 * @module unity-plugin/unity-cli
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** Lossless JSON value, the parse result of one CLI `--format json` stdout. */
export type UnityJson = null | boolean | number | string | UnityJson[] | { [key: string]: UnityJson }

/** One fully-resolved `unity` CLI invocation. */
export interface UnityRunSpec {
  /** The `unity` executable — a PATH-resolved name or an absolute path. */
  bin: string
  /** Arguments after the executable; argv elements, never shell-interpreted. */
  args: readonly string[]
  /** Working directory for the CLI process. */
  cwd: string
  /** Explicit environment entries merged after the subprocess seam's credential scrub. */
  env: Record<string, string>
  /** TERM-to-KILL escalation grace in milliseconds. */
  graceMs: number
  /** In-memory tail cap per output stream, in bytes. */
  outputMaxBytes: number
  /** Abort signal forwarded to the process tree (tool timeout or caller cancellation). */
  signal: AbortSignal
}

/** Exit and output facts of one completed `unity` CLI run. */
export interface UnityRunResult {
  /** Exit code; null when the process died from a signal. */
  exitCode: number | null
  /** Terminating signal name; null on normal exit. */
  signal: string | null
  /** Collected stdout (the retained tail when truncated). */
  stdout: string
  /** Collected stderr (the retained tail when truncated). */
  stderr: string
  /** True when stdout overflowed the cap and lost its head. */
  stdoutTruncated: boolean
  /** True when stderr overflowed the cap and lost its head. */
  stderrTruncated: boolean
}

/** Exit code plus the parsed envelope of one `--format json` run. */
export interface UnityJsonResult {
  /** Exit code of the CLI process (non-zero envelopes still parse). */
  exitCode: number
  /** Parsed CLI envelope: `{ success, command, data, errors, warnings }`. */
  envelope: UnityJson
}

/**
 * Run one `unity` CLI invocation to completion and collect both streams.
 * Throws only for process-level failures (spawn failure, abort); a non-zero
 * exit code is a result, not an error — the CLI reports failures in-band.
 * @param ctx - plugin context carrying the `subprocess` service.
 * @param spec - the fully-resolved invocation.
 * @returns exit facts and the collected output tails.
 */
export async function runUnity(ctx: Context, spec: UnityRunSpec): Promise<UnityRunResult> {
  if (spec.signal.aborted) {
    throw new Error('unity CLI run was aborted before start (tool timeout or caller cancellation)')
  }
  let handle: SubprocessHandle
  try {
    handle = ctx.subprocess.spawn({
      argv: [spec.bin, ...spec.args],
      cwd: spec.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: spec.outputMaxBytes },
        stderr: { maxBytes: spec.outputMaxBytes },
      },
      graceMs: spec.graceMs,
      signal: spec.signal,
      env: spec.env,
    } satisfies SubprocessSpawnSpec)
  } catch (error: unknown) {
    throw new Error(`unity CLI failed to start — is ${JSON.stringify(spec.bin)} installed and on PATH?`, { cause: error })
  }
  let outcome: SubprocessOutcome
  try {
    outcome = await handle.done
  } catch (error: unknown) {
    throw new Error(
      `unity CLI failed to start (is ${JSON.stringify(spec.bin)} installed and on PATH? `
      + 'See https://docs.unity3d.com/hub/manual/CLI.html)',
      { cause: error },
    )
  }
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (spec.signal.aborted) {
    throw new Error('unity CLI run was aborted (tool timeout or caller cancellation)')
  }
  return {
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    stdout: stdout?.text ?? '',
    stderr: stderr?.text ?? '',
    stdoutTruncated: stdout?.lossy ?? false,
    stderrTruncated: stderr?.lossy ?? false,
  }
}

/** Tail of a stream kept in a thrown diagnostic, in characters. */
const DIAGNOSTIC_TAIL_CHARS = 2000

/** @returns the last {@link DIAGNOSTIC_TAIL_CHARS} characters of `text`. */
function diagnosticTail(text: string): string {
  return text.length > DIAGNOSTIC_TAIL_CHARS ? text.slice(-DIAGNOSTIC_TAIL_CHARS) : text
}

/**
 * Run one `unity ... --format json` invocation and parse its stdout envelope.
 * The caller appends `--format json` itself; this helper owns only the exit
 * and parse checks. Throws when the process was killed by a signal, stdout
 * overflowed the cap (the envelope would be incomplete), or stdout is not JSON.
 * @param ctx - plugin context carrying the `subprocess` service.
 * @param spec - the fully-resolved invocation, already carrying `--format json`.
 * @returns the exit code and the parsed envelope.
 */
export async function runUnityJson(ctx: Context, spec: UnityRunSpec): Promise<UnityJsonResult> {
  const result = await runUnity(ctx, spec)
  if (result.exitCode === null) {
    throw new Error(`unity CLI was killed by signal ${result.signal ?? '(unknown)'}; stderr tail:\n${diagnosticTail(result.stderr)}`)
  }
  if (result.stdoutTruncated) {
    throw new Error('unity CLI JSON output exceeded the configured outputMaxBytes cap; raise it in the plugin config')
  }
  let envelope: UnityJson
  try {
    envelope = JSON.parse(result.stdout) as UnityJson
  } catch {
    throw new Error(
      `unity CLI did not return JSON (exit code ${result.exitCode}).\n`
      + `stdout tail:\n${diagnosticTail(result.stdout)}\nstderr tail:\n${diagnosticTail(result.stderr)}`,
    )
  }
  return { exitCode: result.exitCode, envelope }
}
