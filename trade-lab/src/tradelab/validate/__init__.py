"""Guards against fooling ourselves: splits, sanity checks, look-ahead detection."""

from __future__ import annotations

from . import lookahead, sanity, splits

__all__ = ["lookahead", "sanity", "splits"]
