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

Network uses `curl` and decryption uses `openssl`; both ship with macOS and
Linux. On any auth failure the script exits 3 with {"error":"AUTH_EXPIRED"|
"AUTH_NOT_FOUND", ...} so the caller can ask the user to sign in again with the
Unity CLI (`unity auth login`) or Unity Hub, which refreshes the stored token.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from typing import Any

API_BASE = "https://packages.unity.com/-/api"
KEYCHAIN_SERVICE = "unity"


def fail(code: str, message: str, *, exit_code: int = 1) -> None:
    """Print a structured error to stdout and exit."""
    print(json.dumps({"error": code, "message": message}))
    sys.exit(exit_code)


def read_access_token() -> str:
    """Return the current OAuth access token from the OS credential store.

    macOS: the Unity CLI keychain item (service "unity"). Exits 3 when the
    token is missing (not signed in) or already past its expiration stamp, with
    a message telling the caller how to refresh it.
    """
    if sys.platform != "darwin":
        fail(
            "AUTH_NOT_FOUND",
            "Reading the Unity token is only implemented for macOS (Keychain). "
            "Sign in with `unity auth login` on a supported host.",
            exit_code=3,
        )
    try:
        raw = subprocess.run(
            ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
            capture_output=True, text=True, timeout=300,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        fail("AUTH_NOT_FOUND", f"could not read the Keychain: {exc}", exit_code=3)
    if raw.returncode != 0 or not raw.stdout.strip():
        fail(
            "AUTH_NOT_FOUND",
            "No Unity token in the Keychain. Ask the user to sign in with "
            "`unity auth login` (or Unity Hub), then retry.",
            exit_code=3,
        )
    try:
        blob = json.loads(raw.stdout.strip())
    except json.JSONDecodeError:
        fail("AUTH_NOT_FOUND", "Unity Keychain item is not valid JSON.", exit_code=3)
    token = blob.get("accessToken")
    expiration = blob.get("accessTokenExpiration")
    if not isinstance(token, str) or not token:
        fail("AUTH_NOT_FOUND", "Unity Keychain item has no accessToken.", exit_code=3)
    if isinstance(expiration, (int, float)) and expiration / 1000.0 <= time.time():
        fail(
            "AUTH_EXPIRED",
            "The Unity access token has expired. Ask the user to sign in again "
            "with `unity auth login` (or Unity Hub), then retry.",
            exit_code=3,
        )
    return token


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
                "curl", "-sS", "-L", "-o", body_path, "-w", "%{http_code}",
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

    def discard_partial() -> None:
        """Drop a half-written output so a later run cannot find a corrupt package.

        openssl creates -out before it can know the decrypt will fail, and the
        cache path is derived from the packageId — so leaving the remains
        behind hands the next download a plausible-looking bad file.
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
            ["curl", "-sS", "-L", "-o", enc_path, "-w", "%{http_code}", url],
            capture_output=True, text=True, timeout=1800,
        )
        if proc.returncode != 0:
            fail("NETWORK_ERROR", f"CDN download failed: {proc.stderr.strip()}")
        if proc.stdout.strip() not in ("200", "206"):
            fail("NETWORK_ERROR", f"CDN returned HTTP {proc.stdout.strip()}")
        # AES-256-CBC: first 32 bytes are the key, last 16 bytes the IV; PKCS7 padding.
        key = key_hex[:64]
        iv = key_hex[64:96]
        dec = subprocess.run(
            ["openssl", "enc", "-d", "-aes-256-cbc", "-K", key, "-iv", iv,
             "-in", enc_path, "-out", out_path],
            capture_output=True, text=True, timeout=300,
        )
        if dec.returncode != 0:
            discard_partial()
            fail("DECRYPT_ERROR", f"openssl decrypt failed: {dec.stderr.strip()}")
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
