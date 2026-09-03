/**
 * The `unity` user-settings namespace: the user-editable subset of the plugin
 * configuration (timeouts and the output cap). Composition config in
 * cordis.yml stays authoritative as the `base` layer; the settings document
 * carries only user overrides, edited from the dsh settings UI card this
 * package's client half registers under the same namespace.
 * @module unity-plugin/settings
 */

import Schema from '@deepseek-ai/schemastery'
import type { UnityToolsConfig } from './tools.ts'

/**
 * Settings namespace shared by the Host registration and the browser card.
 * A literal: `SettingsProvider.installSection` validates the identifier shape
 * at the type level and parses it at the call, so no branded constructor exists.
 */
export const UNITY_SETTINGS_NAMESPACE = 'unity' as const

/** The user-editable tunables; every other config field stays cordis.yml-only. */
export interface UnityTunables {
  /** Cooperative timeout budget for live-Editor tools, in milliseconds. */
  commandTimeoutMs: number
  /** Cooperative timeout budget for `unity_cli`, in milliseconds. */
  cliTimeoutMs: number
  /** In-memory cap per collected output stream, in bytes. */
  outputMaxBytes: number
}

/**
 * Schemastery schema of the namespace; defaults mirror the plugin Config.
 * The minimums are load-bearing rather than cosmetic: `defineTool` rejects a
 * timeout of zero or less, so a section carrying one cannot be mounted, and
 * refusing it at the write keeps the namespace's last good value.
 */
export const UnityTunables: Schema<UnityTunables> = Schema.object({
  commandTimeoutMs: Schema.number().min(1).default(120_000).description(
    'Timeout for live-Editor tools (unity_status, unity_command, unity_eval), in milliseconds.'),
  cliTimeoutMs: Schema.number().min(1).default(600_000).description(
    'Timeout for unity_cli (installs, tests, and builds run long), in milliseconds.'),
  outputMaxBytes: Schema.number().min(1).default(512_000).description(
    'In-memory cap per collected CLI output stream, in bytes.'),
})

/**
 * The tunable subset of one composed plugin config — the settings `base` layer.
 * @param config - the deployment's Unity CLI configuration.
 * @returns the three user-editable fields.
 */
export function tunablesOf(config: UnityToolsConfig): UnityTunables {
  return {
    commandTimeoutMs: config.commandTimeoutMs,
    cliTimeoutMs: config.cliTimeoutMs,
    outputMaxBytes: config.outputMaxBytes,
  }
}
