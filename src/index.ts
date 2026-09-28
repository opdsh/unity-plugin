/**
 * unity-plugin: Unity Editor control for DeepSeek Harness through the official
 * `unity` CLI. Registers five `unity_*` tools (Editor status, command
 * discovery, live-Editor commands, C# eval, and a raw CLI escape hatch) and,
 * when the skills seam is composed, two skill roots: this plugin's own
 * bundled skills, plus the Unity skill collection fetched at activation from
 * github.com/Unity-Technologies/skills.
 * Named exports preserve loader injection metadata.
 * @module unity-plugin
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
// Type-only: the ctx.settings Context merge for the optional page-policy seam.
import type {} from '@deepseek-ai/dsh-settings'
import { registerUnityTools } from './tools.ts'
import type { UnityToolsConfig } from './tools.ts'
import { registerUnitySkills } from './skill.ts'
import { watchConfig } from './live-config.ts'
import type { UnitySkillsConfig } from './skill.ts'
import { UNITY_SKILLS_DEFAULT_REF, UNITY_SKILLS_DEFAULT_REPO } from './unity-skills-fetch.ts'

export type { UnityToolsConfig } from './tools.ts'
export type { UnitySkillsConfig } from './skill.ts'
export type { UnityJson, UnityJsonResult, UnityRunResult, UnityRunSpec } from './unity-cli.ts'

export const name = 'unity'
export const inject = ['tools', 'subprocess']

/** Deployment configuration for the Unity CLI integration. */
export type Config = UnityToolsConfig & UnitySkillsConfig

/** The raw configuration the Loader parses: the volatile fields as plain values. */
export type ConfigInput = {
  [K in keyof Config]: Config[K] extends Volatile<infer T> ? T : Config[K]
}

/** Longest delay a Node timer honours; a larger one fires immediately. */
const MAX_TIMER_MS = 2_147_483_647

/**
 * Schemastery configuration; defaults suit a local interactive install of the
 * `unity` CLI. Every field but `env` is volatile, so the settings form on the
 * Plugins page edits it live; `env` carries CI credentials and stays in
 * cordis.patch.yml. Timeouts and caps reject non-positive values because
 * defineTool refuses a timeout of zero or less, and every duration is capped
 * at the longest delay a Node timer honours.
 */
export const Config: Schema<ConfigInput, Config> = Schema.object({
  unityBin: Schema.string().default('unity').description(
    'The unity executable: a name resolved through PATH, or an absolute path.').volatile(),
  projectPath: Schema.string().description(
    'Default Unity project the live-Editor tools target; a tool call may name another.').volatile(),
  commandTimeoutMs: Schema.number().min(1).max(MAX_TIMER_MS).default(120_000).description(
    'Timeout for live-Editor tools (unity_status, unity_command, unity_eval), in milliseconds.').volatile(),
  cliTimeoutMs: Schema.number().min(1).max(MAX_TIMER_MS).default(600_000).description(
    'Timeout for unity_cli (installs, tests, and builds run long), in milliseconds.').volatile(),
  graceMs: Schema.number().min(0).max(MAX_TIMER_MS).default(5_000).description(
    'Grace between asking a unity process tree to stop and killing it, in milliseconds.').volatile(),
  outputMaxBytes: Schema.number().min(1).default(512_000).description(
    'In-memory cap per collected CLI output stream, in bytes.').volatile(),
  env: Schema.dict(Schema.string()).default({}),
  warmShell: Schema.boolean().default(true).description(
    'Keep a warm unity shell session per project for the live-Editor tools.').volatile(),
  shellIdleMs: Schema.number().min(1).max(MAX_TIMER_MS).default(300_000).description(
    'Idle time after which a warm unity shell session is closed, in milliseconds.').volatile(),
  unitySkillsDownload: Schema.boolean().default(true).description(
    'Download Unity\'s official skill collection and offer it to the agent.').volatile(),
  unitySkillsRepo: Schema.string().default(UNITY_SKILLS_DEFAULT_REPO).description(
    'Git URL of the Unity skill collection; set empty to disable the download.').volatile(),
  unitySkillsRef: Schema.string().default(UNITY_SKILLS_DEFAULT_REF).description(
    'Commit, tag, or branch of the Unity skills to fetch; fetched once per value, changing it re-fetches.').volatile(),
  unitySkillsCacheDir: Schema.string().description(
    'Cache directory for the downloaded collection; defaults to <dshHome>/cache/unity-plugin/unity-skills.').volatile(),
})

/**
 * Register the `unity_*` tools and, when a skills registry is composed, the
 * skill roots. The skill child activates lazily so assemblies without the
 * skills seam stay unaffected.
 * @param ctx - registrant context carrying the tool registry and subprocess service.
 * @param config - the deployment's Unity CLI configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const watch = watchConfig(ctx)
  registerUnityTools(ctx, config, watch)
  // This package ships its own settings page, so Settings clients that build
  // pages from the schema skip this entry.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber), 'unity settings page policy')
  })
  ctx.inject(['skills'], (skillsCtx) => {
    registerUnitySkills(skillsCtx, config, watch)
  })
}
