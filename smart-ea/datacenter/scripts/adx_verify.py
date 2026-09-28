r"""Phase 1: compare adx_lib trades with an MT5 Strategy Tester report of AdxEmaVolReTF (re-entry off, vol sizing off,
fixed risk), trade by trade. Only trade matching / price differences are printed — never totals (2026 stays locked).
Usage: python adx_verify.py <report.htm> <tf> <adx> <ema> <min_adx> <gap> <sl> <L|T3> <from yyyy-mm-dd> <to yyyy-mm-dd> [no_entry_min]"""
import sys, re, html, os
from datetime import datetime, timezone
import numpy as np
import broker as BK, adx_lib as A

def parse_report(path):
    raw = open(path, "rb").read()
    txt = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8", "ignore")
    s = txt.find("<b>Deals</b>"); blk = txt[s: txt.find("</table>", s)]
    pos, cur = [], None
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", blk, re.S):
        c = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(c) < 13 or c[2] == "" or not c[0][:1].isdigit(): continue
        num = lambda x: float(x.replace(" ", "").replace("\xa0", "")) if x else 0.0
        t = int(datetime.strptime(c[0], "%Y.%m.%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
        if c[4] == "in":
            if cur: pos.append(cur)
            cur = dict(t=t, d=1 if c[3] == "buy" else -1, vol=num(c[5]), px=num(c[6]), outs=[], net=0.0)
        elif c[4] == "out" and cur:
            cur["outs"].append((t, num(c[5]), num(c[6]), c[12])); cur["net"] += num(c[8]) + num(c[9]) + num(c[10])
    if cur: pos.append(cur)
    return pos

def main(a):
    rep, tf, ap, ep, ma, gp, sl, ex, f, t = a[:10]; ne = int(a[10]) if len(a) > 10 else 0
    tf, ap, ep, ma, gp, sl = int(tf), int(ap), int(ep), float(ma), float(gp), float(sl)
    lo, hi = BK.utc_ts(f), BK.utc_ts(t)          # server clock (Exness = UTC)
    M = A.load_m1(lo - 60 * 86400, hi + 2 * 86400); mk = A.Market(M, 23, 16, ne)
    S = A.signals(mk, tf, ap, ep); tr = A.run_set(mk, S, ma, gp, sl, ex)
    sim = {int(M["t"][x["e"]]): x for x in tr if lo <= M["t"][x["e"]] < hi}
    mt = {p["t"] // 60 * 60: p for p in parse_report(rep) if lo <= p["t"] < hi}
    both = sorted(set(sim) & set(mt)); so = sorted(set(sim) - set(mt)); mo = sorted(set(mt) - set(sim))
    print(f"{os.path.basename(rep)}: sim {len(sim)} | mt5 {len(mt)} | matched {len(both)} | sim-only {len(so)} | mt5-only {len(mo)}")
    dr, de, dx, dirm, rsn = [], [], [], 0, 0
    for k in both:
        s, m = sim[k], mt[k]
        dirm += s["d"] != m["d"]
        vol = sum(o[1] for o in m["outs"])
        r_mt = sum(o[1] * (o[2] - m["px"]) * m["d"] for o in m["outs"]) / (vol * s["risk"]) if vol else 0
        dr.append(r_mt - s["r"]); de.append((m["px"] - s["entry"]) * s["d"])
        dx.append((m["outs"][-1][0] // 60 * 60) - int(M["t"][s["exit_i"]]))
        kind = "sl" if m["outs"][-1][3].startswith("sl") else "tp" if m["outs"][-1][3].startswith("tp") else "other"
        rsn += {1: "sl", 2: "tp"}.get(s["reason"], "other") != kind
    dr, de, dx = np.array(dr), np.array(de), np.array(dx)
    if len(both):
        print(f"  dir mismatch {dirm} | exit-kind mismatch {rsn} | exit minute differs {int((dx != 0).sum())}")
        print(f"  R(mt5)-R(sim): median {np.median(dr):+.4f}  mean {dr.mean():+.4f}  |d|p95 {np.percentile(np.abs(dr), 95):.4f}  |d|>0.05: {int((np.abs(dr) > 0.05).sum())}")
        print(f"  entry price mt5-sim (adverse +): median {np.median(de):+.4f} mean {de.mean():+.4f}")
        dd = dr * np.array([sim[k]["risk"] for k in both]); sp = np.array([sim[k]["sp_entry"] for k in both])
        print(f"  per-trade $ (mt5 - sim, cost = negative): median {np.median(dd):+.4f} mean {dd.mean():+.4f} | sim bar spread median {np.median(sp):.3f}")
    for k in (so[:5] + mo[:5]):
        print("  unmatched", datetime.fromtimestamp(k, timezone.utc), "sim" if k in sim else "mt5")
    big = [k for k, d in zip(both, dr) if abs(d) > 0.05][:5]
    for k in big:
        s, m = sim[k], mt[k]
        print("  bigdiff", datetime.fromtimestamp(k, timezone.utc), "sim", s["reason"], round(s["r"], 3), "exit", datetime.fromtimestamp(int(M["t"][s["exit_i"]]), timezone.utc),
              "| mt5 outs", [(datetime.fromtimestamp(o[0], timezone.utc).strftime("%m-%d %H:%M:%S"), o[2], o[3]) for o in m["outs"]])

if __name__ == "__main__":
    main(sys.argv[1:])
