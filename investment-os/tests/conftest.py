import json
from pathlib import Path

import pytest


@pytest.fixture
def records():
    return json.loads((Path(__file__).parent / "fixtures_synthetic/entities.json").read_text())
