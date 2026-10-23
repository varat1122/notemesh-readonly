"""Bounded deterministic extraction of admitted static source data; never executes content."""

import csv
import hashlib
import io
import json
import posixpath
import re
import sys
import zipfile
from decimal import Decimal

from defusedxml.ElementTree import fromstring

from investment_os.ingestion.validation import MAX_BYTES
from investment_os.ingestion.validation_worker import (
    Rejected,
    inspect_csv,
    inspect_pdf,
    inspect_xlsx,
    require,
    set_resource_limits,
)

MAX_OUTPUT_BYTES = 750000


class Collector:
    def __init__(self):
        self.items, self.characters = [], 0

    def emit(self, text, locator, value_type="text"):
        if text == "":
            return
        self.characters += len(text)
        require(
            len(text) <= 10000 and self.characters <= 120000 and len(self.items) < 2000,
            "extraction_budget_exceeded",
        )
        self.items.append(
            dict(
                text=text,
                locator=locator,
                value_type=value_type,
                text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
                untrusted_data=True,
                independent_evidence=False,
            )
        )


def extract_csv(data, out):
    rows = csv.reader(io.StringIO(data.decode("utf-8-sig"), newline=""), strict=True)
    previous_line = 0
    for number, row in enumerate(rows, 1):
        start, end = previous_line + 1, rows.line_num
        for column, text in enumerate(row, 1):
            out.emit(
                text, dict(kind="csv", record=number, column=column, line_start=start, line_end=end)
            )
        previous_line = end
    return [], ["csv_values_are_strings"]


def extract_pdf(data, out):
    from pypdf import PdfReader

    empty = []
    for page_number, page in enumerate(PdfReader(io.BytesIO(data), strict=True).pages, 1):
        text = page.extract_text(extraction_mode="plain")
        if not text.strip():
            empty.append(page_number)
            continue
        for start in range(0, len(text), 4000):
            part = text[start : start + 4000]
            out.emit(
                part,
                dict(kind="pdf", page=page_number, char_start=start, char_end=start + len(part)),
            )
    return empty, ["pdf_reading_order_unverified", "ocr_not_performed"]


def extract_xlsx(data, out):
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rel_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

    def xml(archive, path):
        return fromstring(
            archive.read(path), forbid_dtd=True, forbid_entities=True, forbid_external=True
        )

    def string(element):
        if element is None:
            return ""
        return "".join(
            n.text or "" for n in element.findall("s:t", ns) + element.findall("s:r/s:t", ns)
        )

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = [string(si) for si in xml(archive, "xl/sharedStrings.xml").findall("s:si", ns)]
        relationships = {
            r.get("Id"): r.get("Target") for r in xml(archive, "xl/_rels/workbook.xml.rels")
        }
        workbook = xml(archive, "xl/workbook.xml")
        seen_sheets = set()
        for sheet in workbook.findall("s:sheets/s:sheet", ns):
            name = sheet.get("name")
            require(name and name not in seen_sheets, "ambiguous_sheet_name")
            seen_sheets.add(name)
            target = relationships[sheet.get("{" + rel_ns + "}id")]
            part = target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target)
            require(
                bool(re.fullmatch(r"xl/worksheets/sheet\d+\.xml", part)), "unsupported_sheet_target"
            )
            tree = xml(archive, part)
            seen_cells = set()
            rows = tree.findall("s:sheetData/s:row", ns)
            row_ids = [row.get("r", "") for row in rows]
            require(
                all(r.isdecimal() and 1 <= int(r) <= 10000 for r in row_ids)
                and len(row_ids) == len(set(row_ids)),
                "ambiguous_sheet_rows",
            )
            for row, cell in [(row, cell) for row in rows for cell in row.findall("s:c", ns)]:
                coordinate = cell.get("r", "")
                require(
                    bool(re.fullmatch(r"[A-Z]{1,2}[1-9][0-9]{0,4}", coordinate))
                    and coordinate not in seen_cells,
                    "ambiguous_cell_locator",
                )
                require(
                    re.search(r"[0-9]+$", coordinate).group() == row.get("r"), "cell_row_mismatch"
                )
                seen_cells.add(coordinate)
                cell_type = cell.get("t", "n")
                raw = cell.findtext("s:v", default="", namespaces=ns)
                value_type = "text"
                if cell_type == "inlineStr":
                    text = string(cell.find("s:is", ns))
                elif cell_type == "s":
                    require(raw.isdecimal() and int(raw) < len(shared), "invalid_shared_string")
                    text = shared[int(raw)]
                elif cell_type == "n":
                    require(not raw or Decimal(raw).is_finite(), "invalid_numeric_value")
                    text, value_type = raw, "number"
                elif cell_type in {"str", "b", "d", "e"}:
                    require(cell_type != "b" or raw in {"0", "1", ""}, "invalid_boolean_value")
                    text = raw
                    value_type = {"str": "text", "b": "boolean", "d": "date_lexical", "e": "error"}[
                        cell_type
                    ]
                else:
                    raise Rejected("unsupported_cell_type")
                out.emit(
                    text,
                    dict(
                        kind="xlsx",
                        sheet=name,
                        cell=coordinate,
                        style_index=int(cell.get("s", "0")),
                    ),
                    value_type,
                )
    return [], ["xlsx_styles_and_dates_not_interpreted", "merged_cell_layout_not_reconstructed"]


def main():
    try:
        set_resource_limits()
        content = sys.stdin.buffer.read(MAX_BYTES + 1)
        require(0 < len(content) <= MAX_BYTES, "size_limit")
        kind = sys.argv[1]
        {"csv": inspect_csv, "xlsx": inspect_xlsx, "pdf": inspect_pdf}[kind](content)
        out = Collector()
        empty, warnings = {"csv": extract_csv, "xlsx": extract_xlsx, "pdf": extract_pdf}[kind](
            content, out
        )
        result = dict(ok=True, excerpts=out.items, pages_without_text=empty, warnings=warnings)
        encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        require(len(encoded) <= MAX_OUTPUT_BYTES, "extraction_byte_budget_exceeded")
        sys.stdout.buffer.write(encoded)
    except Rejected as exc:
        print(json.dumps(dict(ok=False, reason=str(exc))))
    except Exception:
        print(json.dumps(dict(ok=False, reason="malformed_or_unsupported_extraction")))


if __name__ == "__main__":
    main()
