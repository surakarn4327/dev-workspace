"""Self-test of broker neutrality: build a fake broker from the Exness bars whose server clock is GMT+2 / GMT+3 (NY_CLOSE style,
like most MT5 brokers) and run broker_check.py --build on it. Expected: clock detected as NY_CLOSE and every catalog count
identical to Exness (ratio 1.00). Removes the fake broker afterwards."""
import os, sys, json, shutil, subprocess
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.normpath(os.path.join(HERE, ".."))
import broker as BK                                            # exness (default)
src = np.load(BK.BARS); t_utc = BK.server_to_utc(src["t"])
t_srv = t_utc + np.where(BK.us_dst(t_utc), 3, 2) * 3600       # what a NY_CLOSE server would show
os.makedirs(os.path.join(ROOT, "brokers", "_selftest"), exist_ok=True)
np.savez_compressed(os.path.join(ROOT, "brokers", "_selftest", "bars.npz"), t=t_srv, o=src["o"], h=src["h"], l=src["l"], c=src["c"], tv=src["tv"], sp=src["sp"])
prof = dict(BK.P, name="_selftest", server_time="NY_CLOSE", bars_file="brokers/_selftest/bars.npz", db_file="brokers/_selftest/gold_dc.sqlite")
json.dump(prof, open(os.path.join(ROOT, "brokers", "_selftest.json"), "w", encoding="utf-8"), indent=1)
try:
    quick = "--quick" in sys.argv
    r = subprocess.run([sys.executable, os.path.join(HERE, "broker_check.py"), "_selftest"] + ([] if quick else ["--build"]), cwd=HERE, capture_output=True, text=True)
    out = r.stdout.splitlines(); print("\n".join(out[:6] + ["..."] + [x for x in out if "suggested" in x or "metric" in x or ">" in x][-60:])); print(r.stderr[-3000:])
finally:
    shutil.rmtree(os.path.join(ROOT, "brokers", "_selftest"), ignore_errors=True)
    os.remove(os.path.join(ROOT, "brokers", "_selftest.json"))
    print("fake broker removed")
