---
name: unity-workflow
description: Drive the Unity Editor with the unity_* tools — create or open a project, connect to a live Editor, build scenes and GameObjects, run C#, and save work. Use whenever making a Unity game or when a task involves Unity projects, scenes, prefabs, or the Unity Editor.
---

# Unity Editor workflow

Drive Unity through the `unity_*` tools. The `unity` CLI talks to a running Editor over its local Pipeline server (the `com.unity.pipeline` package), so scene operations round-trip in well under a second with no recompile or domain reload.

## Cardinal rules

- **Always call `unity_status` first.** Never assume an Editor is running, and never hand-edit `.unity`, `.prefab`, or `.asset` YAML while a live Editor is reachable — the Editor overwrites or ignores such edits invisibly. Fall back to direct file edits only after confirming no Editor is connected.
- **Discover commands at runtime.** The Editor command set varies by Unity version, Pipeline package version, and project (projects register custom `[CliCommand]` tools). Call `unity_list_commands` before the first `unity_command` in a session; do not assume a command exists.
- **Save your work.** After scene mutations, call `unity_command save_scene` (or `save_all`).

## Getting a drivable Editor

1. Check prerequisites once: `unity_cli ["auth", "status"]`, `unity_cli ["license", "status"]`, `unity_cli ["editors", "--installed"]`.
2. New project: `unity_cli ["templates", "list", "--editor", "lts"]` to pick a real template id (never guess), then `unity_cli ["projects", "create", "<Name>", "--path", "<dir>", "--editor-version", "lts", "--template", "<id>"]`.
3. Enable live control once per project: `unity_cli ["pipeline", "install", "--project-path", "<project>"]`.
4. Open the Editor: `unity_cli ["open", "<project>", "--args", "-automated"]`, then poll `unity_status` until an instance reports state `"ready"` (the first open of a new project imports assets and can take minutes — use generous patience, not tight loops).
5. Mutate via `unity_command` / `unity_eval`.

**Always launch the Editor with `-automated`.** It tells Unity the session is machine-driven, so interactive dialogs and prompts do not appear and block the agent. The `unity` CLI has no dedicated flag for it: pass it through with `--args "-automated"` (add further Editor arguments to the same string, e.g. `--args "-automated -disable-assembly-updater"`).

A headless alternative for CI: launch the Editor binary directly with `-automated -batchmode -projectPath <p>` and no `-quit`. Such an Editor answers commands but may not appear in `unity_status` — gate on `unity_list_commands` succeeding instead.

## Typical scene loop

- `unity_command get_scene_hierarchy` to orient.
- `unity_command create_gameobject --args ["--name", "Player"]`, then `set_transform`, `add_component`.
- New behaviour: `create_script` → `recompile` → poll `recompile_status` until `completed` → `attach_script`. Expect a brief connection loss during recompiles.
- `unity_eval` for anything without a dedicated command — full `UnityEngine`/`UnityEditor` access; end the code with `return <expr>;`.
- `unity_command screenshot --args ["--output", "<path>"]` to see the result; `unity_command editor_play` / `editor_status` to test.
- `unity_command save_scene` when done.

## Tests, builds, packages

- Tests: `unity_cli ["test", "<project>", ...]` (EditMode/PlayMode, NUnit XML output).
- Builds: `unity_cli ["build", ...]` requires `--target` and `--execute-method` — Unity has no built-in CLI build; the named static C# method performs the build.
- UPM packages: the CLI does not manage packages. Add them via `unity_eval` with `UnityEditor.PackageManager.Client.Add(...)` (poll the returned request until done), never by hand-editing `Packages/manifest.json` while an Editor is live.

## Troubleshooting

- `STATUS_NO_INSTANCES` from `unity_status`: no running Editor has the Pipeline package — open the project, or run `pipeline install` first.
- Exit code 3 = auth failure, 4 = missing license (both from `unity_cli`); a resident Editor holds a license seat until it exits.
- Editor logs: `unity_cli ["logs"]`; diagnostics: `unity_cli ["doctor"]`.
