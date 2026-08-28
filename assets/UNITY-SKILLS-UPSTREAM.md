# Unity skill collection

The plugin fetches the official Unity skill collection at activation:

- Upstream: https://github.com/Unity-Technologies/skills (`skills/` directory), licensed under the Unity Companion License (see the LICENSE in that repository; the download keeps it in the cache).
- Mechanism: a shallow `git fetch` of the configured `unitySkillsRef` (default: a pinned commit; see `src/unity-skills-fetch.ts`) into `<dshHome>/cache/unity-plugin/unity-skills`, run through the harness subprocess seam. Content is fetched once per configured ref; changing the ref re-fetches. A failed fetch keeps an existing cache, and with no cache the plugin runs with only the skills below.
- Known upstream defect handling: the `physics-3d-collision` frontmatter `description` is a plain YAML scalar containing `: ` sequences, which dsh's spec-compliant parser rejects; the fetch rewrites it as a `>-` folded block scalar when present. Any other malformed upstream skill warns and is skipped by the provider.

To move the default to a newer upstream commit: verify the new ref loads cleanly (mount it once and check for provider warnings), then update `UNITY_SKILLS_DEFAULT_REF` in `src/unity-skills-fetch.ts` and retire fixups the ref no longer needs.

`assets/skills/` contains only this plugin's own skills:

- `unity-workflow/`: the `unity_*` tool operating knowledge.
- `unity-asset-store/`: search, download, and install of the user's owned Asset Store purchases.
