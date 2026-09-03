#!/usr/bin/env python3
"""Unity Asset Store helper for owned ("My Assets") purchases.

Talks to the undocumented packages.unity.com API using the OAuth access token
that the Unity CLI / Unity Hub stores in the OS credential store. Read-only
against the account: it lists purchases, reads product details, and downloads +
decrypts a purchased .unitypackage to a local file. Importing into a project is
a separate step the skill performs with the unity_* tools.

Subcommands (all print JSON to stdout):
  search <query> [--limit N] [--offset N]   Search owned purchases.
  info <packageId>                           Product details for one package.
  download <packageId> [--out PATH]          Download + decrypt to a .unitypackage.

Token sources:
  macOS    Keychain generic password, service "unity" (via `security`).
  Windows  Credential Manager generic credential named "<account>.unity",
           where account is "auth-tokens:<unity account id>". Windows caps a
           credential blob at 2560 bytes, so Unity Hub / the Unity CLI split a
           long token across chunk credentials ("<account>--chunk--<gen>--<i>")
           and leave a JSON manifest in the base entry; this script reassembles
           and verifies them exactly the way the Hub does. Read with ctypes
           (CredReadW / CredEnumerateW), no extra packages needed.

Network uses `curl` (macOS, Linux and Windows 10+ all ship it). Decryption
uses `openssl` where available and falls back to .NET AES through PowerShell
on Windows, which does not ship openssl. On any auth failure the script exits
3 with {"error":"AUTH_EXPIRED"|"AUTH_NOT_FOUND", ...} so the caller can ask
the user to sign in again with the Unity CLI (`unity auth login`) or Unity
Hub, which refreshes the stored token.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from typing import Any, Callable, Optional

API_BASE = "https://packages.unity.com/-/api"
KEYRING_SERVICE = "unity"
# Unity Hub / CLI keyring account for a user's OAuth token blob is
# "auth-tokens:<foreignKey>", the foreignKey being the Unity account id.
TOKEN_ACCOUNT_PREFIX = "auth-tokens:"

# --- Unity Hub chunked-secret contract (packages/core/src/tokenManager/credentialStore.ts)
# Only Windows chunks (Credential Manager blob limit); the base entry then
# holds a JSON manifest carrying this marker instead of the secret itself.
CHUNK_MANIFEST_MARKER = "__unityHubKeyringChunkedV1__"
CHUNK_MAX_CHARS = 1024      # UTF-16 code units per chunk entry
CHUNK_MAX_COUNT = 16384     # manifests above this are treated as corrupt


def fail(code: str, message: str, *, exit_code: int = 1) -> None:
    """Print a structured error to stdout and exit."""
    print(json.dumps({"error": code, "message": message}))
    sys.exit(exit_code)


SIGN_IN_HINT = "Ask the user to sign in with `unity auth login` (or Unity Hub), then retry."


# ---------------------------------------------------------------------------
# Chunk reassembly (platform independent; mirrors the Hub's CredentialStore.get)
# ---------------------------------------------------------------------------

def fnv1a_utf16_hex(secret: str) -> str:
    """FNV-1a 32-bit over UTF-16 code units, lowercase hex without padding.

    Matches the Hub's `checksumOf`, which iterates `charCodeAt` (UTF-16 code
    units, so astral characters contribute their surrogate pair) and prints
    `(hash >>> 0).toString(16)`.
    """
    data = secret.encode("utf-16-le", "surrogatepass")
    h = 2166136261
    for (unit,) in struct.iter_unpack("<H", data):
        h ^= unit
        h = (h * 16777619) & 0xFFFFFFFF
    return format(h, "x")


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def is_chunk_manifest(value: Any) -> bool:
    """Same acceptance rules as the Hub's `isChunkManifest`."""
    if not isinstance(value, dict):
        return False
    gen = value.get("gen")
    chunks = value.get("chunks")
    length = value.get("length")
    if value.get(CHUNK_MANIFEST_MARKER) is not True:
        return False
    if not isinstance(gen, str) or not gen:
        return False
    if not _is_int(chunks) or chunks <= 0:
        return False
    if not _is_int(length) or length < 0:
        return False
    if not isinstance(value.get("checksum"), str):
        return False
    return chunks <= CHUNK_MAX_COUNT and length <= chunks * CHUNK_MAX_CHARS


def chunk_account(account: str, gen: str, index: int) -> str:
    return f"{account}--chunk--{gen}--{index}"


