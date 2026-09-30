r"""Root cause C (2026-09-30): ceiling of trade management (cut / BE / hold longer / half) with what is known during the trade.
Data = adx_hold.sqlite (3B-A decision points: events + every-5-bar checks), unique trades, TRAINING FIELD ONLY.
 C1 hindsight oracle: best single action at the best decision point (upper bound nobody can reach)
 C2 realistic: month by month (2025-04 .. 2026-05) fit models on trades of the previous 365 days (closed before T) that predict the
    gain of each action vs plan (d_cut = r_cut - r_plan, d_be, d_hold) from the trade state + event bits; policy = at the FIRST
    decision point where the best predicted gain > 0 take that action. Realized gain per trade of the month, out of sample.
    Also: the same policy with the models trained on a SHUFFLED target (noise floor of the procedure).
Uses rc_pred.Boost (numpy boosting, fixed settings). Sample: every trade with uid % 3 == 0 (a third, to fit memory)."""
import sys, os, sqlite3, calendar, datetime as dt, time
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, rc_pred as RP

DBH = r"C:\trade datacenter\adx_hold.sqlite"; OUT = r"C:\trade datacenter\rc\rc_exit.txt"
LIMD = calendar.timegm(dt.datetime(2026, 6, 1).timetuple()) // 86400
db = sqlite3.connect(DBH)
q = ("SELECT d.uid, d.dec_t, d.bar_n, d.flags, d.ev_big_dir*u.dir, d.ev_pin_dir*u.dir, d.ev_piv_dir*u.dir, d.ev_reg_new*u.dir, d.ev_box_dir*u.dir,"
     " d.held_min, d.min_to_cut, d.n_tp_hit, d.rem, d.realized_r, d.open_r, d.mfe_r, d.mae_r, d.dist_sl_r, d.dist_tp_r,"
     " u.tf, (u.exit_mode = 'L'), u.dir, u.day, u.exit_t, d.r_plan, d.r_cut, d.r_be, d.r_hold"
     " FROM dec d JOIN utrades u USING(uid) WHERE u.uid % 3 = 0 AND u.day < ? ORDER BY d.uid, d.dec_t")
tic = time.time()
A = np.array(db.execute(q, (LIMD,)).fetchall(), dtype=float)
print("rows", len(A), "%.0fs" % (time.time() - tic), flush=True)
uid = A[:, 0].astype(np.int64); day = A[:, 22].astype(np.int64); ext = A[:, 23]
fl = A[:, 3].astype(np.int64)
bits = np.stack([(fl >> i) & 1 for i in range(14)], 1).astype(np.float32)
X = np.hstack([A[:, [2]], bits, A[:, 4:22]]).astype(np.float32)     # bar_n, 14 bits, 5 event dirs x trade dir, state, tf, ladder, dir
plan = A[:, 24]; dcut = A[:, 25] - plan; dbe = A[:, 26] - plan; dhold = A[:, 27] - plan
beok = np.isfinite(dbe); dbe0 = np.where(beok, dbe, 0.0)
first = np.r_[True, uid[1:] != uid[:-1]]; tstart = np.flatnonzero(first); tid = np.cumsum(first) - 1
ntr = len(tstart); tday = day[tstart]
lines = []
def say(s): print(s, flush=True); lines.append(s)

# C1 oracle
best = np.maximum.reduceat(np.maximum(np.maximum(dcut, dhold), np.where(beok, dbe, -9)), tstart)
say(f"unique trades {ntr}, decision rows {len(A)}")
say(f"C1 hindsight oracle (best action at best point, per trade): mean gain {np.mean(np.maximum(best, 0)):+.3f} R/trade"
    f"  | cut only {np.mean(np.maximum(np.maximum.reduceat(dcut, tstart), 0)):+.3f}")

def policy(pc, pb, ph, rows):
    """first row per trade where the best predicted gain > 0 -> realized gain of that action; 0 if never"""
    pb = np.where(beok[rows], pb, -np.inf)
    P = np.stack([pc, pb, ph], 1); act = P.argmax(1); pos = P.max(1) > 0
    real = np.stack([dcut[rows], dbe0[rows], dhold[rows]], 1)[np.arange(len(rows)), act]
    t = tid[rows]; g = {}
    for i in np.flatnonzero(pos):
        if t[i] not in g: g[t[i]] = (real[i], act[i])
    return g

rng = np.random.default_rng(5)
res = []
y, m = 2025, 4
while (y, m) <= (2026, 5):
    t0 = calendar.timegm(dt.datetime(y, m, 1).timetuple()); a = t0 // 86400
    y2, m2 = (y + (m == 12), m % 12 + 1); b = min(calendar.timegm(dt.datetime(y2, m2, 1).timetuple()) // 86400, LIMD)
    tr = np.flatnonzero((day >= a - 365) & (day < a) & (ext + 60 <= t0)); te = np.flatnonzero((day >= a) & (day < b))
    tr = rng.choice(tr, min(len(tr), 200000), replace=False)
    out = []
    for shuffle in (False, True):
        preds = []
        for yv, ok in ((dcut, None), (dbe0, beok), (dhold, None)):
            rows = tr if ok is None else tr[ok[tr]]
            yy = yv[rows].copy()
            if shuffle: yy = rng.permutation(yy)
            preds.append(RP.Boost().fit(X[rows], yy).predict(X[te]))
        g = policy(*preds, te)
        n_month = len(np.unique(tid[te]))
        gain = sum(v[0] for v in g.values()) / n_month
        acts = np.bincount([v[1] for v in g.values()], minlength=3)
        out.append((gain, len(g) / n_month, acts))
    res.append((y, m, out[0][0], out[1][0]))
    say(f"{y}-{m:02d} trades {n_month:5d} | model: gain {out[0][0]:+.3f} R/trade, acted on {out[0][1]:.0%} (cut/BE/hold {out[0][2].tolist()})"
        f" | shuffled: {out[1][0]:+.3f}")
    y, m = y2, m2
R = np.array(res)
say(f"MEAN over {len(R)} months: model {R[:, 2].mean():+.3f} R/trade (sd of months {R[:, 2].std():.3f}), months > 0: {(R[:, 2] > 0).sum()}/{len(R)}"
    f" | shuffled {R[:, 3].mean():+.3f}")
open(OUT, "w", encoding="utf-8").write("\n".join(lines))
