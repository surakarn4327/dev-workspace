r"""One-off (2026-09-29): the day-swap checkpoint p3b\real_perm_partial.pkl (draws 1000-1399) was written by the first p3b_lib engine.
The faster engine (shared baseline sort, one flag scan, quintile labels once) was proved BIT-IDENTICAL on seeds 1000, 1001, 1137, 1250,
1399 (every t equal, same NaN pattern). This stamps the checkpoint with the new code hash so p3b_perm.py resumes instead of restarting.
p3b_audit.py re-checks seeds from both ranges against the new engine."""
import os, pickle, hashlib
import broker as BK
here = os.path.dirname(os.path.abspath(__file__)); part = os.path.join(os.path.dirname(BK.DB), "p3b", "real_perm_partial.pkl")
code = hashlib.sha1(b"".join(open(os.path.join(here, f), "rb").read() for f in ("p3b_lib.py", "p3b_perm.py", "p3lib.py"))).hexdigest()
z = pickle.load(open(part, "rb")); old = z["code"]; z["code"] = code; z["restamped_from"] = old
pickle.dump(z, open(part + ".tmp", "wb")); os.replace(part + ".tmp", part)
print(f"draws {z['t'].shape[0]}: {old[:10]} -> {code[:10]}")
