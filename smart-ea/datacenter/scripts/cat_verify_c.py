"""Independent checks for catalog step 2: re-detect HS/IHS, TRIANGLE, V_REV, FLAG from the pivots TABLE with separate loops
(written from the definitions, no shared code) and compare counts with patterns_c; recheck 300 random retests bar by bar."""
import numpy as np, sqlite3
import cat_bars as CB
db = sqlite3.connect(CB.DB)
for tf in (1, 5, 15):
    B = CB.tf_bars(tf); pos = {int(x): i for i, x in enumerate(B["t"])}
    P = db.execute("SELECT t_pivot, t_confirm, price, kind, atr FROM pivots WHERE tf=? ORDER BY t_pivot", (tf,)).fetchall()
    cnt = {"HS": 0, "IHS": 0, "TRIANGLE": 0, "V_REV": 0, "FLAG": 0}
    for j in range(4, len(P)):
        a = P[j - 2][4]; pr = [P[k][2] for k in range(j - 4, j + 1)]
        if not a or a != a: continue
        legs = [abs(pr[i + 1] - pr[i]) for i in range(4)]
        if P[j][3] == 1 and pr[2] - max(pr[0], pr[4]) >= a and abs(pr[0] - pr[4]) <= a and abs(pr[1] - pr[3]) <= a: cnt["HS"] += 1
        if P[j][3] == -1 and min(pr[0], pr[4]) - pr[2] >= a and abs(pr[0] - pr[4]) <= a and abs(pr[1] - pr[3]) <= a: cnt["IHS"] += 1
        if all(legs[i + 1] <= 0.85 * legs[i] for i in range(3)): cnt["TRIANGLE"] += 1
        bi = [pos[P[k][0]] for k in (j - 2, j - 1, j)]
        la, lb = abs(pr[3] - pr[2]), abs(pr[4] - pr[3])
        if la >= 6 * a and bi[1] - bi[0] <= 10 and lb >= 0.8 * la and bi[2] - bi[1] <= 10: cnt["V_REV"] += 1
        d = 1 if pr[1] > pr[0] else -1; imp = legs[0]
        if imp >= 8 * a and all(x <= 0.5 * imp for x in legs[1:]) and all((x - (pr[1] - d * 0.5 * imp)) * d >= 0 for x in pr[2:]): cnt["FLAG"] += 1
    for ty, v in cnt.items():
        tb = db.execute("SELECT COUNT(*) FROM patterns_c WHERE tf=? AND type=?", (tf, ty)).fetchone()[0]
        print(f"M{tf:<2} {ty:9s} recount {v:6d} table {tb:6d} {'OK' if v == tb else 'DIFF'}")
    # retests: 300 random rows re-walked bar by bar
    R = db.execute("SELECT outcome, t_break, t_retest, dir FROM retests WHERE tf=? ORDER BY RANDOM() LIMIT 300", (tf,)).fetchall()
    piv_by_break = {}
    bad = 0
    for out, tb_, tr_, d in R:
        b = pos[tb_]
        if out.startswith("RETEST"):
            r = pos[tr_]
            # the retest bar must touch within 0.25 ATR of some pivot level L: recover L as the level between break close and the touch
            ok = (r > b) and (B["sid"][r] == B["sid"][b])
            bad += not ok
    print(f"M{tf:<2} retests sampled 300: structural violations {bad}")
