"""Escaped, offline review document; no application routes, forms, scripts or remote assets."""

import hashlib
from base64 import b64encode
from html import escape

from investment_os.ingestion.plain_text import decode_text, line_at, paragraph_spans
from investment_os.ports.text_review import TextReviewPacket
from investment_os.storage.local_objects import ObjectIntegrityError

STYLE = """body{font:17px/1.65 system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#182b36;background:#f5f7f8}h1,h2{line-height:1.3;color:#124b52}li{margin-bottom:18px}blockquote{margin:12px 0;background:white;border-left:4px solid #157f87;padding:12px 18px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}a{color:#075d9c}span:target{background:#fff2a8}p{overflow-wrap:anywhere}strong{color:#744912}"""


def render_review(packet: TextReviewPacket, content: bytes):
    packet = TextReviewPacket.model_validate(packet.model_dump())
    text = decode_text(content)
    spans = list(paragraph_spans(text))
    if hashlib.sha256(content).hexdigest() != packet.source_sha256 or len(spans) != len(
        packet.items
    ):
        raise ObjectIntegrityError("HTML source mismatch")
    original, queue = [], []
    cursor = 0
    for number, ((start, end), item) in enumerate(zip(spans, packet.items, strict=True), 1):
        if (
            item.char_start != start
            or item.char_end != end
            or item.text != text[start:end]
            or item.line_start != line_at(text, start)
            or item.line_end != line_at(text, end - 1)
        ):
            raise ObjectIntegrityError("HTML citation mismatch")
        original.append(escape(text[cursor:start]))
        original.append(f'<span id="source-{number}">{escape(item.text)}</span>')
        cursor = end
        numeric = (
            "พบตัวเลข — ต้องตรวจหน่วย ฐานเปรียบเทียบ และช่วงเวลา"
            if item.contains_number
            else ("ต้องอ่านและจัดประเภท — อาจเป็นหัวเรื่อง คำกล่าวอ้าง หรือความเห็น")
        )
        queue.append(
            f'<li id="review-{number}"><p><strong>รายการ {number}: รอคนตรวจ</strong></p>'
            f"<p>{numeric}</p><blockquote><pre>{escape(item.text)}</pre></blockquote>"
            f'<a href="#source-{number}">อ่านข้อความเดิม บรรทัด '
            f"{item.line_start}–{item.line_end}</a></li>"
        )
    original.append(escape(text[cursor:]))
    style_hash = b64encode(hashlib.sha256(STYLE.encode()).digest()).decode("ascii")
    html = (
        '<!doctype html><html lang="th"><head><meta charset="utf-8">'
        '<meta http-equiv="Content-Security-Policy" '
        "content=\"default-src 'none'; base-uri 'none'; form-action 'none'; "
        f"style-src 'sha256-{style_hash}'\">"
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>Investment OS — ตัวอย่างข้อความรอตรวจ</title><style>{STYLE}</style></head><body>"
        "<h1>ข้อความ → รายการรอตรวจ → หลักฐาน → คนอนุมัติ</h1>"
        "<p><strong>ข้อมูลทั้งหมดเป็นเรื่องแต่งสำหรับทดสอบ ไม่ใช่ข่าวจริงหรือคำแนะนำลงทุน</strong></p>"
        "<p>เอกสารนี้เป็นร่างอ่านในเครื่อง ไม่มีการส่งข้อมูลออก และยังไม่บันทึกเป็นข้อเท็จจริง "
        "รายการถูกแบ่งตามย่อหน้า ไม่ใช่การแยกทุกข้อกล่าวอ้างหรือการวิเคราะห์ด้วย AI</p>"
        "<h2>สิ่งที่ผู้ตรวจต้องทำต่อ</h2><ol>"
        "<li>หาแหล่งต้นฉบับ ผู้เผยแพร่ วันที่ และปีของข้อมูล ยังไม่มีการยืนยันในตัวอย่างนี้</li>"
        "<li>ตรวจกลุ่มตัวอย่าง: ข้อมูลจากเครือข่ายหนึ่งครอบคลุมตลาดทั้งหมดหรือไม่</li>"
        "<li>แยกยอดใช้จ่าย ราคา และปริมาณ token; ราคาเฉลี่ยอาจเปลี่ยนจากส่วนผสมของโมเดล</li>"
        "<li>แยก % กับ percentage points และฐานของสัดส่วนลูกค้าหรือรายได้แต่ละตัว</li>"
        "<li>แยกข้อเท็จจริงที่ตรวจได้ออกจากความเห็น แล้วหาหลักฐานสนับสนุนและคัดค้าน</li>"
        "<li>คนทบทวนก่อนนำไปประกอบบทวิเคราะห์หรือเสนอแก้ thesis</li></ol>"
        '<h2 id="queue">รายการรอตรวจ</h2><ol>'
        + "".join(queue)
        + '</ol><h2 id="original">ต้นฉบับจำลอง</h2><pre>'
        + "".join(original)
        + '</pre><p><a href="#queue">กลับรายการรอตรวจ</a></p>'
        + "<h2>การตรวจสอบที่มา</h2><p>Source ID: "
        + str(packet.source_id)
        + "</p><p>Document ID: "
        + str(packet.document_id)
        + "</p><p>SHA-256 ต้นฉบับ: "
        + packet.source_sha256
        + "</p><p>SHA-256 ร่าง: "
        + packet.output_sha256
        + "</p><p>ตำแหน่งเป็นตัวอักษร Unicode นับจากศูนย์และไม่รวมตำแหน่งจบ "
        "การอ่านกลับยืนยันว่าข้อความตรงต้นฉบับ ไม่ได้รับรองว่าข่าวเป็นจริง</p></body></html>"
    )
    result = html.encode("utf-8")
    if len(result) > 900_000:
        raise ValueError("HTML byte budget exceeded")
    return result