def reassemble_secret(
    read_entry: Callable[[str], Optional[str]], account: str, base: str
) -> Optional[str]:
    """Resolve a keyring value that may be a chunk manifest into the secret.

    `read_entry(account)` returns the stored string for a keyring account under
    the "unity" service, or None when it is absent. Returns None when a chunk
    is missing or the reassembled secret fails the manifest's length/checksum
    check, i.e. the stored token is torn and the user must sign in again.
    """
    if CHUNK_MANIFEST_MARKER not in base:
        return base
    try:
        manifest = json.loads(base)
    except json.JSONDecodeError:
        return base
    if not is_chunk_manifest(manifest):
        return base
    parts = []
    for index in range(manifest["chunks"]):
        part = read_entry(chunk_account(account, manifest["gen"], index))
        if part is None:
            return None
        parts.append(part)
    assembled = "".join(parts)
    # `length` counts UTF-16 code units like JS `String.length`.
    utf16_length = len(assembled.encode("utf-16-le", "surrogatepass")) // 2
    if utf16_length != manifest["length"] or fnv1a_utf16_hex(assembled) != manifest["checksum"]:
        return None
    return assembled


# ---------------------------------------------------------------------------
# Windows Credential Manager (ctypes, advapi32)
# ---------------------------------------------------------------------------

if sys.platform == "win32":
    import ctypes
    import ctypes.wintypes as wt

    CRED_TYPE_GENERIC = 1
    ERROR_NOT_FOUND = 1168

    class _FILETIME(ctypes.Structure):
        _fields_ = [("dwLowDateTime", wt.DWORD), ("dwHighDateTime", wt.DWORD)]

    class _CREDENTIAL(ctypes.Structure):
        _fields_ = [
            ("Flags", wt.DWORD),
            ("Type", wt.DWORD),
            ("TargetName", wt.LPWSTR),
            ("Comment", wt.LPWSTR),
            ("LastWritten", _FILETIME),
            ("CredentialBlobSize", wt.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
            ("Persist", wt.DWORD),
            ("AttributeCount", wt.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wt.LPWSTR),
            ("UserName", wt.LPWSTR),
        ]

    _PCREDENTIAL = ctypes.POINTER(_CREDENTIAL)
    _advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    _advapi32.CredReadW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.POINTER(_PCREDENTIAL)]
    _advapi32.CredReadW.restype = wt.BOOL
    _advapi32.CredEnumerateW.argtypes = [
        wt.LPCWSTR, wt.DWORD, ctypes.POINTER(wt.DWORD), ctypes.POINTER(ctypes.POINTER(_PCREDENTIAL)),
    ]
    _advapi32.CredEnumerateW.restype = wt.BOOL
    _advapi32.CredFree.argtypes = [ctypes.c_void_p]
    _advapi32.CredFree.restype = None

    def _decode_blob(blob: bytes) -> Optional[str]:
        """Decode a credential blob written by the Unity keyring binding.

        The binding (keyring-rs underneath @unity/hub-keyring) stores the
        secret as UTF-16LE without a terminator. Detect that from the zero
        high bytes of the leading (ASCII JSON) code units; anything else is
        read as UTF-8 so a hand-written or differently-encoded entry still
        has a chance.
        """
        if not blob:
            return ""
        if len(blob) % 2 == 0:
            high_bytes = blob[1:min(len(blob), 16):2]
            if high_bytes and not any(high_bytes):
                try:
                    return blob.decode("utf-16-le").rstrip("\x00")
                except UnicodeDecodeError:
                    pass
        try:
            return blob.decode("utf-8").rstrip("\x00")
        except UnicodeDecodeError:
            return None

    def win_target_name(account: str) -> str:
        """keyring-rs names the generic credential "<user>.<service>"."""
        return f"{account}.{KEYRING_SERVICE}"

    def win_read_entry(account: str) -> Optional[str]:
        """Return the stored string for a "unity" keyring account, or None."""
        pcred = _PCREDENTIAL()
        ok = _advapi32.CredReadW(win_target_name(account), CRED_TYPE_GENERIC, 0, ctypes.byref(pcred))
        if not ok:
            err = ctypes.get_last_error()
            if err == ERROR_NOT_FOUND:
                return None
            raise OSError(err, f"CredReadW failed for {win_target_name(account)!r}: {ctypes.FormatError(err).strip()}")
        try:
            cred = pcred.contents
            size = cred.CredentialBlobSize
            blob = bytes(cred.CredentialBlob[:size]) if size else b""
        finally:
            _advapi32.CredFree(pcred)
        return _decode_blob(blob)

    def win_list_token_accounts() -> list[str]:
        """Keyring accounts "auth-tokens:<id>" present in Credential Manager.

        CredEnumerateW's filter is a prefix + '*' on the target name, so it
        also returns the chunk credentials; those are dropped here.
        """
        count = wt.DWORD(0)
        creds = ctypes.POINTER(_PCREDENTIAL)()
        ok = _advapi32.CredEnumerateW(TOKEN_ACCOUNT_PREFIX + "*", 0, ctypes.byref(count), ctypes.byref(creds))
        if not ok:
            err = ctypes.get_last_error()
            if err == ERROR_NOT_FOUND:
                return []
            raise OSError(err, f"CredEnumerateW failed: {ctypes.FormatError(err).strip()}")
        accounts: list[str] = []
        try:
            suffix = "." + KEYRING_SERVICE
            for i in range(count.value):
                cred = creds[i].contents
                target = cred.TargetName or ""
                if cred.Type != CRED_TYPE_GENERIC or not target.endswith(suffix):
                    continue
                account = target[: -len(suffix)]
                if "--chunk--" in account:
                    continue
                accounts.append(account)
        finally:
            _advapi32.CredFree(creds)
        return sorted(set(accounts))


