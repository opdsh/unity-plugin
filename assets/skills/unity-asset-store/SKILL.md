---
name: unity-asset-store
description: Search, download, and install the user's OWNED Unity Asset Store purchases ("My Assets") into a Unity project. Use when the user wants to add, import, find, or install an asset they have already bought or acquired from the Unity Asset Store — characters, models, shaders, tools, packs — into their project. Not for browsing or buying assets the user does not yet own.
---

# Unity Asset Store — install owned assets

Search the user's **owned** Asset Store purchases, download a `.unitypackage`, and import it into the open Unity project. Backed by the `packages.unity.com` account API using the OAuth token that the Unity CLI / Unity Hub already stores; the helper script `scripts/asset_store.py` in this skill's directory does the network, decryption, and file writing.

Run the helper with the absolute path of this skill's directory (provided as the skill's resource directory when this skill loads):

```bash
python3 <skill_dir>/scripts/asset_store.py <subcommand> ...
```

## Scope and key facts

- **Owned purchases only.** This lists and downloads assets already in the user's *My Assets*. It cannot search or buy the public storefront. To find an asset the user does **not** own, use `web_search`/`web_fetch` over `assetstore.unity.com`; the user buys it in a browser, and then it appears here.
- **Two different ids.** `search` returns both a `purchaseId` (`id`) and a `packageId`. `info` and `download` are keyed by **`packageId`** — always pass the `packageId`, never the `purchaseId`.
- **macOS only, for now.** The token is read from the macOS Keychain. On other hosts the helper exits with an auth error.

## Authentication — stop and ask, do not work around

The helper reads the Unity access token from the OS credential store. If it prints a JSON object whose `error` is `AUTH_EXPIRED` or `AUTH_NOT_FOUND` (exit code 3), the token is missing or expired.

**When that happens: stop and ask the user to sign in again, then retry.** Say something like:

> Your Unity session has expired (or isn't signed in). Please run `unity auth login` in a terminal, or sign in through the Unity Hub, then tell me to continue.

Signing in through either the Unity CLI or Unity Hub refreshes the token in the Keychain, and the same command will then work. Do not try to obtain a token another way, edit the Keychain, or bypass the check.

## Workflow

### 1. Find the asset

```bash
python3 <skill_dir>/scripts/asset_store.py search "low poly nature" --limit 25
```

Prints `{ total, count, results: [{ packageId, purchaseId, displayName, grantTime, isPublisherAsset }] }`. Narrow with a more specific query; page with `--offset`. Omit the query to list everything.

Optional — confirm details (version, publisher, supported Unity versions, category) before downloading:

```bash
python3 <skill_dir>/scripts/asset_store.py info <packageId>
```

Check `supportedUnityVersions` against the target project's Editor version and warn the user if it does not match.

### 2. Download and decrypt

```bash
python3 <skill_dir>/scripts/asset_store.py download <packageId>
```

Prints `{ packageId, path, bytes, displayName }`. `path` is a ready-to-import `.unitypackage` (default: a temp cache; pass `--out <path>` to choose the location). The helper verifies the decrypted file is a valid package before reporting success.

### 3. Import into the project

Use the `unity_*` tools (see the `unity-workflow` skill). The target Unity project's Editor must be running.

1. `unity_status` — confirm an Editor is connected and `"ready"`. If none is, open the project first (`unity_cli ["open", "<project>", "--args", "-automated"]`) and poll until ready.
2. Import the package with C# eval (silent, non-interactive):

   ```csharp
   UnityEditor.AssetDatabase.ImportPackage(@"<path from step 2>", false);
   ```

   Call this through `unity_eval`. `false` imports every asset with no dialog.
3. Give the import a moment, then `unity_command` `get_scene_hierarchy` or check `read_console` for errors. Importing large packages can trigger a script recompile / domain reload that briefly drops the Editor connection — wait and re-run `unity_status` until it is `"ready"` again.
4. The imported assets land under `Assets/`. Tell the user where (usually a folder named after the package).

## End-to-end example

User: "Add Unity's 2D Game Kit to the project."

1. `search "game kit"` → find `2D Game Kit`, `packageId` 107098.
2. `info 107098` → confirm it supports the project's Unity version.
3. `download 107098` → get the local `.unitypackage` path.
4. `unity_status` → Editor ready.
5. `unity_eval` → `UnityEditor.AssetDatabase.ImportPackage(@"/…/2D Game Kit.unitypackage", false);`
6. Confirm no console errors; report the new folder under `Assets/`.
