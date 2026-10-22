"""Assert observable P0 health, authorization and synthetic-only behavior over HTTP."""

import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from investment_os.storage.database import SCHEMA_REVISION

base = "http://127.0.0.1:" + os.environ.get("IOS_API_PORT", "58000")


def call(path, payload=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = Request(
        base + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers=headers,
    )
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.load(response)
    except HTTPError as e:
        return e.code, json.load(e)


assert call("/health/live")[0] == 200
assert call("/health/ready")[1]["migration"] == SCHEMA_REVISION
request = {"action": "research_draft", "resource_path": "Drafts/example.md"}
assert call("/v1/policy/evaluate", request)[0] == 401
assert call("/v1/policy/evaluate", request, "dummy-reader")[0] == 403
assert call("/v1/policy/evaluate", request, "dummy-researcher")[1]["executed"] is False
for action in [
    "thesis_approve",
    "evidence_review",
    "portfolio_write",
    "trade_execute",
    "paid_inference",
]:
    assert call("/v1/policy/evaluate", dict(request, action=action), "dummy-owner")[0] == 403
print(
    json.dumps(
        {
            "status": "PASS",
            "health": 200,
            "migration": SCHEMA_REVISION,
            "unauthenticated": 401,
            "reader_write": 403,
            "protected_actions": 403,
            "business_writes": 0,
            "paid_calls": 0,
        }
    )
)