# ---------------------------------------------------------------------------
# Token lookup
# ---------------------------------------------------------------------------

def parse_token_blob(secret: str) -> tuple[str, Optional[float]]:
    """Return (accessToken, expiration epoch seconds or None) from the stored JSON.

    Exits 3 when the blob is not the auth-token JSON the CLI/Hub writes.
    """
    try:
        blob = json.loads(secret)
    except json.JSONDecodeError:
        fail("AUTH_NOT_FOUND", "Stored Unity credential is not valid JSON. " + SIGN_IN_HINT, exit_code=3)
    if not isinstance(blob, dict):
        fail("AUTH_NOT_FOUND", "Stored Unity credential has an unexpected shape. " + SIGN_IN_HINT, exit_code=3)
    token = blob.get("accessToken")
    expiration = blob.get("accessTokenExpiration")
    if not isinstance(token, str) or not token:
        fail("AUTH_NOT_FOUND", "Stored Unity credential has no accessToken. " + SIGN_IN_HINT, exit_code=3)
    expires_at = expiration / 1000.0 if isinstance(expiration, (int, float)) and not isinstance(expiration, bool) else None
    return token, expires_at


def check_not_expired(expires_at: Optional[float]) -> None:
    if expires_at is not None and expires_at <= time.time():
        fail(
            "AUTH_EXPIRED",
            "The Unity access token has expired. Ask the user to sign in again "
            "with `unity auth login` (or Unity Hub), then retry.",
            exit_code=3,
        )


def cli_active_foreign_key() -> Optional[str]:
    """Ask the Unity CLI which stored account is active; None when unknown."""
    unity = shutil.which("unity")
    if not unity:
        return None
    try:
        proc = subprocess.run(
            [unity, "auth", "list", "--json", "--no-banner", "--quiet", "--non-interactive"],
            capture_output=True, text=True, timeout=60,
        )
        data = json.loads(proc.stdout).get("data") or {}
    except (OSError, subprocess.SubprocessError, ValueError, AttributeError):
        return None
    key = data.get("activeForeignKey")
    if isinstance(key, str) and key:
        return key
    for account in data.get("accounts") or []:
        if isinstance(account, dict) and account.get("isActive") and isinstance(account.get("foreignKey"), str):
            return account["foreignKey"]
    return None


