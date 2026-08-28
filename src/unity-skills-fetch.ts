/**
 * Downloaded Unity skill collection: a shallow git fetch of one configured
 * ref of github.com/Unity-Technologies/skills into a local cache directory,
 * run through the harness subprocess seam at plugin activation. Content is
 * fetched once per configured ref (a marker file records it); changing the
 * ref re-fetches, and a branch name snapshots that branch at first fetch.
 * A failed fetch keeps an existing cache of any ref; with no cache the
 * caller degrades to the plugin's own bundled skills.
 * @module unity-plugin/unity-skills-fetch
 */

import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'

/** Pinned upstream commit fetched by default; known good under dsh's strict frontmatter parser (with {@link fixKnownFrontmatter}). */
export const UNITY_SKILLS_DEFAULT_REF = '87fac23d66a1f44f5e06c2935eccce0b40b9715a'

/** Upstream repository fetched by default. */
export const UNITY_SKILLS_DEFAULT_REPO = 'https://github.com/Unity-Technologies/skills'

/** Fetch configuration, resolved from the plugin config. */
export interface UnitySkillsFetchSpec {
  /** Git URL of the skills repository; the empty string disables the download entirely. */
  repo: string
  /** Commit SHA, tag, or branch to fetch. */
  ref: string
  /** Cache directory override; defaults to `<dshHome>/cache/unity-plugin/unity-skills`. */
  cacheDir?: string | undefined
  /** TERM-to-KILL escalation grace for the git processes, in milliseconds. */
  graceMs: number
  /** Overall abort for the fetch (plugin teardown). */
  signal: AbortSignal
}

/** @returns the sibling marker file recording which ref the cache came from (outside the mounted root, so the skill scan never sees it). */
function refMarkerPath(cacheDir: string): string {
  return `${cacheDir}.ref`
}

/** Time budget for the whole fetch, in milliseconds; generous for a shallow fetch of a docs repository. */
const FETCH_TIMEOUT_MS = 300_000

/** @returns the dsh config root (`$DSH_HOME` or `~/.dsh`), mirroring `@deepseek-ai/dsh-home-paths`. */
function dshHome(): string {
  const fromEnv = process.env.DSH_HOME
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

/** @returns the effective cache directory for `spec`. */
export function unitySkillsCacheDir(spec: Pick<UnitySkillsFetchSpec, 'cacheDir'>): string {
  return spec.cacheDir ?? join(dshHome(), 'cache', 'unity-plugin', 'unity-skills')
}

/**
 * Run one git invocation through the subprocess seam and throw on failure.
 * @param ctx - plugin context carrying the `subprocess` service.
 * @param spec - fetch configuration (grace and abort).
 * @param args - git argv after the executable.
 * @param cwd - working directory for the git process.
 */
async function runGit(ctx: Context, spec: UnitySkillsFetchSpec, signal: AbortSignal, args: readonly string[], cwd: string): Promise<void> {
  const handle = ctx.subprocess.spawn({
    argv: ['git', ...args],
    cwd,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 65_536 }, stderr: { maxBytes: 65_536 } },
    graceMs: spec.graceMs,
    signal,
  })
  const outcome = await handle.done
  if (outcome.exitCode !== 0) {
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    const exit = outcome.exitCode === null ? `killed by ${outcome.signal ?? 'signal'}` : `exit code ${outcome.exitCode}`
    throw new Error(`git ${args[0]} failed (${exit})${stderr === '' ? '' : `:\n${stderr.slice(-2000)}`}`)
  }
}

/**
 * Re-apply the known upstream frontmatter defect fix: the
 * `physics-3d-collision` description is a plain YAML scalar containing `: `
 * sequences, which dsh's spec-compliant parser rejects (the skill would
 * warn-and-skip). Rewritten as a `>-` folded block scalar; text unchanged.
 * A ref where upstream has fixed the file no longer matches and is left alone.
 * @param skillsDir - checked-out skills directory to fix in place.
 */
async function fixKnownFrontmatter(skillsDir: string): Promise<void> {
  const file = join(skillsDir, 'physics-3d-collision', 'SKILL.md')
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return
  }
  const match = /^description: (?![>|'"])(.*: .*)$/m.exec(text)
  if (match === null || match[1] === undefined) return
  await writeFile(file, text.replace(match[0], `description: >-\n  ${match[1]}`))
}

/**
 * Ensure the cache holds the configured ref's skills, fetching when needed.
 * @param ctx - plugin context carrying the `subprocess` service.
 * @param spec - fetch configuration.
 * @returns the cache directory to mount, or undefined when the download is
 * disabled or failed with no prior cache to fall back to.
 */
export async function ensureUnitySkills(ctx: Context, spec: UnitySkillsFetchSpec): Promise<string | undefined> {
  if (spec.repo === '') return undefined
  const cacheDir = unitySkillsCacheDir(spec)
  let cachedRef: string | undefined
  try {
    cachedRef = (await readFile(refMarkerPath(cacheDir), 'utf8')).trim()
  } catch {
    cachedRef = undefined
  }
  if (cachedRef === spec.ref) return cacheDir
  try {
    await fetchInto(ctx, spec, cacheDir)
    return cacheDir
  } catch (error: unknown) {
    if (cachedRef !== undefined) {
      ctx.logger.warn(`unity-plugin: fetching Unity skills ${spec.ref} failed; keeping the cached ${cachedRef}`, error)
      return cacheDir
    }
    ctx.logger.warn(
      'unity-plugin: fetching the Unity skill collection failed and no cache exists; '
      + 'continuing with only the plugin\'s own bundled skills (is git installed and the network reachable?)',
      error,
    )
    return undefined
  }
}

/**
 * Shallow-fetch the ref and atomically replace the cache with its `skills/`
 * directory plus the ref marker.
 * @param ctx - plugin context carrying the `subprocess` service.
 * @param spec - fetch configuration.
 * @param cacheDir - final cache directory.
 */
async function fetchInto(ctx: Context, spec: UnitySkillsFetchSpec, cacheDir: string): Promise<void> {
  await mkdir(join(cacheDir, '..'), { recursive: true })
  const clone = await mkdtemp(join(tmpdir(), 'unity-plugin-skills-'))
  const stage = `${cacheDir}.stage-${process.pid}`
  // One deadline over the whole fetch, composed with the plugin-teardown abort.
  const deadline = AbortSignal.any([spec.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
  try {
    await runGit(ctx, spec, deadline, ['init', '--quiet', clone], clone)
    await runGit(ctx, spec, deadline, ['remote', 'add', 'origin', spec.repo], clone)
    await runGit(ctx, spec, deadline, ['fetch', '--quiet', '--depth', '1', 'origin', spec.ref], clone)
    await runGit(ctx, spec, deadline, ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], clone)
    const skillsDir = join(clone, 'skills')
    const entries = await readdir(skillsDir).catch(() => [])
    if (entries.length === 0) {
      throw new Error(`ref ${spec.ref} of ${spec.repo} has no skills/ directory`)
    }
    await fixKnownFrontmatter(skillsDir)
    await rm(stage, { recursive: true, force: true })
    await cp(skillsDir, stage, { recursive: true })
    await rm(refMarkerPath(cacheDir), { force: true })
    await rm(cacheDir, { recursive: true, force: true })
    await rename(stage, cacheDir)
    await writeFile(refMarkerPath(cacheDir), `${spec.ref}\n`)
  } finally {
    await rm(clone, { recursive: true, force: true }).catch(() => {})
    await rm(stage, { recursive: true, force: true }).catch(() => {})
  }
}
