r"""Root cause B (2026-09-30): how much of a trade's result can be predicted from everything the Data Center knows at entry?
= the ceiling of what ANY entry-side Selector can do with these features.
For each month T (2025-04 .. 2026-05): fit on trades with trade-day in [T-365d, T) and closed before T; predict every trade of the
month; measure the mean R of the top 20% / top 10% predicted trades minus the mean of all trades of the month.
Features: all 195-3 ctx columns, the same x trade direction, trade direction, and the set parameters (so the model can also choose
sets/TF). Models: gradient boosting (sklearn HistGradientBoosting, fixed settings chosen before any result) and ridge.
Same pipeline on the random-direction markets sf1..sf5 (no real direction information) = noise floor.
Usage: python rc_pred.py <real|sf1..sf5> [first YYYY-MM] [last YYYY-MM] [--small]
Resumable: one file per (market, month) in rc\pred\.  TRAINING FIELD ONLY."""
import sys, os, sqlite3, calendar, datetime as dt, time
import numpy as np
# sklearn is blocked by the machine's Application Control policy -> two small numpy models (settings fixed before any result):
#  ridge   : standardized features, NaN -> 0, alpha = n
#  boosting: gradient boosting of one-feature step functions on 10 quantile bins (+1 NaN bin) of the training window;
#            each round fits the current residual with the single best feature, bin means shrunk n/(n+K_SHR), learning rate LR
NB, K_SHR, LR, ROUNDS = 10, 2000.0, 0.1, 100

class Boost:
    def fit(self, X, y):
        n, p = X.shape
        self.edges = [np.unique(np.nanpercentile(X[:, j], np.linspace(10, 90, NB - 1))) if np.isfinite(X[:, j]).any() else np.array([])
                      for j in range(p)]
        B = self._bin(X); self.mu = y.mean(); res = y - self.mu
        flat = (B.astype(np.int64) + (NB + 1) * np.arange(p)).ravel()
        cnt = np.bincount(flat, minlength=p * (NB + 1)).reshape(p, NB + 1)
        self.steps = []
        for _ in range(ROUNDS):
            S = np.bincount(flat, weights=np.repeat(res, p), minlength=p * (NB + 1)).reshape(p, NB + 1)
            gain = (S * S / (cnt + K_SHR)).sum(1); j = int(gain.argmax())
            v = LR * S[j] / (cnt[j] + K_SHR); self.steps.append((j, v)); res = res - v[B[:, j]]
        return self
    def _bin(self, X):
        B = np.empty(X.shape, np.uint8)
        for j, e in enumerate(self.edges):
            x = X[:, j]; b = np.searchsorted(e, x, side="right"); b[~np.isfinite(x)] = NB; B[:, j] = b
        return B
    def predict(self, X):
        B = self._bin(X); out = np.full(len(X), self.mu)
        for j, v in self.steps: out += v[B[:, j]]
        return out

def ridge(Xtr, y, Xte):
    mu = np.nanmean(Xtr, 0); sd = np.nanstd(Xtr, 0); sd[~(sd > 0)] = 1
    Z = lambda X: np.nan_to_num((X - mu) / sd).astype(np.float64)
    A = Z(Xtr); ym = y.mean()
    w = np.linalg.solve(A.T @ A + len(y) * np.eye(A.shape[1]), A.T @ (y - ym))
    return Z(Xte) @ w + ym

ROOT = r"C:\trade datacenter"; OUTD = os.path.join(ROOT, "rc", "pred")
SANDBOX_END = calendar.timegm(dt.datetime(2026, 6, 1).timetuple()); LIMD = SANDBOX_END // 86400
LIB_FROM = calendar.timegm(dt.datetime(2024, 4, 15).timetuple())
NTRAIN = 150_000


def load(mkt):
    dbt = os.path.join(ROOT, "adx_trades.sqlite") if mkt == "real" else os.path.join(ROOT, "p3_null", mkt, "adx_trades.sqlite")
    db = sqlite3.connect(dbt)
    P = {r[0]: r[1:] for r in db.execute("SELECT set_id, tf, adx_p, ema_p, min_adx, min_gap, sl_atr, exit_mode FROM params")}
    R = np.array(db.execute("SELECT set_id, entry_t, exit_t, day, dir, r_std FROM trades WHERE entry_t >= ? AND exit_t + 60 <= ? AND day < ?",
                            (LIB_FROM, SANDBOX_END, LIMD)).fetchall(), dtype=float)
    cols = [r[1] for r in db.execute("PRAGMA table_info(ctx)")]
    C = np.array(db.execute(f"SELECT {','.join(cols)} FROM ctx WHERE entry_t < ? ORDER BY entry_t", (SANDBOX_END,)).fetchall(), dtype=float)
    key = C[:, 0].astype(np.int64); C = C.astype(np.float32)     # key from float64 (epoch seconds do not fit float32)
    et = R[:, 1].astype(np.int64); pos = np.searchsorted(key, et)
    assert np.all(key[pos] == et)
    feat_c = C[:, 1:]                                  # drop entry_t
    d = R[:, 4].astype(np.float32)
    par = np.array([[*P[int(s)][:6], 1.0 if P[int(s)][6] == "L" else 0.0] for s in R[:, 0]], dtype=np.float32)
    return R, feat_c, pos, d, par, cols[1:]

def build_X(fc, pos, d, par, idx):
    a = fc[pos[idx]]
    return np.hstack([a, a * d[idx, None], d[idx, None], par[idx]])

def month_iter(first, last):
    y, m = map(int, first.split("-")); y1, m1 = map(int, last.split("-"))
    while (y, m) <= (y1, m1):
        yield y, m
        y, m = (y + (m == 12), m % 12 + 1)

def run(mkt, first, last, small=False):
    os.makedirs(OUTD, exist_ok=True)
    R, fc, pos, d, par, _ = load(mkt)
    day = R[:, 3].astype(np.int64); ex = R[:, 2]; r = R[:, 5]
    rng = np.random.default_rng(11)
    for y, m in month_iter(first, last):
        f = os.path.join(OUTD, f"{mkt}_{y}{m:02d}{'_small' if small else ''}.npz")
        if os.path.exists(f): continue
        t0 = calendar.timegm(dt.datetime(y, m, 1).timetuple()); a = t0 // 86400
        y2, m2 = (y + (m == 12), m % 12 + 1); b = min(calendar.timegm(dt.datetime(y2, m2, 1).timetuple()) // 86400, LIMD)
        tr = np.flatnonzero((day >= a - 365) & (day < a) & (ex + 60 <= t0))
        te = np.flatnonzero((day >= a) & (day < b))
        if small: tr = rng.choice(tr, 20000, replace=False); te = te[:20000]
        elif len(tr) > NTRAIN: tr = rng.choice(tr, NTRAIN, replace=False)
        tic = time.time()
        Xtr = build_X(fc, pos, d, par, tr); Xte = build_X(fc, pos, d, par, te)
        pg = Boost().fit(Xtr, r[tr]).predict(Xte)
        pr = ridge(Xtr, r[tr], Xte)
        np.savez(f, te=te, r=r[te], day=day[te], pg=pg, pr=pr, n_tr=len(tr))
        print(mkt, y, m, "train", len(tr), "test", len(te), "%.0fs" % (time.time() - tic), flush=True)

if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    run(a[0], a[1] if len(a) > 1 else "2025-04", a[2] if len(a) > 2 else "2026-05", "--small" in sys.argv)