def read_secret_macos() -> str:
    """The Unity CLI keychain item (service "unity") via `security`."""
    try:
        raw = subprocess.run(
            ["security", "find-generic-password", "-s", KEYRING_SERVICE, "-w"],
            capture_output=True, text=True, timeout=300,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        fail("AUTH_NOT_FOUND", f"could not read the Keychain: {exc}", exit_code=3)
    if raw.returncode != 0 or not raw.stdout.strip():
        fail("AUTH_NOT_FOUND", "No Unity token in the Keychain. " + SIGN_IN_HINT, exit_code=3)
    return raw.stdout.strip()


def read_secret_windows() -> str:
    """The Unity CLI / Hub token blob from Credential Manager, chunks reassembled.

    With several stored accounts, prefers the one the Unity CLI reports as
    active, then the first whose token has not expired.
    """
    try:
        accounts = win_list_token_accounts()
    except OSError as exc:
        fail("AUTH_NOT_FOUND", f"could not read Windows Credential Manager: {exc}", exit_code=3)
    if not accounts:
        fail("AUTH_NOT_FOUND", "No Unity token in Windows Credential Manager. " + SIGN_IN_HINT, exit_code=3)

    if len(accounts) > 1:
        active = cli_active_foreign_key()
        if active and TOKEN_ACCOUNT_PREFIX + active in accounts:
            accounts = [TOKEN_ACCOUNT_PREFIX + active] + [a for a in accounts if a != TOKEN_ACCOUNT_PREFIX + active]

    torn: list[str] = []
    fallback: Optional[str] = None
    for account in accounts:
        try:
            base = win_read_entry(account)
            secret = reassemble_secret(win_read_entry, account, base) if base is not None else None
        except OSError as exc:
            fail("AUTH_NOT_FOUND", f"could not read Windows Credential Manager: {exc}", exit_code=3)
        if secret is None:
            torn.append(account)
            continue
        if len(accounts) == 1:
            return secret
        # Several accounts: skip ones whose token is already expired if a
        # live one exists further down the list.
        try:
            blob = json.loads(secret)
        except json.JSONDecodeError:
            blob = None
        expiration = blob.get("accessTokenExpiration") if isinstance(blob, dict) else None
        if isinstance(expiration, (int, float)) and not isinstance(expiration, bool) and expiration / 1000.0 <= time.time():
            fallback = fallback or secret
            continue
        return secret
    if fallback is not None:
        return fallback
    fail(
        "AUTH_NOT_FOUND",
        "The Unity token in Windows Credential Manager is split into chunks that "
        f"could not be reassembled ({', '.join(torn)}). " + SIGN_IN_HINT,
        exit_code=3,
    )
    raise AssertionError("unreachable")


def read_access_token() -> str:
    """Return the current OAuth access token from the OS credential store.

    Exits 3 when the token is missing (not signed in) or already past its
    expiration stamp, with a message telling the caller how to refresh it.
    """
    if sys.platform == "darwin":
        secret = read_secret_macos()
    elif sys.platform == "win32":
        secret = read_secret_windows()
    else:
        fail(
            "AUTH_NOT_FOUND",
            "Reading the Unity token is implemented for macOS (Keychain) and Windows "
            "(Credential Manager) only. Sign in with `unity auth login` on a supported host.",
            exit_code=3,
        )
    token, expires_at = parse_token_blob(secret)
    check_not_expired(expires_at)
    return token


# ---------------------------------------------------------------------------
# HTTP + decrypt
# ---------------------------------------------------------------------------

def curl_path() -> str:
    path = shutil.which("curl")
    if not path and sys.platform == "win32":
        candidate = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "curl.exe")
        if os.path.exists(candidate):
            path = candidate
    if not path:
        fail("NETWORK_ERROR", "curl was not found on PATH")
    return path


def api_get(path: str, token: str) -> Any:
    """GET a JSON API path with the bearer token. Exits 3 on 401/403."""
    with tempfile.NamedTemporaryFile(delete=False) as body_file:
        body_path = body_file.name
    try:
        proc = subprocess.run(
            [
                # -L: the API answers some paths with a redirect. curl drops the
                # Authorization header when a redirect crosses to another host,
                # so following one cannot leak the token.
                curl_path(), "-sS", "-L", "-o", body_path, "-w", "%{http_code}",
                "-H", f"Authorization: Bearer {token}",
                f"{API_BASE}{path}",
            ],
            capture_output=True, text=True, timeout=60,
        )
        if proc.returncode != 0:
            fail("NETWORK_ERROR", f"curl failed: {proc.stderr.strip()}")
        status = proc.stdout.strip()
        with open(body_path, "rb") as handle:
            body = handle.read()
    finally:
        os.unlink(body_path)
    if status in ("401", "403"):
        fail(
            "AUTH_EXPIRED",
            "The Unity API rejected the token (HTTP " + status + "). Ask the user "
            "to sign in again with `unity auth login` (or Unity Hub), then retry.",
            exit_code=3,
        )
    if status != "200":
        fail("API_ERROR", f"HTTP {status} for {path}")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        fail("API_ERROR", f"non-JSON response for {path}")


