"""Bounded UTF-8 text, with exact offsets and no execution or semantic inference."""

import re

MAX_TEXT_BYTES = 120_000
MAX_PARAGRAPHS = 200
MAX_PARAGRAPH_CHARS = 10_000
NEWLINE_PATTERN = r"\r\n|\r(?!\n)|(?<!\r)\n"
SEPARATOR = re.compile(rf"(?:{NEWLINE_PATTERN})[ \t]*(?:(?:{NEWLINE_PATTERN})[ \t]*)+")
NEWLINE = re.compile(NEWLINE_PATTERN)


def paragraph_spans(text: str):
    start = 0
    for match in SEPARATOR.finditer(text):
        if text[start : match.start()].strip():
            yield start, match.start()
        start = match.end()
    if text[start:].strip():
        yield start, len(text)


def decode_text(content: bytes):
    if type(content) is not bytes or not 0 < len(content) <= MAX_TEXT_BYTES:
        raise ValueError("plain-text byte limit")
    text = content.decode("utf-8", errors="strict")
    # Preserve BOM, combining marks, tabs and newlines exactly. Reject hidden controls
    # and bidi overrides that could disguise source content in a review document.
    if any(
        (ord(c) < 32 and c not in "\t\r\n")
        or 0x7F <= ord(c) <= 0x9F
        or 0x202A <= ord(c) <= 0x202E
        or 0x2066 <= ord(c) <= 0x2069
        for c in text
    ):
        raise ValueError("unsupported control character")
    spans = list(paragraph_spans(text))
    if (
        not spans
        or len(spans) > MAX_PARAGRAPHS
        or any(end - start > MAX_PARAGRAPH_CHARS for start, end in spans)
        or not text.lstrip("\ufeff").strip()
    ):
        raise ValueError("empty text or paragraph budget exceeded")
    return text


def line_at(text: str, offset: int):
    # Match the original, not a slice that could split CRLF into a standalone CR.
    return 1 + sum(match.end() <= offset for match in NEWLINE.finditer(text))
