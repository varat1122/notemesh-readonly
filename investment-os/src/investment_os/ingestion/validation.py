"""Run untrusted format inspection in a bounded, credential-free child process."""

import json
import subprocess
import sys

MAX_BYTES = 1_000_000
POLICY_VERSION = "synthetic-static-files-v1"
MEDIA_TYPES = {
    "pdf": "application/pdf",
    "csv": "text/csv",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
CAPTURE_MEDIA_TYPES = {**MEDIA_TYPES, "txt": "text/plain"}


def policy_for(extension: str):
    # Existing file captures keep their original policy and replay identity.
    return "synthetic-plain-text-v1" if extension == "txt" else POLICY_VERSION


def validate_bytes(content: bytes, extension: str) -> dict:
    if type(content) is not bytes or not 0 < len(content) <= MAX_BYTES:
        raise ValueError("content must be nonempty bytes within the intake limit")
    if extension not in CAPTURE_MEDIA_TYPES:
        raise ValueError("unsupported format")
    if extension == "txt":
        from investment_os.ingestion.plain_text import decode_text

        try:
            decode_text(content)
            return {"accepted": True, "policy": policy_for(extension)}
        except ValueError:
            return {
                "accepted": False,
                "reason": "invalid_or_oversized_plain_text",
                "policy": policy_for(extension),
            }
    try:
        result = subprocess.run(
            [sys.executable, "-m", "investment_os.ingestion.validation_worker", extension],
            input=content,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=8,
            # No inherited provider credentials, proxy identity or user config selectors.
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
            check=False,
        )
        if result.returncode:
            return {
                "accepted": False,
                "reason": "validator_process_failed",
                "policy": POLICY_VERSION,
            }
        value = json.loads(result.stdout)
        if value.get("policy") != POLICY_VERSION or type(value.get("accepted")) is not bool:
            raise ValueError("invalid worker response")
        return value
    except subprocess.TimeoutExpired:
        return {"accepted": False, "reason": "validator_timeout", "policy": POLICY_VERSION}
