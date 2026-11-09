import io
import json
import sys
from pathlib import Path

from pytest import CaptureFixture, MonkeyPatch

from app.main import app
from app.scripts.export_openapi import check, main, render


def test_render_is_stable_json_with_final_newline() -> None:
    text = render(app.openapi())

    assert text.endswith("}\n")
    assert json.loads(text) == app.openapi()
    assert render(app.openapi()) == text


def test_writes_the_file(tmp_path: Path) -> None:
    output = tmp_path / "api" / "openapi.json"

    assert main([str(output)]) == 0

    document = json.loads(output.read_text(encoding="utf-8"))
    assert document["info"]["title"] == "Agenda Inteligente API"
    assert "/api/v1/auth/refresh" in document["paths"]


def test_prints_to_stdout(capsys: CaptureFixture[str]) -> None:
    assert main(["-"]) == 0

    assert json.loads(capsys.readouterr().out) == app.openapi()


def test_check_accepts_the_current_export_with_crlf(tmp_path: Path) -> None:
    current = tmp_path / "openapi.json"
    current.write_bytes(render(app.openapi()).replace("\n", "\r\n").encode())

    assert main(["--check", str(current)]) == 0


def test_check_fails_when_the_file_is_outdated(
    tmp_path: Path, capsys: CaptureFixture[str]
) -> None:
    outdated = tmp_path / "openapi.json"
    outdated.write_text('{"openapi": "3.1.0"}\n', encoding="utf-8")

    assert main(["--check", str(outdated)]) == 1
    assert "out of date" in capsys.readouterr().err


def test_check_reads_stdin(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "stdin", io.StringIO(render(app.openapi())))

    assert main(["--check", "-"]) == 0


def test_check_ignores_only_line_endings() -> None:
    assert check("a\r\nb\n", "a\nb\n")
    assert not check("a\nb\n", "a\nc\n")
