r"""Check a (new) broker before using its data.   usage:  python broker_check.py <name> [--ref exness] [--build]
Needs brokers\<name>.json and its bars file (run `set DC_BROKER=<name>` + `python bars.py` first).
 1) server clock: where the broker's daily pause sits in SERVER time vs where the market pause is in UTC (~17:00 New York)
    -> suggests server_time ("UTC", "UTC+N" or "NY_CLOSE") and says whether the profile is right
 2) data quality by month (flat bars, tick volume <= 1, bars per day) -> suggests data_start_utc
 3) spread by month (median, share of the single most common value = fixed/fake spread) -> suggests bar_spread_reliable_from_utc
 4) tick volume by month (median per M1 bar)
 5) --build: builds this broker's own data center + catalog (same scripts, DC_BROKER set), then compares with the reference broker
    on the SAME trading dates: M1 price difference, return correlation, catalog counts per day (flag if the ratio is outside 0.9-1.1)."""
import sys, os, json, subprocess, sqlite3
import numpy as np
from datetime import datetime, timezone
from collections import Counter
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.normpath(os.path.join(HERE, ".."))
args = sys.argv[1:]; NAME = args[0]; REF = args[args.index("--ref") + 1] if "--ref" in args else "exness"; BUILD = "--build" in args
prof = json.load(open(os.path.join(ROOT, "brokers", NAME + ".json"), encoding="utf-8"))
os.environ["DC_BROKER"] = NAME
import broker as BK
B = np.load(BK.BARS); ts = B["t"].astype(np.int64)
def mkey(x): return datetime.fromtimestamp(int(x), timezone.utc).strftime("%Y-%m")
print(f"=== broker {NAME}  symbol {prof['symbol']}  bars {len(ts)}  {datetime.fromtimestamp(int(ts[0]), timezone.utc):%Y-%m-%d} .. "
      f"{datetime.fromtimestamp(int(ts[-1]), timezone.utc):%Y-%m-%d} (server clock)")
