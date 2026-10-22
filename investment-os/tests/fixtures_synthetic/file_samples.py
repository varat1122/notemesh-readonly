"""Generated fictional originals; no licensed/binary document committed to Git."""

import io
import zipfile
from datetime import datetime

from openpyxl import Workbook
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject


def csv_bytes():
    return b"company,period,revenue_usd\r\nSynthetic Example,2026-Q1,123.45\r\n"


def pdf_bytes():
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=200)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
    )
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 12 Tf 20 100 Td (SYNTHETIC revenue USD 123.45) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def xlsx_bytes():
    book = Workbook()
    book.properties.created = book.properties.modified = datetime(2026, 1, 1)
    sheet = book.active
    sheet.title = "Synthetic"
    sheet.append(["company", "period", "revenue_usd"])
    sheet.append(["Synthetic Example", "2026-Q1", 123.45])
    raw = io.BytesIO()
    book.save(raw)
    book.close()
    # Stable archive timestamps and core metadata make repeatable demo bytes.
    output = io.BytesIO()
    with (
        zipfile.ZipFile(raw) as source,
        zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as dest,
    ):
        for item in sorted(source.namelist()):
            content = source.read(item)
            if item == "docProps/core.xml":
                import re

                content = re.sub(
                    rb"(<dcterms:modified[^>]*>).*?(</dcterms:modified>)",
                    rb"\g<1>2026-01-01T00:00:00Z\g<2>",
                    content,
                )
            info = zipfile.ZipInfo(item, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            dest.writestr(info, content)
    return output.getvalue()
