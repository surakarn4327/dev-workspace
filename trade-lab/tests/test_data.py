"""Schema enforcement and synthetic-data realism."""

import numpy as np
import pandas as pd
import pytest

from tradelab.config import Costs, OutcomeConfig
from tradelab.data import schema, store, synthetic
from tradelab.features.indicators import atr


def test_synthetic_passes_schema(bars_m5):
    schema.validate(bars_m5)


def test_synthetic_has_no_weekend_bars(bars_m5):
    assert (bars_m5.index.dayofweek < 5).all()


@pytest.mark.parametrize(
    "timeframe,lo,hi",
    [("M1", 0.3, 1.2), ("M5", 0.8, 2.5)],
)
def test_synthetic_volatility_is_realistic(timeframe, lo, hi):
    """Guard against the bug that made every synthetic trade lose 3R.

    If ATR drifts far from what XAUUSD actually prints, the stop distance stops
    being comparable to the spread and every downstream number turns to noise.
    See bugs.md 2026-09-05.
    """
    bars = synthetic.generate(n_bars=20_000, timeframe=timeframe, seed=1)
    median_atr = float(atr(bars, 14).median())
    assert lo < median_atr < hi, f"{timeframe} ATR {median_atr:.3f} outside [{lo}, {hi}]"

    stop = OutcomeConfig().sl_atr * median_atr
    cost_r = Costs().round_trip_price / stop
    assert cost_r < 0.6, f"cost is {cost_r:.2f}R of the stop - stop distance too small"


def test_schema_rejects_naive_index():
    df = pd.DataFrame(
        {"open": [1.0], "high": [1.0], "low": [1.0], "close": [1.0]},
        index=pd.to_datetime(["2024-01-01"]),
    )
    with pytest.raises(schema.SchemaError, match="timezone"):
        schema.validate(df)


def test_schema_rejects_inconsistent_ohlc():
    idx = pd.date_range("2024-01-01", periods=2, freq="5min", tz="UTC")
    df = pd.DataFrame(
        {"open": [10.0, 10.0], "high": [9.0, 11.0], "low": [8.0, 9.0], "close": [10.0, 10.0]},
        index=idx,
    )
    with pytest.raises(schema.SchemaError, match="inconsistent"):
        schema.validate(df)


def test_schema_rejects_duplicate_timestamps():
    idx = pd.to_datetime(["2024-01-01", "2024-01-01"], utc=True)
    df = pd.DataFrame(
        {"open": [1.0, 1.0], "high": [1.0, 1.0], "low": [1.0, 1.0], "close": [1.0, 1.0]},
        index=idx,
    )
    with pytest.raises(schema.SchemaError, match="duplicate"):
        schema.validate(df)


def test_schema_fills_optional_columns():
    idx = pd.date_range("2024-01-01", periods=3, freq="5min", tz="UTC")
    df = pd.DataFrame(
        {"open": 1.0, "high": 1.1, "low": 0.9, "close": 1.0},
        index=idx,
    )
    out = schema.validate(df)
    assert list(out.columns) == list(schema.COLUMNS)
    assert (out["tick_volume"] == 0.0).all()
    assert out["spread"].isna().all()


def test_csv_roundtrip(tmp_path, bars_m5):
    csv = tmp_path / "bars.csv"
    bars_m5.head(500).to_csv(csv)
    loaded = store.load_csv(csv)
    assert len(loaded) == 500
    np.testing.assert_allclose(loaded["close"].to_numpy(), bars_m5["close"].head(500).to_numpy())


def test_csv_accepts_alternate_column_names(tmp_path):
    csv = tmp_path / "alt.csv"
    csv.write_text(
        "Date,Open,High,Low,Close,Volume\n"
        "2024-01-01 00:00:00,10,11,9,10.5,100\n"
        "2024-01-01 00:05:00,10.5,11.5,10,11,120\n",
        encoding="utf-8",
    )
    loaded = store.load_csv(csv)
    assert len(loaded) == 2
    assert loaded["tick_volume"].iloc[1] == 120


def test_store_roundtrip(tmp_path, bars_m5):
    store.save(bars_m5.head(300), "TEST", "M5", root=tmp_path)
    assert store.exists("TEST", "M5", root=tmp_path)
    back = store.load("TEST", "M5", root=tmp_path)
    pd.testing.assert_frame_equal(back, bars_m5.head(300))


def test_load_bars_refuses_silent_synthetic_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "RAW_DIR", tmp_path)
    from tradelab import data

    with pytest.raises(FileNotFoundError):
        data.load_bars("NOPE", "M5", allow_synthetic=False)
