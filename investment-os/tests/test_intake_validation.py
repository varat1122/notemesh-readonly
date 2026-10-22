import io
import runpy
import subprocess
import zipfile
from pathlib import Path

import pytest
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, NameObject, TextStringObject

from investment_os.ingestion.validation import MAX_BYTES, validate_bytes

samples = runpy.run_path(str(Path(__file__).parent / "fixtures_synthetic/file_samples.py"))


@pytest.mark.parametrize("kind", ["pdf", "csv", "xlsx"])
def test_static_fixtures_accepted_without_modifying_original(kind):
    data = samples[kind + "_bytes"]()
    assert data == samples[kind + "_bytes"]()
    assert validate_bytes(data, kind)["accepted"] is True


@pytest.mark.parametrize(
    "content,kind",
    [
        (b"%PDF-1.7\n%%EOF", "pdf"),
        (b"not a pdf", "pdf"),
        (b"PK\x03\x04broken", "xlsx"),
        (b"\xd0\xcf\x11\xe0encrypted legacy Office", "xlsx"),
        (b"PKarchive", "csv"),
        (b"a,b\n1,2,3", "csv"),
        (b'a,b\n"unclosed,1', "csv"),
        (b"a,\x00b", "csv"),
        (b"\xff\xfe\x00a", "csv"),
        (b'a,b\n1,=HYPERLINK("http://example.invalid")', "csv"),
        (b"a,b\n1,\t+CMD", "csv"),
        (b"a,b\n1,@SUM(A1)", "csv"),
        (b"a,b\n1,-CMD", "csv"),
        (b"a\n" * 10001, "csv"),
    ],
)
def test_malformed_and_active_input_quarantines(content, kind):
    assert validate_bytes(content, kind)["accepted"] is False


def test_plain_negative_number_is_data_not_formula():
    assert validate_bytes(b"name,value\nSynthetic,-12.50", "csv")["accepted"]


@pytest.mark.parametrize("data", [b"", b"x" * (MAX_BYTES + 1)])
def test_size_rejected_before_child_process(data):
    with pytest.raises(ValueError):
        validate_bytes(data, "csv")


def rewrite_xlsx(transform):
    output = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(samples["xlsx_bytes"]())) as source,
        zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as dest,
    ):
        for name in source.namelist():
            dest.writestr(name, transform(name, source.read(name)))
    return output.getvalue()


@pytest.mark.parametrize("attack", ["formula", "external", "dtd", "dimension", "macro_type"])
def test_xlsx_xml_hazards_denied(attack):
    def edit(name, data):
        if attack == "formula" and name == "xl/worksheets/sheet1.xml":
            return data.replace(b"<v>123.45</v>", b"<f>1+1</f><v>2</v>")
        if attack == "external" and name == "xl/_rels/workbook.xml.rels":
            return data.replace(b"Target=", b'TargetMode="External" Target=', 1)
        if attack == "dtd" and name == "xl/workbook.xml":
            return b'<!DOCTYPE x [<!ENTITY x "bomb">]>' + data
        if attack == "dimension" and name == "xl/worksheets/sheet1.xml":
            return data.replace(b"A1:C2", b"A1:XFD1048576")
        if attack == "macro_type" and name == "[Content_Types].xml":
            return data.replace(
                b"spreadsheetml.sheet.main+xml", b"ms-excel.sheet.macroEnabled.main+xml"
            )
        return data

    assert not validate_bytes(rewrite_xlsx(edit), "xlsx")["accepted"]


@pytest.mark.parametrize(
    "name,payload",
    [
        ("../escape.xml", b"<x/>"),
        ("/absolute.xml", b"<x/>"),
        ("xl/vbaProject.bin", b"fake macro"),
        ("xl/externalLinks/externalLink1.xml", b"<x/>"),
        ("xl/embeddings/oleObject1.bin", b"fake object"),
        ("xl/theme/theme2.xml", b"x" * 2_000_000),
    ],
)
def test_xlsx_archive_hazards_denied(name, payload):
    raw = io.BytesIO(samples["xlsx_bytes"]())
    with zipfile.ZipFile(raw, "a", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(name, payload)
    assert not validate_bytes(raw.getvalue(), "xlsx")["accepted"]


def test_pdf_encryption_and_javascript_and_attachments_denied():
    original = samples["pdf_bytes"]()
    for attack in ["encrypted", "javascript", "attachment", "uri"]:
        writer = PdfWriter(clone_from=PdfReader(io.BytesIO(original)))
        if attack == "encrypted":
            writer.encrypt("synthetic-password")
        elif attack == "javascript":
            writer._root_object[NameObject("/OpenAction")] = DictionaryObject(
                {
                    NameObject("/S"): NameObject("/JavaScript"),
                    NameObject("/JS"): TextStringObject("app.alert('synthetic')"),
                }
            )
        elif attack == "attachment":
            writer.add_attachment("fixture.txt", b"synthetic")
        else:
            writer._root_object[NameObject("/OpenAction")] = DictionaryObject(
                {
                    NameObject("/S"): NameObject("/URI"),
                    NameObject("/URI"): TextStringObject("https://example.invalid"),
                }
            )
        output = io.BytesIO()
        writer.write(output)
        assert not validate_bytes(output.getvalue(), "pdf")["accepted"]


def test_worker_timeout_is_quarantined_and_credentials_are_not_inherited(monkeypatch):
    def timeout(*args, **kwargs):
        assert set(kwargs["env"]) == {"PATH", "LANG"}
        assert kwargs["timeout"] <= 8
        raise subprocess.TimeoutExpired(args[0], 8)

    monkeypatch.setattr(subprocess, "run", timeout)
    result = validate_bytes(b"a,b\n1,2", "csv")
    assert not result["accepted"] and result["reason"] == "validator_timeout"


def test_capture_result_cannot_claim_success_without_readback_and_ids():
    from investment_os.ports.contracts import SyntheticCaptureResult

    with pytest.raises(ValueError):
        SyntheticCaptureResult(status="captured", content_sha256="a" * 64)
    with pytest.raises(ValueError):
        SyntheticCaptureResult(
            status="quarantined",
            content_sha256="a" * 64,
            reason="invalid",
            original_bytes_verified=True,
        )


def test_xlsx_defined_formula_name_denied():
    def edit(name, data):
        if name == "xl/workbook.xml":
            return data.replace(
                b"<definedNames />",
                b'<definedNames><definedName name="external">[other.xlsx]Sheet1!A1</definedName></definedNames>',
            )
        return data

    assert not validate_bytes(rewrite_xlsx(edit), "xlsx")["accepted"]
