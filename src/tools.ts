/**
 * The `unity_*` tool consumers: five model-facing tools over the `unity` CLI.
 * Live-Editor operations (`unity_status`, `unity_list_commands`,
 * `unity_command`, `unity_eval`) parse the CLI's `--format json` envelope;
 * `unity_cli` is the raw escape hatch for everything else (project creation,
 * editor installs, tests, builds).
 * @module unity-plugin/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
// Type-only: the ctx.settings Context merge for the optional settings seam.
import type {} from '@deepseek-ai/dsh-settings'
import { runUnity, runUnityJson } from './unity-cli.ts'
import type { UnityJsonResult, UnityRunSpec } from './unity-cli.ts'
import { UnityShellPool } from './unity-shell.ts'
import { UNITY_SETTINGS_NAMESPACE, UnityTunables, tunablesOf } from './settings.ts'

/** Deployment configuration consumed by the tool consumers. */
export interface UnityToolsConfig {
  /** The `unity` executable — a PATH-resolved name or an absolute path. */
  unityBin: string
  /** Default Unity project path targeted by live-Editor tools; per-call `projectPath` overrides it. */
  projectPath?: string
  /** Cooperative timeout budget for live-Editor tools, in milliseconds. */
  commandTimeoutMs: number
  /** Cooperative timeout budget for `unity_cli` (installs, tests, and builds run long), in milliseconds. */
  cliTimeoutMs: number
  /** TERM-to-KILL escalation grace for the CLI process tree, in milliseconds. */
  graceMs: number
  /** In-memory cap per collected output stream, in bytes. */
  outputMaxBytes: number
  /** Explicit environment entries for the CLI (e.g. `UNITY_SERVICE_ACCOUNT_ID`), merged after the subprocess credential scrub. */
  env: Record<string, string>
  /** Route the live-Editor tools through a warm `unity shell --protocol ndjson` session instead of one CLI process per call. */
  warmShell: boolean
  /** Idle milliseconds after which a warm shell session with no queued work is disposed. */
  shellIdleMs: number
}

/** Shared output declaration of the envelope-returning tools. */
const ENVELOPE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    exitCode: {
      type: 'integer',
      required: true,
      description: 'unity CLI process exit code (0 on success; the envelope carries the failure details otherwise).',
    },
    envelope: {
      type: 'json',
      required: true,
      description: 'Parsed unity CLI JSON envelope: { success, command, data, errors, warnings }. Check `success` before relying on `data`.',
    },
  },
} as const

/** Raw output declaration of the `unity_cli` escape hatch. */
const RAW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    exitCode: {
      oneOf: [{ type: 'integer' }, { type: 'null' }],
      required: true,
      description: 'Process exit code; null when killed by a signal.',
    },
    signal: {
      oneOf: [{ type: 'string' }, { type: 'null' }],
      required: true,
      description: 'Terminating signal name; null on normal exit.',
    },
    stdout: { type: 'string', required: true },
    stderr: { type: 'string', required: true },
    stdoutTruncated: { type: 'boolean', required: true, description: 'True when stdout overflowed the cap and lost its head.' },
    stderrTruncated: { type: 'boolean', required: true, description: 'True when stderr overflowed the cap and lost its head.' },
  },
} as const

/** Optional per-call project override shared by the live-Editor tools. */
const PROJECT_PATH_PARAMETER = {
  type: 'string',
  description: 'Absolute path of the Unity project whose Editor to target; omit to use the plugin\'s configured default (or the only running Editor).',
} as const

/**
 * Register the five `unity_*` tools on `ctx.tools`, remounting them whenever
 * the `unity` settings namespace commits a change to the user-editable
 * tunables (timeouts and the output cap). Without a composed settings seam
 * the composition config applies unchanged. A remount also disposes the warm
 * shell pool, so in-flight warm requests reject and sessions respawn with the
 * new caps.
 * @param ctx - registrant context carrying the tool registry and subprocess service.
 * @param config - the deployment's Unity CLI configuration.
 */
export function registerUnityTools(ctx: Context, config: UnityToolsConfig): void {
  let source: () => UnityTunables = () => tunablesOf(config)
  let dispose: (() => void) | undefined
  const mount = (): void => {
    const next = source()
    const rejection = unmountableTunables(next)
    if (rejection !== undefined) {
      // Disposing first and throwing on the way back up would unregister all
      // five tools and never re-register them, leaving the session with no
      // unity_* tools and no way to recover from the settings card. Nothing
      // is mounted yet on the first call, so a composition config this broken
      // still fails the load loudly instead of starting a plugin with no tools.
      if (dispose === undefined) throw new Error(`unity-plugin: ${rejection}`)
      ctx.logger.warn(`unity-plugin: ignoring an unusable unity settings change (${rejection}); keeping the previous values`)
      return
    }
    dispose?.()
    dispose = mountUnityTools(ctx, config, next)
  }
  ctx.effect(() => () => {
    dispose?.()
    dispose = undefined
  }, 'unity tools')
  mount()
  // The settings seam is optional: without a composed provider the tools keep
  // the composition config; with one, the provider owns attach, fallback on
  // detach, and change notification for this consumer's namespace.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, UNITY_SETTINGS_NAMESPACE, UnityTunables, tunablesOf(config), {
      setSource: (current) => { source = current },
      onChange: mount,
    })
  })
}

