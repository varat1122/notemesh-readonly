from uuid import uuid4

import duckdb
import pytest
from pydantic import ValidationError

from investment_os.ports.contracts import MarketBar


def test_synthetic_parquet_roundtrip_without_external_extension(tmp_path):
    dataset = tmp_path / "synthetic.parquet"
    with duckdb.connect(":memory:", config={"enable_external_access": "true"}) as con:
        con.execute("CREATE TABLE sample(instrument_id VARCHAR, session DATE, close DECIMAL(18,4))")
        con.execute("INSERT INTO sample VALUES (?, '2026-10-21', 1.2500)", [str(uuid4())])
        con.execute("COPY sample TO ? (FORMAT PARQUET)", [str(dataset)])
        assert (
            con.execute("SELECT count(*) FROM read_parquet(?)", [str(dataset)]).fetchone()[0] == 1
        )
        assert (
            str(con.execute("SELECT close FROM read_parquet(?)", [str(dataset)]).fetchone()[0])
            == "1.2500"
        )
    # A fresh connection is required to prove the data is on disk.
    with duckdb.connect(":memory:") as con:
        assert (
            con.execute("SELECT count(*) FROM read_parquet(?)", [str(dataset)]).fetchone()[0] == 1
        )


def test_invalid_ohlc_rejected():
    with pytest.raises(ValidationError):
        MarketBar(
            instrument_id=uuid4(),
            dataset_id=uuid4(),
            session_at="2026-10-21T00:00:00Z",
            available_at="2026-10-22T00:00:00Z",
            currency="USD",
            open="10",
            close="12",
            high="11",
            low="9",
            volume="1",
        )
