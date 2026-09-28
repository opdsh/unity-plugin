/**
 * Skill roots. Mounts the dsh filesystem skill provider twice: over this
 * package's `assets/skills/` directory (the plugin's own `unity-workflow`
 * and `unity-asset-store` skills), and — once the download settles — over
 * the cached Unity skill collection fetched at activation from
 * github.com/Unity-Technologies/skills (see unity-skills-fetch.ts). Reusing
 * the filesystem provider keeps SKILL.md frontmatter, bundle-directory
 * resources, and invocation-policy conventions identical to user- and
 * project-level skills; the `bundled` source rank keeps every mounted skill
 * overridable by a same-named project- or user-level skill. The collection's
 * repository, ref, and cache directory are live-editable.
 * @module unity-plugin/skill
 */

import { fileURLToPath } from 'node:url'
import type { Context, Fiber, Volatile } from '@deepseek-ai/cordis'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { ensureUnitySkills } from './unity-skills-fetch.ts'
import type { UnitySkillsFetchSpec } from './unity-skills-fetch.ts'
import type { ConfigWatch } from './live-config.ts'

/** Absolute path of the plugin's own skill root shipped in the package. */
const BUNDLED_SKILL_DIR = fileURLToPath(new URL('../assets/skills/', import.meta.url))

/** The skill-facing subset of the plugin configuration; all live-editable. */
export interface UnitySkillsConfig {
  /** Whether to download the Unity skill collection at all. */
  unitySkillsDownload: Volatile<boolean>
  /** Git URL of the Unity skills repository; the empty string disables the download. */
  unitySkillsRepo: Volatile<string>
  /** Commit SHA, tag, or branch of the Unity skills to fetch. */
  unitySkillsRef: Volatile<string>
  /** Cache directory override for the downloaded collection. */
  unitySkillsCacheDir: Volatile<string | undefined>
  /** TERM-to-KILL escalation grace for the fetch's git processes, in milliseconds. */
  graceMs: Volatile<number>
}

/** The Config keys selecting the downloaded collection; a live edit to any of them swaps it. */
const SKILLS_CONFIG_KEYS = ['unitySkillsDownload', 'unitySkillsRepo', 'unitySkillsRef', 'unitySkillsCacheDir'] as const

/**
 * Mount the plugin's own bundled skills immediately, then fetch (or reuse
 * the cached copy of) the Unity skill collection and mount it as a second
 * provider. A failed download degrades to the bundled root alone, with the
 * cause logged. A live edit to the download switch, repository, ref, or
 * cache directory aborts any in-flight fetch, unmounts the collection, and
 * fetches the new one; plugin teardown aborts an in-flight fetch.
 * @param ctx - context whose `skills` service is ready.
 * @param config - the skill-facing plugin configuration.
 * @param watch - live-edit subscriptions on the plugin entry.
 */
export function registerUnitySkills(ctx: Context, config: UnitySkillsConfig, watch: ConfigWatch): void {
  ctx.plugin(skillFilesystem, {
    providerName: 'unity-plugin',
    includeDefaultRoots: false,
    bundledSkillDir: BUNDLED_SKILL_DIR,
    watch: false,
  })

  let dispose: (() => void) | undefined
  // Fetches share the cache and its staging path, and an abort stops only the
  // git steps, so each fetch starts after the one it replaces has settled.
  let settled: Promise<void> = Promise.resolve()
  const mount = (): void => {
    dispose?.()
    const upstream = mountUpstreamSkills(ctx, {
      // An empty repo is the switch cordis.patch.yml has always offered.
      repo: config.unitySkillsDownload.get() ? config.unitySkillsRepo.get() : '',
      ref: config.unitySkillsRef.get(),
      cacheDir: config.unitySkillsCacheDir.get(),
      graceMs: config.graceMs.get(),
    }, settled)
    dispose = upstream.dispose
    settled = upstream.settled
  }
  ctx.effect(() => () => {
    dispose?.()
    dispose = undefined
  }, 'unity-plugin: upstream skills')
  mount()
  ctx.effect(() => watch(SKILLS_CONFIG_KEYS, mount), 'unity-plugin: skills live config')
}

/**
 * Fetch one Unity skill collection and mount it once the download settles.
 * @param ctx - context whose `skills` service is ready.
 * @param spec - the collection to fetch, without its abort signal.
 * @param after - settlement of the fetch this one replaces.
 * @returns the disposer aborting the fetch and unmounting the collection, and this fetch's settlement.
 */
function mountUpstreamSkills(
  ctx: Context,
  spec: Omit<UnitySkillsFetchSpec, 'signal'>,
  after: Promise<void>,
): { dispose: () => void, settled: Promise<void> } {
  const abort = new AbortController()
  let provider: Fiber | undefined
  const settled = after.then(async () => {
    if (abort.signal.aborted) return undefined
    return await ensureUnitySkills(ctx, { ...spec, signal: abort.signal })
  }).then((cacheDir) => {
    if (cacheDir === undefined || abort.signal.aborted) return
    provider = ctx.plugin(skillFilesystem, {
      providerName: 'unity-plugin-upstream',
      includeDefaultRoots: false,
      bundledSkillDir: cacheDir,
      watch: false,
    })
  }).catch((error: unknown) => {
    // ensureUnitySkills contains fetch failures; this guards the mount itself
    // (e.g. a context disposed between the settle check and the plugin call).
    ctx.logger.warn('unity-plugin: mounting the downloaded Unity skills failed', error)
  })
  return {
    dispose: () => {
      abort.abort()
      void provider?.dispose()
    },
    settled,
  }
}