/**
 * Check a tunable set against what the tool registry will actually accept:
 * `defineTool` throws for a `timeoutMs` of zero or less, and a non-positive
 * output cap collects nothing. The settings schema refuses these at the write,
 * so this is the backstop for a section that reached the source another way.
 * @param tunables - the candidate values.
 * @returns a reason the set cannot be mounted, or undefined when it can.
 */
function unmountableTunables(tunables: UnityTunables): string | undefined {
  for (const field of ['commandTimeoutMs', 'cliTimeoutMs', 'outputMaxBytes'] as const) {
    const value = tunables[field]
    if (!Number.isFinite(value) || value <= 0) return `${field} must be a positive number, got ${value}`
  }
  return undefined
}

/**
 * Register the tools and warm pool for one resolved tunable set.
 * @param ctx - registrant context carrying the tool registry and subprocess service.
 * @param config - the deployment's Unity CLI configuration (non-tunable fields).
 * @param tunables - the currently authoritative user-editable values.
 * @returns the disposer unregistering the five tools and disposing the pool.
 */
function mountUnityTools(ctx: Context, config: UnityToolsConfig, tunables: UnityTunables): () => void {
  const disposers: (() => void)[] = []
  /** The calling agent's session cwd, else the harness process cwd. */
  const cwdOf = (exec: ToolRunContext): string => exec.agent?.session.header.cwd ?? process.cwd()

  /** `--project-path` flags for the effective target project, empty when none is known. */
  const projectFlags = (override: string | undefined): string[] => {
    const path = override ?? config.projectPath
    return path === undefined ? [] : ['--project-path', path]
  }

  /** One fully-resolved spec for a JSON-envelope invocation. */
  const jsonSpec = (exec: ToolRunContext, args: readonly string[]): UnityRunSpec => ({
    bin: config.unityBin,
    args: [...args, '--format', 'json', '--non-interactive'],
    cwd: cwdOf(exec),
    env: config.env,
    graceMs: config.graceMs,
    outputMaxBytes: tunables.outputMaxBytes,
    signal: exec.signal,
  })

  /** Warm-session pool behind the live-Editor tools; absent when `warmShell` is off. */
  const pool = config.warmShell
    ? new UnityShellPool(ctx, {
        bin: config.unityBin,
        env: config.env,
        graceMs: config.graceMs,
        outputMaxBytes: tunables.outputMaxBytes,
        idleMs: config.shellIdleMs,
      })
    : undefined
  if (pool !== undefined) {
    disposers.push(() => { pool.disposeAll() })
  }

  /** Run one envelope invocation through the warm session, or per-call when `warmShell` is off. */
  const runJson = async (exec: ToolRunContext, args: readonly string[]): Promise<UnityJsonResult> => {
    const spec = jsonSpec(exec, args)
    if (pool === undefined) return await runUnityJson(ctx, spec)
    return await pool.runJson(spec.cwd, spec.args, spec.signal)
  }

  disposers.push(ctx.tools.register(defineTool({
    name: 'unity_status',
    description:
      'Report the Unity Editor instances currently reachable by the unity CLI. '
      + 'success=false with a STATUS_NO_INSTANCES error means no running Editor has the Pipeline package loaded '
      + '(open one with unity_cli ["open", "<project>", "--args", "-automated"], then poll this until state is "ready"). '
      + 'Run this before live-Editor operations and BEFORE editing scene or asset files directly — '
      + 'never hand-edit .unity/.prefab/.asset files while a live Editor is reachable.',
    parameters: {},
    output: {
      schema: ENVELOPE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.envelope, null, 2) }],
    },
    timeoutMs: tunables.commandTimeoutMs,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      return await runJson(exec, ['status'])
    },
    presentCall: () => ({ card: 'generic', title: 'Check Unity Editor status', kind: 'read' }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'unity_list_commands',
    description:
      'List every command the connected Unity Editor exposes, with full parameter schemas. '
      + 'The command set is Editor- and project-defined (projects register custom [CliCommand] tools), '
      + 'so discover names here rather than assuming a command exists before calling unity_command.',
    parameters: { projectPath: PROJECT_PATH_PARAMETER },
    output: {
      schema: ENVELOPE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.envelope, null, 2) }],
    },
    timeoutMs: tunables.commandTimeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return await runJson(exec, ['command', ...projectFlags(args.projectPath)])
    },
    presentCall: () => ({ card: 'generic', title: 'List Unity Editor commands', kind: 'read' }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'unity_command',
    description:
      'Run one named command on a running Unity Editor — e.g. create_gameobject, find_gameobjects, '
      + 'get_scene_hierarchy, set_transform, add_component, save_scene, editor_play, screenshot. '
      + 'Discover available names and their parameters with unity_list_commands first. '
      + 'Round-trips complete in under a second with no domain reload. '
      + 'Pass command parameters as raw CLI flag/value elements in `args`, e.g. ["--name", "Player", "--x", "1.5"].',
    parameters: {
      command: { type: 'string', required: true, description: 'The Editor command name, exactly as unity_list_commands reports it.' },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Raw CLI arguments appended verbatim after the command name (argv elements, never shell-quoted). Omit for a command with no parameters.',
      },
      projectPath: PROJECT_PATH_PARAMETER,
    },
    output: {
      schema: ENVELOPE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.envelope, null, 2) }],
    },
    timeoutMs: tunables.commandTimeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return await runJson(exec, ['command', args.command, ...(args.args ?? []), ...projectFlags(args.projectPath)])
    },
    presentCall: args => ({ card: 'generic', title: `Unity: ${args.command}`, kind: 'execute', rawInput: args.args }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'unity_eval',
    description:
      'Execute C# in a running Unity Editor and return the result. The code runs inside the Editor process '
      + 'with full UnityEngine/UnityEditor API access and no domain reload; end with a `return` statement to '
      + 'produce a value (e.g. `return Application.unityVersion;`). '
      + 'Requires an Editor whose Pipeline package exposes the eval command (verify with unity_list_commands).',
    parameters: {
      code: { type: 'string', required: true, description: 'C# statements to run in the Editor; end with `return <expr>;` to produce output.' },
      projectPath: PROJECT_PATH_PARAMETER,
    },
    output: {
      schema: ENVELOPE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.envelope, null, 2) }],
    },
    timeoutMs: tunables.commandTimeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return await runJson(exec, ['command', 'eval', args.code, ...projectFlags(args.projectPath)])
    },
    presentCall: args => ({ card: 'generic', title: 'Run C# in the Unity Editor', kind: 'execute', rawInput: args.code }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'unity_cli',
    description:
      'Run any unity CLI subcommand (the argv after `unity`) — the tool for everything that does not need a '
      + 'live Editor: ["projects", "create", ...], ["templates", "list", "--editor", "lts"], '
      + '["open", "<project>", "--args", "-automated"] (always launch the Editor with -automated so interactive dialogs cannot block the agent), '
      + '["pipeline", "install", "--project-path", "<project>"], ["editors", "--installed"], ["test", ...], '
      + '["build", ...], ["auth", "status"], ["license", "status"], ["logs"]. '
      + 'Runs with --non-interactive, so commands needing interactive input fail loud instead of hanging; '
      + 'pass "--yes"/"--accept-eula" explicitly where required. Add "--format", "json" for machine-readable '
      + 'output. For live-Editor scene operations prefer unity_command.',
    parameters: {
      args: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Argv elements after `unity`, appended verbatim (never shell-quoted).',
      },
    },
    output: {
      schema: RAW_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const status = value.exitCode === null ? `killed by ${value.signal ?? 'signal'}` : `exit code ${value.exitCode}`
        const parts = [`${status}`]
        if (value.stdout.length > 0) parts.push(`stdout${value.stdoutTruncated ? ' (truncated to tail)' : ''}:\n${value.stdout}`)
        if (value.stderr.length > 0) parts.push(`stderr${value.stderrTruncated ? ' (truncated to tail)' : ''}:\n${value.stderr}`)
        return [{ type: 'text', text: parts.join('\n') }]
      },
    },
    timeoutMs: tunables.cliTimeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const argv = args.args.includes('--non-interactive') ? args.args : [...args.args, '--non-interactive']
      return await runUnity(ctx, {
        bin: config.unityBin,
        args: argv,
        cwd: cwdOf(exec),
        env: config.env,
        graceMs: config.graceMs,
        outputMaxBytes: tunables.outputMaxBytes,
        signal: exec.signal,
      })
    },
    presentCall: args => ({ card: 'terminal', title: `unity ${args.args.join(' ')}` }),
  })))

  return () => {
    for (const dispose of disposers) dispose()
  }
}