# AES-256-CBC + PKCS7 through .NET, for Windows hosts without openssl. Key,
# IV and paths arrive through the environment so they never appear on the
# command line; the script itself is passed base64-encoded (-EncodedCommand),
# which sidesteps script execution policy.
_POWERSHELL_DECRYPT = r"""
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function HexBytes([string]$hex) {
  $bytes = New-Object byte[] ($hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16) }
  return ,$bytes
}
try {
  $aes = [System.Security.Cryptography.Aes]::Create()
  $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
  $aes.Key = HexBytes $env:UAS_KEY
  $aes.IV = HexBytes $env:UAS_IV
  $in = [System.IO.File]::OpenRead($env:UAS_IN)
  $out = [System.IO.File]::Create($env:UAS_OUT)
  try {
    $cs = New-Object System.Security.Cryptography.CryptoStream($out, $aes.CreateDecryptor(), [System.Security.Cryptography.CryptoStreamMode]::Write)
    $in.CopyTo($cs)
    $cs.FlushFinalBlock()
    $cs.Dispose()
  } finally {
    $in.Dispose()
    $out.Dispose()
    $aes.Dispose()
  }
  exit 0
} catch {
  # Write the plain message ourselves: an unhandled error on a redirected
  # stderr comes out wrapped in CLIXML, which is unreadable in our JSON.
  $msg = $_.Exception.Message
  if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
  [Console]::Error.WriteLine($msg)
  exit 1
}
"""


