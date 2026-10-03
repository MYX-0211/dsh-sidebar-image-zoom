#!/usr/bin/env python3
"""Add or remove one package entry in a DSH profile manifest.

Edit is line-based rather than a JSON round-trip so the untouched parts of the
manifest keep their exact formatting and stay easy to diff and review. The
result is always re-parsed before it is written, and a timestamped backup is
taken first.

usage: manifest_edit.py <install|uninstall> <manifest> <package> [spec]
"""

import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path


def fail(message: str) -> "None":
    print("ERROR: " + message, file=sys.stderr)
    raise SystemExit(1)


def load(manifest: Path) -> str:
    if not manifest.is_file():
        fail(f"manifest not found: {manifest}")
    return manifest.read_text(encoding="utf-8")


def parse(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        fail(f"manifest is not valid JSON: {error}")


def add_dependency(text: str, name: str, spec: str) -> str:
    pattern = re.compile(r'("dependencies"\s*:\s*\{)')
    match = pattern.search(text)
    if not match:
        fail('no "dependencies" object in the manifest')
    insert = f'{match.group(1)}\n    "{name}": "{spec}",'
    return text[: match.start()] + insert + text[match.end() :]


def del_dependency(text: str, name: str) -> str:
    # an entry followed by more entries, or the last entry in the object
    text = re.sub(r'(?m)^[ \t]*"' + re.escape(name) + r'"[ \t]*:[^\n]*?,[ \t]*\n', "", text)
    text = re.sub(r'(?m),?[ \t]*\n[ \t]*"' + re.escape(name) + r'"[ \t]*:[^\n]*?\n', "\n", text)
    return text


def add_bundle(text: str, name: str) -> str:
    key = text.find('"bundles"')
    if key < 0:
        fail('no "bundles" array in the manifest')
    open_at = text.find("[", key)
    close_at = text.find("]", open_at)
    if open_at < 0 or close_at < 0:
        fail('could not locate the "bundles" array bounds')
    inner = text[open_at + 1 : close_at].rstrip()
    if inner.endswith(","):
        inner = inner[:-1].rstrip()
    new_inner = f'{inner},\n        "{name}"\n      '
    return text[: open_at + 1] + new_inner + text[close_at:]


def del_bundle(text: str, name: str) -> str:
    # remove the entry and whichever comma it carries (before or after)
    text = re.sub(r'(?m)^[ \t]*"' + re.escape(name) + r'",[ \t]*\n', "", text)
    text = re.sub(r'(?m),[ \t]*\n[ \t]*"' + re.escape(name) + r'"[ \t]*(?=\n[ \t]*\])', "", text)
    text = re.sub(r'(?m)^[ \t]*"' + re.escape(name) + r'"[ \t]*(?=\n[ \t]*\])', "", text)
    text = re.sub(r'(?m)^[ \t]*"' + re.escape(name) + r'"[ \t]*\n(?=[ \t]*")', "", text)
    return text


def main() -> int:
    if len(sys.argv) not in (4, 5):
        print(__doc__.strip(), file=sys.stderr)
        return 2

    action, manifest_arg, name = sys.argv[1], sys.argv[2], sys.argv[3]
    spec = sys.argv[4] if len(sys.argv) == 5 else None
    manifest = Path(manifest_arg)

    text = load(manifest)
    data = parse(text)

    if action == "install":
        if spec is None:
            fail("install needs a dependency spec")
        if name in data.get("dependencies", {}):
            print(f"already a dependency: {name}")
        else:
            text = add_dependency(text, name, spec)
        if name in data.get("dsh", {}).get("profile", {}).get("bundles", []):
            print(f"already a bundle: {name}")
        else:
            text = add_bundle(text, name)
    elif action == "uninstall":
        if name not in data.get("dependencies", {}) and name not in data.get("dsh", {}).get("profile", {}).get("bundles", []):
            print(f"nothing to remove: {name}")
            return 0
        text = del_dependency(text, name)
        text = del_bundle(text, name)
    else:
        fail(f"unknown action: {action}")

    check = parse(text)
    if action == "install":
        if check["dependencies"].get(name) != spec:
            fail("dependency entry did not land")
        if name not in check["dsh"]["profile"]["bundles"]:
            fail("bundles entry did not land")
    else:
        if name in check.get("dependencies", {}):
            fail("dependency entry survived")
        if name in check["dsh"]["profile"]["bundles"]:
            fail("bundles entry survived")

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = manifest.with_name(manifest.name + f".bak-{stamp}")
    shutil.copy2(manifest, backup)
    manifest.write_text(text, encoding="utf-8")

    print(f"backed up -> {backup.name}")
    print(f"{action} ok: {name}")
    print("bundles: " + ", ".join(check["dsh"]["profile"]["bundles"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
