"""Exports the OpenAPI document used by the frontend types (D51).

Run from the `backend` folder:

    python -m app.scripts.export_openapi            # writes the default file
    python -m app.scripts.export_openapi -          # prints to stdout
    python -m app.scripts.export_openapi --check ../frontend/src/api/openapi.json

With `--check`, nothing is written: the command ends with code 1 when the given
file (or stdin, with `-`) differs from the current export. Line endings are
ignored, so a Windows checkout with CRLF still matches.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

DEFAULT_OUTPUT = Path("../frontend/src/api/openapi.json")
DESCRIPTION = "Exports the OpenAPI document used by the frontend types (D51)."


def openapi_document() -> dict[str, Any]:
    # Imported here so `--help` works without the settings of the application.
    from app.main import app

    return app.openapi()


def render(document: dict[str, Any]) -> str:
    """Stable text: the order FastAPI produces, two spaces and a final newline."""
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def _normalize(text: str) -> str:
    return text.replace("\r\n", "\n")


def check(expected: str, current: str) -> bool:
    return _normalize(expected) == _normalize(current)


def _read(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    return Path(path).read_text(encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument(
        "output",
        nargs="?",
        default=str(DEFAULT_OUTPUT),
        help="file to write, or - for stdout (default: %(default)s)",
    )
    parser.add_argument(
        "--check",
        metavar="FILE",
        help="compare FILE (or - for stdin) with the export instead of writing",
    )
    args = parser.parse_args(argv)
    text = render(openapi_document())

    if args.check is not None:
        if check(_read(args.check), text):
            print(f"{args.check}: up to date")
            return 0
        print(
            f"{args.check}: out of date; run python -m app.scripts.export_openapi",
            file=sys.stderr,
        )
        return 1

    if args.output == "-":
        sys.stdout.write(text)
        return 0
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(text, encoding="utf-8", newline="\n")
    print(f"OpenAPI written to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
