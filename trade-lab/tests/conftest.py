import sys
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from tradelab.data import synthetic  # noqa: E402


@pytest.fixture(scope="session")
def bars_m5():
    return synthetic.generate(n_bars=12_000, timeframe="M5", seed=1)


@pytest.fixture(scope="session")
def bars_m1():
    return synthetic.generate(n_bars=12_000, timeframe="M1", seed=2)
