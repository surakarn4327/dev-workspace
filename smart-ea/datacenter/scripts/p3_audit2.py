r"""Phase 3 audit part 2 — what p3_audit.py does not cover:
 H the REPORT: gates G1-G6, permutation p, family-wise p, random-direction z and labels recomputed with separate plain-python code
   from the raw result files, compared with p3_results.csv row by row (all 549)
 I reproducibility: rebuild the real screen into a temp file -> identical to p3_real.pkl; rerun 20 permutations -> identical to p3_perm.pkl
 J the numbers written in smart-ea/CLAUDE.md for the passers equal the result files
Usage: python p3_audit2.py"""
import os, csv, glob, math, pickle, tempfile, re
import numpy as np
import p3lib as L, adx_asof, p3fast, p3_perm

HERE = os.path.dirname(adx_asof.DBT)
import sync_repo
CLAUDE = os.path.join(os.path.dirname(sync_repo.REPO), "CLAUDE.md")        # smart-ea\CLAUDE.md next to the repo copy of the data center

def main():
    bad = 0
    def ok(c, m):
        nonlocal bad; bad += not c; print(("OK   " if c else "FAIL ") + m, flush=True)
    real = pickle.load(open(os.path.join(HERE, "p3_real.pkl"), "rb"))["res"]
    P = pickle.load(open(os.path.join(HERE, "p3_perm.pkl"), "rb")); Tn = P["t_null"]
    sfs = [pickle.load(open(f, "rb"))["res"] for f in sorted(glob.glob(os.path.join(HERE, "p3_null", "p3_sf*.pkl")))]
    rows = list(csv.DictReader(open(os.path.join(HERE, "p3_results.csv"), encoding="utf-8-sig")))
    print("== H report recomputed independently")
    ok(len(rows) == len(real) == Tn.shape[1] == 549 and len(sfs) == 5 and Tn.shape[0] == 2000,
       f"sizes: csv {len(rows)}, real {len(real)}, null t {Tn.shape}, random markets {len(sfs)}")
    nP = Tn.shape[0]; colmax = [max(abs(x) for x in Tn[i]) for i in range(nP)]
    mism = []
    for i, (r, c) in enumerate(zip(real, rows)):
        if (str(r["tf"]), r["feat"], r["level"]) != (c["tf"], c["feat"], c["level"]): mism.append((i, "key")); continue
        sg = 1 if r["lift"] > 0 else -1
        g = {"G1": abs(r["t"]) >= 3 and r["days"] >= 100,
             "G2": all((1 if r[h] > 0 else -1) == sg and abs(r[h + "_t"]) >= 1.5 for h in ("h1", "h2")),
             "G3": all((1 if r[h] > 0 else -1) == sg and abs(r[h + "_t"]) >= 1.5 for h in ("buy", "sell")),
             "G4": r["sets_same"] >= 0.7,
             "G5": r["n_var"] > 0 and all((1 if a > 0 else -1) == sg and abs(t) >= 1.5 for a, t in zip(r["var_lift"], r["var_t"]))}
        cnt = sum(1 for k in range(nP) if abs(Tn[k][i]) >= abs(r["t"])); pp = (1 + cnt) / (nP + 1)
        pfw = (1 + sum(1 for k in range(nP) if colmax[k] >= abs(r["t"]))) / (nP + 1)
        g["G6"] = pp <= 0.01
        sl = [s[i]["lift"] for s in sfs]; m = sum(sl) / len(sl); sd = math.sqrt(sum((x - m) ** 2 for x in sl) / (len(sl) - 1))
        z = (r["lift"] - m) / math.sqrt(r["se"] ** 2 + sd ** 2 / len(sl))
        lab = "gold" if ((r["lift"] - m > 0) == (r["lift"] > 0) and abs(z) >= 2) else \
              ("mechanical" if ((m > 0) == (r["lift"] > 0) and abs(m) >= 0.5 * abs(r["lift"])) else "between")
        for k, v in g.items():
            if (c[k] == "True") != bool(v): mism.append((i, k))
        if (c["passed"] == "True") != all(g.values()): mism.append((i, "passed"))
        if abs(float(c["p_perm"]) - pp) > 1e-4 or abs(float(c["p_fw"]) - pfw) > 1e-4: mism.append((i, "p"))
        if abs(float(c["z_vs_sf"]) - z) > 1e-3 or c["null2"] != lab: mism.append((i, "null2"))
    ok(not mism, f"gates G1-G6, passed, p_perm, p_fw, z and label of all 549 rows equal the csv ({len(mism)} differences {mism[:5]})")
    passed = [c for c in rows if c["passed"] == "True"]
    print("   passers:", [(c["tf"], c["feat"], c["level"], c["lift"], c["t"], c["p_fw"]) for c in passed])
    print("== I reproducibility")
    tmp = os.path.join(tempfile.gettempdir(), "p3_real_repro.pkl")
    T, X = L.load(adx_asof.DBT); again = L.all_patterns(T, X)
    same = all(abs(a["t"] - b["t"]) < 1e-12 and a["n"] == b["n"] and (a["feat"], a["level"]) == (b["feat"], b["level"]) for a, b in zip(again, real))
    ok(same and len(again) == len(real), "screen rebuilt from the library = p3_real.pkl (t, n, order)")
    F = p3fast.Fast(T, X)
    d = max(float(np.max(np.abs(F.t_all(p3_perm.swapped_ci(T, X, 1000 + k)) - Tn[k]))) for k in (0, 1, 7, 500, 1999))
    ok(d < 1e-9, f"permutations 0, 1, 7, 500, 1999 recomputed = p3_perm.pkl (max diff {d:.1e})")
    print("== J numbers in CLAUDE.md")
    txt = open(os.path.normpath(CLAUDE), encoding="utf-8").read()
    blk = txt[txt.index("✅ เฟส 3 เสร็จ"):txt.index("🧪 ขั้น 3 รอบ 1")]
    c1 = [c for c in rows if (c["tf"], c["feat"], c["level"]) == ("1", "C_daypos", "Q1 (0-20%)")][0]
    c2 = [c for c in rows if (c["tf"], c["feat"], c["level"]) == ("1", "C_pdc", "Q1 (0-20%)")][0]
    neg = lambda x, f: ("−" if float(x) < 0 else "+") + format(abs(float(x)), f)
    expect = [f"{neg(c1['lift'], '.3f')}R ต่อไม้เทียบชุดตัวเอง** t {neg(c1['t'], '.1f')}",
              f"{neg(c2['lift'], '.3f')}R t {neg(c2['t'], '.1f')}",
              f"p = {float(c1['p_fw']):.2f} และ {float(c2['p_fw']):.2f}",
              f"G1 {sum(c['G1'] == 'True' for c in rows)}, G2 {sum(c['G2'] == 'True' for c in rows)}, G3 {sum(c['G3'] == 'True' for c in rows)}, "
              f"G4 {sum(c['G4'] == 'True' for c in rows)}, G5 {sum(c['G5'] == 'True' for c in rows)}, G6 {sum(c['G6'] == 'True' for c in rows)}",
              f"|t| ≥ 2 จริง {sum(abs(float(c['t'])) >= 2 for c in rows)} ตัว",
              f"ผ่านครบทุกด่าน {len(passed)} ตัว"]
    for s in expect: ok(s in blk, f"CLAUDE.md contains '{s}' (built from the result files)")
    print("ALL CHECKS OK" if bad == 0 else f"{bad} CHECK(S) FAILED")

if __name__ == "__main__":
    main()
