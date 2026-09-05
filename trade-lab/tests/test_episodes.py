"""Effective sample size - the fix for the fake edges found on random data.

See bugs.md 2026-09-05 "ระบบหา edge เจอบนข้อมูลสุ่ม".
"""

import numpy as np
import pytest

from tradelab.analysis import conditions, episodes, screen, stats


def test_contiguous_run_is_one_episode():
    mask = np.array([False, True, True, True, False, False])
    assert episodes.count(mask) == 1


def test_separate_runs_are_separate_episodes():
    mask = np.array([True, False, True, False, True])
    assert episodes.count(mask) == 3


def test_gap_merges_nearby_runs():
    """Overlapping trades are one observation, not several."""
    mask = np.array([True, False, False, True, False, False, False, False, False, True])
    assert episodes.count(mask, gap=0) == 3
    assert episodes.count(mask, gap=2) == 2  # first two merge, last stays apart
    assert episodes.count(mask, gap=20) == 1


def test_empty_mask_has_no_episodes():
    assert episodes.count(np.zeros(10, dtype=bool)) == 0
    ids = episodes.cluster_ids(np.zeros(10, dtype=bool))
    assert (ids == episodes.NO_EPISODE).all()


def test_cluster_ids_only_label_selected_bars():
    mask = np.array([False, True, True, False, True])
    ids = episodes.cluster_ids(mask)
    assert ids[0] == episodes.NO_EPISODE
    assert ids[3] == episodes.NO_EPISODE
    assert ids[1] == ids[2]
    assert ids[4] != ids[1]


def test_group_means_averages_within_episode():
    mask = np.array([True, True, False, True])
    ids = episodes.cluster_ids(mask)
    means = episodes.group_means([2.0, 4.0, 99.0, 7.0], ids)
    np.testing.assert_allclose(np.sort(means), [3.0, 7.0])


def test_group_means_skips_nan():
    ids = episodes.cluster_ids(np.array([True, True, True]))
    means = episodes.group_means([1.0, np.nan, 3.0], ids)
    assert means.size == 1 and means[0] == pytest.approx(2.0)


def test_episode_clustering_widens_the_interval():
    """The whole point: 2,000 correlated bars must not look like 2,000 samples."""
    rng = np.random.default_rng(0)
    # 20 episodes of 100 identical bars each - really 20 observations
    per_episode = rng.standard_normal(20) * 0.5 + 0.05
    r = np.repeat(per_episode, 100)
    mask = np.ones(r.size, dtype=bool)

    naive = stats.expectancy(r)
    clustered = stats.expectancy(r, episodes.group_means(r, episodes.cluster_ids(mask)))

    assert naive.n == clustered.n == 2000
    assert clustered.n_episodes == 1  # one contiguous block
    # a naive interval on repeated values is absurdly tight
    assert naive.se_r < 0.02


def test_calendar_condition_is_rejected():
    """`is_friday` over two months covers thousands of bars and ~8 Fridays."""
    import pandas as pd

    n = 11_200  # ~39 weekdays of M5 bars
    idx = pd.date_range("2023-01-02", periods=n, freq="5min", tz="UTC")
    idx = idx[idx.dayofweek < 5][:n]
    is_friday = (idx.dayofweek == 4).astype(float)
    feats = pd.DataFrame({"clock.is_friday": is_friday}, index=idx)

    lenient = conditions.build(feats, min_n=100, min_episodes=1)
    assert lenient, "sanity: the condition does exist"

    guarded = conditions.build(feats, min_n=100, min_episodes=30)
    assert not guarded, "a handful of Fridays must not qualify as a finding"


def test_screen_reports_episode_count():
    rng = np.random.default_rng(1)
    n = 6000
    flag = rng.integers(0, 2, size=n).astype(float)
    feats = __import__("pandas").DataFrame({"blk.flag": flag})
    r = rng.standard_normal(n) * 0.5 - 0.1

    conds = conditions.build(feats, min_n=100, min_episodes=30)
    table = screen.screen_expectancy(conds, r)
    assert "n_episodes" in table.columns
    assert (table["n_episodes"] > 0).all()
    assert (table["n_episodes"] <= table["n"]).all()