def powershell_path() -> Optional[str]:
    for name in ("pwsh", "powershell"):
        found = shutil.which(name)
        if found:
            return found
    candidate = os.path.join(
        os.environ.get("SystemRoot", r"C:\Windows"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
    )
    return candidate if os.path.exists(candidate) else None


def decrypt_aes256_cbc(enc_path: str, out_path: str, key_hex: str, iv_hex: str) -> Optional[str]:
    """Decrypt enc_path into out_path. Returns None on success, else an error message."""
    openssl = shutil.which("openssl")
    powershell = powershell_path() if sys.platform == "win32" else None
    if openssl is None and powershell is None:
        return "no decryption tool found: install openssl (or, on Windows, make PowerShell available)"

    # Windows: PowerShell/.NET is always present and needs no third-party
    # binary, so it is the primary path there; openssl only if it is missing.
    if sys.platform == "win32" and powershell is not None:
        env = dict(os.environ, UAS_KEY=key_hex, UAS_IV=iv_hex, UAS_IN=enc_path, UAS_OUT=out_path)
        encoded = base64.b64encode(_POWERSHELL_DECRYPT.encode("utf-16-le")).decode("ascii")
        dec = subprocess.run(
            [powershell, "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
            capture_output=True, text=True, timeout=1800, env=env,
        )
        if dec.returncode == 0:
            return None
        message = f"PowerShell AES decrypt failed: {(dec.stderr or dec.stdout).strip()}"
        if openssl is None:
            return message
        prefix = message + "; "
    else:
        prefix = ""

    dec = subprocess.run(
        [openssl, "enc", "-d", "-aes-256-cbc", "-K", key_hex, "-iv", iv_hex,
         "-in", enc_path, "-out", out_path],
        capture_output=True, text=True, timeout=1800,
    )
    if dec.returncode != 0:
        return f"{prefix}openssl decrypt failed: {dec.stderr.strip()}"
    return None


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

def cmd_search(args: argparse.Namespace) -> None:
    token = read_access_token()
    params = f"?offset={args.offset}&limit={args.limit}"
    if args.query:
        from urllib.parse import quote
        params += f"&query={quote(args.query)}"
    data = api_get(f"/purchases{params}", token)
    results = [
        {
            "packageId": item.get("packageId"),
            "purchaseId": item.get("id"),
            "displayName": item.get("displayName"),
            "grantTime": item.get("grantTime"),
            "isPublisherAsset": item.get("isPublisherAsset"),
        }
        for item in data.get("results", [])
    ]
    print(json.dumps({"total": data.get("total"), "count": len(results), "results": results}, indent=2))


def cmd_info(args: argparse.Namespace) -> None:
    token = read_access_token()
    data = api_get(f"/product/{args.package_id}", token)
    ratings = data.get("productRatings") or {}
    publisher = data.get("productPublisher") or {}
    version = data.get("version")
    if isinstance(version, dict):
        version = version.get("name")
    summary = {
        "packageId": data.get("packageId"),
        "name": data.get("displayName") or data.get("name"),
        "version": version,
        "publisher": publisher.get("name"),
        "category": (data.get("category") or {}).get("name") if isinstance(data.get("category"), dict) else data.get("category"),
        "supportedUnityVersions": data.get("supportedUnityVersions"),
        "averageRating": ratings.get("average") if isinstance(ratings, dict) else None,
        "elevatorPitch": data.get("elevatorPitch"),
        "state": data.get("state"),
    }
    print(json.dumps(summary, indent=2))


def cmd_download(args: argparse.Namespace) -> None:
    token = read_access_token()
    info = api_get(f"/legacy-package-download-info/{args.package_id}", token)
    download = (info.get("result") or {}).get("download") or {}
    url = download.get("url")
    key_hex = download.get("key")
    if not url or not key_hex:
        fail("API_ERROR", "download info missing url or key")
    if len(key_hex) != 96:
        fail("DECRYPT_ERROR", f"unexpected key length {len(key_hex)} (want 96 hex chars)")

    out_path = args.out
    if not out_path:
        safe = download.get("filename_safe_package_name") or f"asset-{args.package_id}"
        safe = "".join(c if c.isalnum() or c in " -_." else "_" for c in safe).strip() or f"asset-{args.package_id}"
        cache_dir = os.path.join(tempfile.gettempdir(), "unity-asset-store")
        os.makedirs(cache_dir, exist_ok=True)
        out_path = os.path.join(cache_dir, f"{safe}.unitypackage")
    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    def discard_partial() -> None:
        """Drop a half-written output so a later run cannot find a corrupt package.

        The decryptor creates the output before it can know the decrypt will
        fail, and the cache path is derived from the packageId — so leaving
        the remains behind hands the next download a plausible-looking bad
        file.
        """
        try:
            os.unlink(out_path)
        except OSError:
            pass

    with tempfile.NamedTemporaryFile(delete=False) as enc_file:
        enc_path = enc_file.name
    try:
        # -L: the download URL is a signed handoff to the CDN and answers with
        # a redirect. Without this curl writes the redirect body and reports
        # its status, which surfaced as a misleading "CDN returned HTTP 302".
        proc = subprocess.run(
            [curl_path(), "-sS", "-L", "-o", enc_path, "-w", "%{http_code}", url],
            capture_output=True, text=True, timeout=1800,
        )
        if proc.returncode != 0:
            fail("NETWORK_ERROR", f"CDN download failed: {proc.stderr.strip()}")
        if proc.stdout.strip() not in ("200", "206"):
            fail("NETWORK_ERROR", f"CDN returned HTTP {proc.stdout.strip()}")
        # AES-256-CBC: first 32 bytes are the key, last 16 bytes the IV; PKCS7 padding.
        error = decrypt_aes256_cbc(enc_path, out_path, key_hex[:64], key_hex[64:96])
        if error:
            discard_partial()
            fail("DECRYPT_ERROR", error)
    finally:
        os.unlink(enc_path)

    size = os.path.getsize(out_path)
    with open(out_path, "rb") as handle:
        magic = handle.read(2)
    if magic != b"\x1f\x8b":
        discard_partial()
        fail("DECRYPT_ERROR", "decrypted output is not a gzip .unitypackage (wrong key?)")
    print(json.dumps({
        "packageId": args.package_id,
        "path": out_path,
        "bytes": size,
        "displayName": download.get("filename_safe_package_name"),
    }, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Unity Asset Store owned-purchase helper.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_search = sub.add_parser("search", help="Search owned purchases.")
    p_search.add_argument("query", nargs="?", default="", help="Search text; omit to list all.")
    p_search.add_argument("--limit", type=int, default=25)
    p_search.add_argument("--offset", type=int, default=0)
    p_search.set_defaults(func=cmd_search)

    p_info = sub.add_parser("info", help="Product details for one packageId.")
    p_info.add_argument("package_id")
    p_info.set_defaults(func=cmd_info)

    p_dl = sub.add_parser("download", help="Download + decrypt a purchased package.")
    p_dl.add_argument("package_id")
    p_dl.add_argument("--out", help="Output .unitypackage path (default: temp cache).")
    p_dl.set_defaults(func=cmd_download)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
