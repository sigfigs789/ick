#!/usr/bin/env python3
"""Bump the version constants in src/version.ts.

APP_VERSION always goes up by one. MIN_VERSION follows it only when
FORCE_RELOAD is set, which is what makes a release mandatory (every open tab
below the floor silently reloads). See src/version.ts for the full contract.

Writes the before/after numbers as GitHub Actions outputs on stdout.
"""

import os
import re
import sys
from pathlib import Path

VERSION_FILE = Path(__file__).resolve().parent.parent / "src" / "version.ts"


def read_constant(source: str, name: str) -> int:
    match = re.search(rf"^export const {name} = (\d+);$", source, re.MULTILINE)
    if match is None:
        sys.exit(f"Could not find `export const {name} = <number>;` in {VERSION_FILE}")
    return int(match.group(1))


def replace_constant(source: str, name: str, value: int) -> str:
    return re.sub(
        rf"^export const {name} = \d+;$",
        f"export const {name} = {value};",
        source,
        count=1,
        flags=re.MULTILINE,
    )


def main() -> None:
    force_reload = os.environ.get("FORCE_RELOAD", "false").lower() == "true"

    source = VERSION_FILE.read_text()
    previous_app = read_constant(source, "APP_VERSION")
    previous_min = read_constant(source, "MIN_VERSION")

    app_version = previous_app + 1
    min_version = app_version if force_reload else previous_min

    # The same invariant vite.config.ts enforces at build time: a floor above the
    # shipped version would reload every tab forever.
    if min_version > app_version:
        sys.exit(
            f"MIN_VERSION ({min_version}) would exceed APP_VERSION ({app_version}) — "
            f"fix src/version.ts before bumping."
        )

    source = replace_constant(source, "APP_VERSION", app_version)
    source = replace_constant(source, "MIN_VERSION", min_version)
    VERSION_FILE.write_text(source)

    for key, value in (
        ("previous_app_version", previous_app),
        ("previous_min_version", previous_min),
        ("app_version", app_version),
        ("min_version", min_version),
    ):
        print(f"{key}={value}")


if __name__ == "__main__":
    main()
