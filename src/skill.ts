/**
 * Skill roots. Mounts the dsh filesystem skill provider twice: over this
 * package's `assets/skills/` directory (the plugin's own `unity-workflow`
 * and `unity-asset-store` skills), and — once the download settles — over
 * the cached Unity skill collection fetched at activation from
 * github.com/Unity-Technologies/skills (see unity-skills-fetch.ts). Reusing
 * the filesystem provider keeps SKILL.md frontmatter, bundle-directory
 * resources, and invocation-policy conventions identical to user- and
 * project-level skills; the `bundled` source rank keeps every mounted skill
 * overridable by a same-named project- or user-level skill.
 * @module unity-plugin/skill
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { ensureUnitySkills } from './unity-skills-fetch.ts'
import type { UnitySkillsFetchSpec } from './unity-skills-fetch.ts'

/** Absolute path of the plugin's own skill root shipped in the package. */
const BUNDLED_SKILL_DIR = fileURLToPath(new URL('../assets/skills/', import.meta.url))

/** The skill-facing subset of the plugin configuration. */
export interface UnitySkillsConfig {
  /** Git URL of the Unity skills repository; the empty string disables the download. */
  unitySkillsRepo: string
  /** Commit SHA, tag, or branch of the Unity skills to fetch. */
  unitySkillsRef: string
  /** Cache directory override for the downloaded collection. */
  unitySkillsCacheDir?: string
  /** TERM-to-KILL escalation grace for the fetch's git processes, in milliseconds. */
  graceMs: number
}

/**
 * Mount the plugin's own bundled skills immediately, then fetch (or reuse
 * the cached copy of) the Unity skill collection and mount it as a second
 * provider. A failed download degrades to the bundled root alone, with the
 * cause logged; plugin teardown aborts an in-flight fetch.
 * @param ctx - context whose `skills` service is ready.
 * @param config - the skill-facing plugin configuration.
 */
export function registerUnitySkills(ctx: Context, config: UnitySkillsConfig): void {
  ctx.plugin(skillFilesystem, {
    providerName: 'unity-plugin',
    includeDefaultRoots: false,
    bundledSkillDir: BUNDLED_SKILL_DIR,
    watch: false,
  })

  const abort = new AbortController()
  ctx.effect(() => () => { abort.abort() }, 'unity-plugin: skills fetch abort')
  const spec: UnitySkillsFetchSpec = {
    repo: config.unitySkillsRepo,
    ref: config.unitySkillsRef,
    cacheDir: config.unitySkillsCacheDir,
    graceMs: config.graceMs,
    signal: abort.signal,
  }
  void ensureUnitySkills(ctx, spec).then((cacheDir) => {
    if (cacheDir === undefined || abort.signal.aborted) return
    ctx.plugin(skillFilesystem, {
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
}
