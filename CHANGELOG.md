# Changelog

All notable changes to `@opdsh/unity-plugin`. Versions follow [Semantic Versioning](https://semver.org/); dates are UTC.

## [0.1.7] - 2026-09-27

Requires DeepSeek Harness 0.1.7 or newer.

### Added
- Every Unity setting is now on the plugin's page (sidebar **Plugins** → **@opdsh/unity-plugin**), grouped into Unity CLI, Timeouts and limits, Warm shell, and Unity skills. Before, the page only had the two timeouts and the output cap. The new fields are the `unity` executable, default project path, kill grace, warm shell on/off, warm-shell idle timeout, and the Unity skill collection's download switch, repository, ref, and cache directory. Every change applies live without a restart.
- `unitySkillsDownload` config field (default `true`) to turn the Unity skill collection off. The form needs a dedicated switch because a blank text field means "use the default"; setting `unitySkillsRepo: ''` in `cordis.patch.yml` still disables the download too.

### Changed
- A live edit re-registers only the part it affects. Tool settings re-register the `unity_*` tools, which restarts warm shell sessions. Skills settings swap the downloaded collection and leave the tools and warm shells running. Collection downloads run one at a time, so rapid edits cannot overlap.
- Durations (`commandTimeoutMs`, `cliTimeoutMs`, `graceMs`, `shellIdleMs`) are capped at 2147483647 ms, the longest delay a Node timer honours; a larger value used to make every call time out immediately. `graceMs` must be at least 0 and `shellIdleMs` above 0.

### Security
- `env` (CI service-account credentials) stays editable only in `cordis.patch.yml`, so it never reaches the browser.

## [0.1.6] - 2026-09-27

Requires DeepSeek Harness 0.1.7 or newer; stay on 0.1.5 for older Harness releases.

### Fixed
- The plugin no longer blocks the web UI from loading on DeepSeek Harness 0.1.7 ("Failed to load plugins … waiting for service: settingsScope"). ([#9](https://github.com/opdsh/unity-plugin/issues/9), [#10](https://github.com/opdsh/unity-plugin/pull/10))

### Changed
- Settings moved from **Settings → Plugins → Plugin configuration** to the plugin's own page under **Plugins** in the sidebar, following the Harness.
- Settings are stored in the profile's `cordis.patch.yml` (the `unity` entry) instead of the Harness-wide `settings.yaml`, and still apply without a restart.

## [0.1.5] - 2026-09-02

### Changed
- Follow DeepSeek Harness 0.1.2-alpha.5: the settings service API and the client store packages moved. ([#7](https://github.com/opdsh/unity-plugin/pull/7))
- Game-development keywords added to the npm manifest.

## [0.1.4] - 2026-09-02

### Added
- The Asset Store skill reads the Unity token from Windows Credential Manager and decrypts downloads with .NET on Windows, where it previously worked only on macOS. ([#6](https://github.com/opdsh/unity-plugin/pull/6))

## [0.1.3] - 2026-08-30

### Fixed
- An `EPIPE` on the warm shell's stdio no longer crashes the Harness process. ([#1](https://github.com/opdsh/unity-plugin/pull/1))
- A timeout or output cap of zero or less is refused, instead of silently unregistering every `unity_*` tool for the rest of the session. ([#2](https://github.com/opdsh/unity-plugin/pull/2), [#5](https://github.com/opdsh/unity-plugin/pull/5))
- Asset Store downloads follow CDN redirects and clean up partial files after a failed decrypt. ([#3](https://github.com/opdsh/unity-plugin/pull/3))

## [0.1.2] - 2026-08-28

### Added
- Chinese README, shipped in the package.

## [0.1.1] - 2026-08-28

Not published to npm.

### Changed
- Host-provided peer dependencies are marked optional, silencing pnpm's false "missing peer" warnings on install.

## [0.1.0] - 2026-08-28

### Added
- Five `unity_*` tools over the official `unity` CLI (Editor status, command discovery, live-Editor commands, C# eval, and a raw CLI escape hatch), with a warm `unity shell` session behind the live-Editor tools.
- Unity's official skill collection fetched at activation, plus the bundled `unity-workflow` and `unity-asset-store` skills.
- A settings card in the Harness web UI for the timeouts and the output cap.

[0.1.7]: https://github.com/opdsh/unity-plugin/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/opdsh/unity-plugin/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/opdsh/unity-plugin/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/opdsh/unity-plugin/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/opdsh/unity-plugin/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/opdsh/unity-plugin/compare/v0.1.0...v0.1.2
[0.1.1]: https://github.com/opdsh/unity-plugin/commit/fd8db54
[0.1.0]: https://github.com/opdsh/unity-plugin/releases/tag/v0.1.0
