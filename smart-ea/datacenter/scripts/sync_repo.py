r"""Keep a copy of the data-center CODE in the git monorepo (dev-workspace\smart-ea\datacenter\), so it is versioned and backed up on GitHub.
The working location stays C:\trade datacenter (user's choice); data files (sqlite, npz, pkl, csv, html, png) are NOT copied — they are rebuilt
from the code. Copied: README.md, brokers\*.json, scripts\*.py, scripts\sets\*.set (byte for byte).
    python sync_repo.py          copy changed files into the repo (then commit them in dev-workspace)
    python sync_repo.py --check  only list differences (adx_check.py runs diff() and fails if anything differs)
Repo location: environment variable DC_REPO, default below."""
import os, sys, glob, shutil
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
REPO = os.environ.get("DC_REPO", r"C:\Users\surak\Documents\GitHub\dev-workspace\smart-ea\datacenter")
PATTERNS = ["README.md", os.path.join("brokers", "*.json"), os.path.join("scripts", "*.py"), os.path.join("scripts", "sets", "*.set")]

def files(base):
    return sorted({os.path.relpath(p, base) for pat in PATTERNS for p in glob.glob(os.path.join(base, pat))})

def _same(a, b):
    """same content ignoring CRLF/LF (git may convert line endings in the repo copy)"""
    with open(a, "rb") as x, open(b, "rb") as y: return x.read().replace(b"\r\n", b"\n") == y.read().replace(b"\r\n", b"\n")

def diff():
    """relative paths that are missing / different in the repo copy, or present only in the repo (deleted at the source)"""
    if not os.path.isdir(REPO): return ["<repo copy missing: " + REPO + ">"]
    src, dst = files(ROOT), files(REPO); out = []
    for f in src:
        b = os.path.join(REPO, f)
        if not os.path.exists(b) or not _same(os.path.join(ROOT, f), b): out.append(f)
    out += [f + " (only in repo)" for f in dst if f not in src]
    return out

def sync():
    d = diff() if os.path.isdir(REPO) else files(ROOT)          # first sync: every file is new
    for f in files(ROOT):
        a, b = os.path.join(ROOT, f), os.path.join(REPO, f)
        os.makedirs(os.path.dirname(b), exist_ok=True)
        if not os.path.exists(b) or not _same(a, b): shutil.copyfile(a, b)
    for f in files(REPO):
        if not os.path.exists(os.path.join(ROOT, f)): os.remove(os.path.join(REPO, f))
    return d

if __name__ == "__main__":
    if "--check" in sys.argv:
        d = diff(); print("\n".join(d) if d else "repo copy is up to date"); sys.exit(1 if d else 0)
    d = sync(); print(f"synced {len(d)} file(s) into {REPO}" + ("".join("\n  " + x for x in d) if d else ""))
