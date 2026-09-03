English | [中文](README.zh.md)

# unity-plugin

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that lets the agent build Unity games by driving the Unity Editor through the official [`unity` CLI](https://docs.unity3d.com/hub/manual/CLI.html): project creation, live-Editor scene commands, in-Editor C# eval, tests, and builds.

## What it registers

| Tool | Purpose |
| --- | --- |
| `unity_status` | Report running Editor instances reachable via the Pipeline server. |
| `unity_list_commands` | Discover the connected Editor's command catalog with parameter schemas. |
| `unity_command` | Run one live-Editor command (`create_gameobject`, `get_scene_hierarchy`, `save_scene`, …); completes in under a second with no domain reload. |
| `unity_eval` | Execute C# inside the Editor process with full `UnityEngine`/`UnityEditor` access. |
| `unity_cli` | Raw escape hatch for every other CLI surface: `projects create`, `open`, `pipeline install`, `templates list`, `editors`, `test`, `build`, `auth`, `license`, `logs`. |

When the dsh deployment has skill support (a composed `skills` service; the standard profiles do), the plugin mounts two skill roots through `@deepseek-ai/dsh-skill-filesystem`:

- **Unity's official skill collection**, fetched at plugin activation from [Unity-Technologies/skills](https://github.com/Unity-Technologies/skills) (unity-cli, new-unity-project, build-live-game, the ui family, package management, physics, optimization, multiplayer, and more) into `<dshHome>/cache/unity-plugin/unity-skills`. The fetch is a shallow git clone of the configured `unitySkillsRef` (default: a pinned known-good commit; set a branch such as `main` to snapshot newer content). Content is fetched once per configured ref; changing the ref re-fetches. If the fetch fails, an existing cache keeps serving; with no cache the plugin logs a warning and runs with only its own skills. Mechanism and upstream-defect handling: [assets/UNITY-SKILLS-UPSTREAM.md](assets/UNITY-SKILLS-UPSTREAM.md).
- **The plugin's own skills** (`assets/skills/`): `unity-workflow`, the `unity_*` tool operating knowledge (status-first discipline, project bootstrap sequence, scene loop, build/test invocations), and `unity-asset-store`, search/download/install of the user's owned Asset Store purchases.

All mounted skills use the standard `bundled` rank, so a same-named project- or user-level skill overrides them.

When the deployment has user-settings support (a composed `settings` service; the standard profiles do), the plugin also registers the `unity` settings namespace (the user-editable subset: both timeouts and the output cap), and its browser half adds a **Unity Plugin** card to the dsh web GUI under Settings → Plugins → Plugin configuration. Values saved there override the composition config per user, mark themselves as overridden, and apply live: the tools and warm shell remount with the new values without a restart. Empty fields inherit the deployment configuration.

Live-Editor tools return the CLI's uniform JSON envelope (`{ success, command, data, errors, warnings }`) as structured output, so they compose cleanly with Code Mode.

## Prerequisites

- DeepSeek Harness 0.1.2-alpha.5 or newer. That line moved the settings consumer API onto the `settings` service and replaced `dsh-client-runtime` with `dsh-client-store`; the plugin follows it and no longer loads on 0.1.1.
- The `unity` CLI installed and authenticated (`unity auth status`), with an activated license.
- A Unity 6.0+ Editor for live control; the target project needs the `com.unity.pipeline` package (`unity pipeline install --project-path <p>`; the agent can run this itself via `unity_cli`).

## Install

Into a dsh profile (`dsh plugin add` passes the spec to `pnpm add`, so any spec pnpm accepts works):

```sh
dsh plugin --profile <name> add @opdsh/unity-plugin      # from npm
dsh plugin --profile <name> add github:opdsh/unity-plugin  # from GitHub
dsh plugin --profile <name> add /path/to/unity-plugin      # local checkout
dsh --profile <name> --dump-config                         # verify the "# == unity-plugin" layer
dsh --profile <name>
```

Installing from GitHub (rather than npm) builds the package through its `prepare` script, which pnpm blocks until the package is allowlisted. The first attempt fails with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`; add this to the profile's `pnpm-workspace.yaml` and re-run:

```yaml
onlyBuiltDependencies:
  - "@opdsh/unity-plugin"
```

A local checkout installs as a link and needs no allowlist entry, but you must build it yourself first (`pnpm install && pnpm build`).

The bundle patch inserts the plugin with schema defaults. Override configuration from the profile's `cordis.patch.yml` (a patch replaces the row's whole `config`):

```yaml
- insert:
    - id: unity
      name: '@opdsh/unity-plugin'
      config:
        unityBin: unity
        projectPath: /abs/path/to/MyGame   # default target for live-Editor tools
        commandTimeoutMs: 120000           # must be > 0
        cliTimeoutMs: 600000               # must be > 0
        graceMs: 5000
        outputMaxBytes: 512000             # must be > 0
        env: {}                            # e.g. UNITY_SERVICE_ACCOUNT_ID/SECRET for CI
        warmShell: true                    # live-Editor tools reuse one `unity shell` process
        shellIdleMs: 300000                # idle warm session disposal
        unitySkillsRepo: https://github.com/Unity-Technologies/skills  # '' disables the download
        unitySkillsRef: 87fac23d66a1f44f5e06c2935eccce0b40b9715a       # or a branch, e.g. main
```

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
```

The build emits two artifacts: `lib/index.mjs` (the Node half the dsh Loader imports) and `lib/client.js` (the browser half in the harness client-bundle shape, declared via `dsh.client` in package.json and served by the web GUI at `/plugins/@opdsh/unity-plugin/client.js`). The client-modules scan resolves the plugin **by package name** from the profile directory, so the browser half loads only when the plugin is installed into the profile (`dsh plugin add`); the absolute-path `--patch` dev overlay loads the Node half only.

To load from source against a deepseek-harness checkout without installing, write a patch overlay naming this checkout's entry point (the path must be absolute, and `pnpm install` must have run here first so the source imports resolve):

```yaml
# dev.cordis.yml
- insert:
    - id: unity
      name: '/abs/path/to/unity-plugin/src/index.ts'
```

Then run it from the deepseek-harness checkout:

```sh
pnpm dsh web --patch /abs/path/to/dev.cordis.yml
```

## Design notes

- Tools spawn the CLI through the harness `subprocess` service (`argv`, never shell-interpreted; bounded collected output; tree-scoped termination; abort signal forwarded so tool timeouts kill the process tree).
- The four live-Editor tools (`unity_status`, `unity_list_commands`, `unity_command`, `unity_eval`) run through a warm `unity shell --protocol ndjson` session (one long-lived CLI process per working directory; `{"id","argv"}` request lines, `{"id","exitCode","envelope"}` responses), cutting per-call latency from ~600 ms of CLI start to single-digit milliseconds. Requests serialize per session; a tool timeout or cancellation mid-request kills the session tree (one request in a shared process cannot be cancelled alone) and the next call respawns it; idle sessions are disposed after `shellIdleMs`. Set `warmShell: false` to fall back to one CLI process per call (e.g. a CLI version without `unity shell`). `unity_cli` always spawns per call: builds and tests run long and want raw streams, not a serialized REPL turn.
- Every invocation runs with `--non-interactive` so a command needing interactive input fails loud instead of hanging the agent.
- The subprocess service scrubs credential-shaped environment variables from the child; CI service-account credentials must be passed explicitly via the `env` config field.
- `commandTimeoutMs`, `cliTimeoutMs` and `outputMaxBytes` must be greater than zero: a timeout of zero or less is not a tool the registry will accept, so the schema refuses the value rather than letting it unregister the tools. The settings card marks such an entry invalid and blocks the save; a stored value that fails leaves the namespace on its last good one.
- Alternative integration: the CLI ships an MCP stdio server (`unity mcp`) exposing the same Editor commands. Connecting `@deepseek-ai/dsh-mcp-client` to it (`command: unity`, `args: [mcp]`) works with zero code, but forfeits dsh render cards, config validation, and curated tool descriptions. This plugin exists to provide those.

## Known limitations

- The Editor command set is discovered at runtime; this plugin does not pin or validate per-command parameter schemas.
- `unity_cli` pays one CLI process start per call by design (see Design notes); only the four live-Editor tools use the warm session.
