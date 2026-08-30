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

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { registerUnityTools } from './tools.ts'
import type { UnityToolsConfig } from './tools.ts'
import { registerUnitySkills } from './skill.ts'
import type { UnitySkillsConfig } from './skill.ts'
import { UNITY_SKILLS_DEFAULT_REF, UNITY_SKILLS_DEFAULT_REPO } from './unity-skills-fetch.ts'

export type { UnityToolsConfig } from './tools.ts'
export type { UnitySkillsConfig } from './skill.ts'
export type { UnityJson, UnityJsonResult, UnityRunResult, UnityRunSpec } from './unity-cli.ts'

export const name = 'unity'
export const inject = ['tools', 'subprocess']

/** Deployment configuration for the Unity CLI integration. */
export type Config = UnityToolsConfig & UnitySkillsConfig

/** Schemastery configuration; defaults suit a local interactive install of the `unity` CLI. */
export const Config: Schema<Config> = Schema.object({
  unityBin: Schema.string().default('unity'),
  projectPath: Schema.string(),
  // The three tunables the settings card also edits reject non-positive
  // values here for the same reason they do there: defineTool refuses a
  // timeout of zero or less, so such a config cannot mount the tools.
  commandTimeoutMs: Schema.number().min(1).default(120_000),
  cliTimeoutMs: Schema.number().min(1).default(600_000),
  graceMs: Schema.number().default(5_000),
  outputMaxBytes: Schema.number().min(1).default(512_000),
  env: Schema.dict(Schema.string()).default({}),
  warmShell: Schema.boolean().default(true),
  shellIdleMs: Schema.number().default(300_000),
  unitySkillsRepo: Schema.string().default(UNITY_SKILLS_DEFAULT_REPO).description(
    'Git URL of the Unity skill collection; set empty to disable the download.'),
  unitySkillsRef: Schema.string().default(UNITY_SKILLS_DEFAULT_REF).description(
    'Commit, tag, or branch of the Unity skills to fetch; fetched once per value, changing it re-fetches.'),
  unitySkillsCacheDir: Schema.string().description(
    'Cache directory for the downloaded collection; defaults to <dshHome>/cache/unity-plugin/unity-skills.'),
})

/**
 * Register the `unity_*` tools and, when a skills registry is composed, the
 * skill roots. The skill child activates lazily so assemblies without the
 * skills seam stay unaffected.
 * @param ctx - registrant context carrying the tool registry and subprocess service.
 * @param config - the deployment's Unity CLI configuration.
 */
export function apply(ctx: Context, config: Config): void {
  registerUnityTools(ctx, config)
  ctx.inject(['skills'], (skillsCtx) => {
    registerUnitySkills(skillsCtx, config)
  })
}