# ---- 1) server clock
gap = np.diff(ts) // 60; idx = np.flatnonzero((gap >= 30) & (gap < 1000))
starts = ts[idx] + 60                                          # first missing minute = pause start (server clock)
dst = BK.us_dst(starts - 2 * 3600)                             # season (approximate UTC is fine for picking the season)
expected_utc_h = np.where(dst, 21, 22)                         # market pause starts at 17:00 New York
srv_h = ((starts // 60) % 1440) / 60.0
off = np.round(srv_h - expected_utc_h) % 24; off = np.where(off > 12, off - 24, off)
o_s, o_w = Counter(off[dst].astype(int)).most_common(1), Counter(off[~dst].astype(int)).most_common(1)
print(f"\n1) daily pauses found {len(idx)} | server offset vs UTC: US summer {o_s}, US winter {o_w}  (value, count)")
if o_s and o_w:
    s_, w_ = o_s[0][0], o_w[0][0]
    sugg = "UTC" if s_ == w_ == 0 else (f"UTC{'+' if s_ >= 0 else ''}{s_}" if s_ == w_ else ("NY_CLOSE" if (s_, w_) == (3, 2) else f"UNKNOWN summer {s_} winter {w_}"))
    print(f"   suggested server_time = {sugg} | profile says {prof['server_time']} -> {'OK' if sugg == prof['server_time'] else 'CHECK / FIX PROFILE'}")
# ---- 2..4) quality, spread, tick volume by month
tu = BK.server_to_utc(ts); flat = (B["o"] == B["h"]) & (B["h"] == B["l"]) & (B["l"] == B["c"])
mon = np.array([mkey(x) for x in tu[::1]]); months = sorted(set(mon))
from dc_sessions import sessions
_, day, _ = sessions(tu)
print("\n2-4) month   | bars/day | flat % | tickvol<=1 % | spread median (p5-p95) | most-common spread share | tick vol median")
for m in months:
    k = mon == m; nd = len(np.unique(day[k])); sp = B["sp"][k] * BK.POINT
    vals, cnts = np.unique(np.round(sp, 5), return_counts=True); share = cnts.max() / k.sum()
    fl = flat[k].mean(); tv1 = (B["tv"][k] <= 1).mean()
    print(f"  {m} | {k.sum() / nd:7.0f}  | {fl:6.1%} | {tv1:10.1%}   | {np.median(sp):.3f} ({np.percentile(sp, 5):.3f}-{np.percentile(sp, 95):.3f}) | {share:6.0%}"
          f"                    | {np.median(B['tv'][k]):.0f}")
# clean-data start at DAY resolution: first trading date after which every date has < 1% flat bars
ud = np.unique(day); fl_d = np.array([flat[day == d].mean() for d in ud]); bad_after = np.flatnonzero(fl_d >= 0.01)
clean_from = ud[bad_after[-1] + 1] if len(bad_after) and bad_after[-1] + 1 < len(ud) else (ud[0] if not len(bad_after) else None)
cf = datetime.fromtimestamp(int(clean_from) * 86400, timezone.utc).strftime("%Y-%m-%d") if clean_from is not None else "none"
print(f"   suggested data_start_utc = {cf} (every trading date from then on has < 1% flat bars) | profile {prof['data_start_utc']}"
      f" -> {'OK' if cf == prof['data_start_utc'] else 'CHECK'}")
print("   spread: the bar spread field cannot be validated from bars alone (a fixed value can be real or a placeholder);"
      f" compare with the broker's real ticks. profile says reliable from {prof.get('bar_spread_reliable_from_utc')}")
if not BUILD: sys.exit()
# ---- 5) build + compare with the reference broker
env = dict(os.environ, DC_BROKER=NAME); py = sys.executable
for s in ("dc_build.py", "dc_catalog.py", "dc_catalog_b.py", "cat_time.py", "dc_catalog_c.py"):
    r = subprocess.run([py, os.path.join(HERE, s)], env=env, cwd=HERE, capture_output=True, text=True)
    print(f"   built {s}: {'ok' if r.returncode == 0 else 'FAILED'}")
    if r.returncode: print(r.stderr[-2000:]); sys.exit(1)
ref_prof = json.load(open(os.path.join(ROOT, "brokers", REF + ".json"), encoding="utf-8"))
A = sqlite3.connect(os.path.join(ROOT, prof["db_file"])); R = sqlite3.connect(os.path.join(ROOT, ref_prof["db_file"]))
def fulldays(db):
    t = np.array([r[0] for r in db.execute("SELECT t FROM bars_m1")], dtype=np.int64); _, d, _ = sessions(t)
    ud, cnt = np.unique(d, return_counts=True); ok = set(ud[cnt >= 0.9 * np.median(cnt)].tolist())
    adr = dict(db.execute("SELECT day, adr20 FROM days").fetchall()); return {x for x in ok if adr.get(x)}
common = sorted(fulldays(A) & fulldays(R)); print(f"\n5) common full trading days {len(common)}")
if not common: sys.exit()
q = ",".join(str(d) for d in common)
ca = dict(A.execute("SELECT t, c FROM bars_m1").fetchall()); cr = dict(R.execute("SELECT t, c FROM bars_m1").fetchall())
tt = np.array(sorted(set(ca) & set(cr))); pa = np.array([ca[x] for x in tt]); pr = np.array([cr[x] for x in tt])
ra, rr = np.diff(pa), np.diff(pr); ok = np.diff(tt) == 60
print(f"   same-minute bars {len(tt)}: close diff median {np.median(pa - pr):+.3f} (p5 {np.percentile(pa - pr, 5):+.3f}, p95 {np.percentile(pa - pr, 95):+.3f}),"
      f" 1-min return correlation {np.corrcoef(ra[ok], rr[ok])[0, 1]:.3f}")
print("   metric (per common day)                     | this broker | reference | ratio")
def per(db, sql): return db.execute(sql.replace("{D}", q)).fetchone()[0] / len(common)
checks = [(f"M{tf} {ty}", f"SELECT COUNT(*) FROM patterns WHERE tf={tf} AND type='{ty}' AND day IN ({{D}})")
          for tf in (1, 5, 15) for ty in ("PINBAR", "ENGULF", "INSIDE", "OUTSIDE", "BIGBAR", "DOJI", "SQUEEZE", "PUSH", "SW_NEWEXT", "SW_FAIL", "SW_SWEEP", "SW_DOUBLE")]
checks += [(f"M{tf} legs", f"SELECT COUNT(*) FROM legs WHERE tf={tf} AND day IN ({{D}})") for tf in (1, 5, 15)]
checks += [(f"M{tf} boxes", f"SELECT COUNT(*) FROM boxes WHERE tf={tf} AND day IN ({{D}})") for tf in (1, 5, 15)]
checks += [(f"level {lv}", f"SELECT COUNT(*) FROM level_visits WHERE level_type='{lv}' AND day IN ({{D}})") for lv in ("R10", "PDH", "PDL", "DOPEN")]
checks += [("day range / ADR (mean)", "SELECT SUM(range/adr20) FROM days WHERE day IN ({D})")]
bad = 0
for nm, sql in checks:
    a, r = per(A, sql), per(R, sql); ratio = a / r if r else np.nan; flag = "" if 0.9 <= ratio <= 1.1 else "  <-- differs"
    bad += bool(flag); print(f"   {nm:44s} | {a:10.2f}  | {r:9.2f} | {ratio:5.2f}{flag}")
print(f"\n   {bad} metric(s) outside 0.9-1.1 -> {'catalog conclusions transfer' if bad == 0 else 'check these before reusing conclusions'}")
