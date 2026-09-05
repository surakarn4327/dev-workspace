"""Command line entry points.

    python -m tradelab check                    ตรวจว่าต่อ MT5 ได้มั้ย
    python -m tradelab fetch --years 3          ดึงข้อมูล M1 + M5 มาเก็บ
    python -m tradelab import-csv <file> --timeframe M5
    python -m tradelab sanity                   ตรวจว่าระบบซื่อสัตย์
    python -m tradelab events                   นับเหตุการณ์ที่ตรวจจับได้
    python -m tradelab study                    วิจัยเต็มรูปแบบ + ออกรายงาน
    python -m tradelab confirm --rules-file r.txt   ทดสอบ holdout (ครั้งเดียว)

เพิ่ม ``--synthetic`` เพื่อรันบนข้อมูลจำลอง (ทดสอบระบบ ไม่ใช่ผลตลาดจริง)
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

from . import events as events_mod
from . import features as features_mod
from . import report as report_mod
from .config import DEFAULT, TIMEFRAMES, Config, ensure_dirs
from .data import load_bars, mt5_source, store, synthetic
from .pipeline import confirm_on_holdout, research
from .validate import lookahead, sanity

SYNTHETIC_BANNER = (
    "\n  ⚠️  ข้อมูลจำลอง (random walk) — ใช้ทดสอบว่าระบบทำงานถูกเท่านั้น\n"
    "      ผลลัพธ์ไม่ใช่ข้อเท็จจริงของตลาด และ *ต้อง* ไม่มีอะไรทำกำไรได้\n"
)


def _cfg(args) -> Config:
    cfg = DEFAULT
    if getattr(args, "symbol", None):
        cfg = cfg.with_(symbol=args.symbol)
    return cfg


def _load(args, cfg: Config, timeframe: str) -> pd.DataFrame:
    if args.synthetic:
        return synthetic.generate(
            n_bars=args.synthetic_bars, timeframe=timeframe, seed=cfg.seed
        )
    return load_bars(cfg.symbol, timeframe, allow_synthetic=False)


def _timeframes(args) -> list[str]:
    if getattr(args, "timeframe", None):
        return [args.timeframe]
    return list(TIMEFRAMES)


# --- commands -----------------------------------------------------------------


def cmd_check(args) -> int:
    print("  MetaTrader 5 terminal:", end=" ")
    if mt5_source.available():
        print("พร้อมใช้งาน ✅")
        try:
            info = mt5_source.symbol_info(_cfg(args).symbol)
            for k, v in info.items():
                print(f"    {k:<22}{v}")
        except mt5_source.MT5Unavailable as exc:
            print(f"    ⚠️ {exc}")
        return 0
    print("ต่อไม่ได้ ❌")
    print("    ต้องติดตั้ง MetaTrader 5 แล้วเปิดโปรแกรมไว้ (login บัญชี demo ก็พอ)")
    print("    ระหว่างนี้ใช้ --synthetic เพื่อทดสอบระบบ หรือ import-csv ถ้ามีไฟล์ข้อมูล")
    return 1


def cmd_fetch(args) -> int:
    ensure_dirs()
    cfg = _cfg(args)
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=int(args.years * 365.25))
    rc = 0
    for tf in _timeframes(args):
        try:
            bars = mt5_source.fetch(cfg.symbol, tf, start, end)
        except mt5_source.MT5Unavailable as exc:
            print(f"  ❌ {cfg.symbol} {tf}: {exc}")
            rc = 1
            continue
        dest = store.save(bars, cfg.symbol, tf)
        print(f"  ✅ {cfg.symbol} {tf}: {len(bars):,} แท่ง -> {dest.name}")
    return rc


def cmd_import_csv(args) -> int:
    ensure_dirs()
    cfg = _cfg(args)
    bars = store.load_csv(args.path)
    dest = store.save(bars, cfg.symbol, args.timeframe)
    print(f"  ✅ นำเข้า {len(bars):,} แท่ง -> {dest.name}")
    return 0


def cmd_sanity(args) -> int:
    cfg = _cfg(args)
    if args.synthetic:
        print(SYNTHETIC_BANNER)
    rc = 0
    for tf in _timeframes(args):
        bars = _load(args, cfg, tf)
        ev, stats = events_mod.detect(bars, cfg.events)
        print(f"\n  {cfg.symbol} {tf} — {len(bars):,} แท่ง")
        for check in sanity.run_all(bars, stats.counts):
            print(f"    {check}")
            # advisory warnings describe the market, not a bug - they must not
            # make the command look like it failed
            if not check.passed and check.blocking:
                rc = 1

        print("    ตรวจ look-ahead ...")
        leaks = lookahead.check(bars, features_mod.build)
        if leaks:
            rc = 1
            for leak in leaks[:10]:
                print(f"      ❌ {leak.column}: {leak.n_differing:,} แท่งเปลี่ยนค่า")
        else:
            print("      ✅ ไม่พบ feature ที่อ่านอนาคต")
    return rc


def cmd_events(args) -> int:
    cfg = _cfg(args)
    if args.synthetic:
        print(SYNTHETIC_BANNER)
    for tf in _timeframes(args):
        bars = _load(args, cfg, tf)
        _, stats = events_mod.detect(bars, cfg.events)
        print(f"\n  {cfg.symbol} {tf}")
        print(stats.report())
    return 0


def cmd_features(args) -> int:
    cfg = _cfg(args)
    for tf in _timeframes(args):
        bars = _load(args, cfg, tf)
        feats = features_mod.build(bars)
        print(f"\n  {cfg.symbol} {tf}: {feats.shape[1]} feature จาก {len(features_mod.names())} block")
        for name in features_mod.names():
            cols = [c for c in feats.columns if c.startswith(f"{name}.")]
            print(f"    {name:<18}{len(cols):>3} คอลัมน์")
    return 0


def cmd_study(args) -> int:
    ensure_dirs()
    cfg = _cfg(args)
    if args.synthetic:
        print(SYNTHETIC_BANNER)
    rc = 0
    for tf in _timeframes(args):
        bars = _load(args, cfg, tf)
        print(f"\n  วิจัย {cfg.symbol} {tf} ({len(bars):,} แท่ง) ...")
        result = research(
            bars,
            cfg,
            timeframe=tf,
            run_lookahead=not args.skip_lookahead,
            run_clusters=not args.skip_clusters,
        )
        dest = report_mod.save(result, cfg, root=Path(args.out) if args.out else None)
        print(f"    รายงาน -> {dest}")
        if not result.sanity_ok or result.lookahead_leaks:
            print("    🛑 ระบบไม่ผ่านการตรวจตัวเอง — ผลวิเคราะห์ถูกข้ามไป")
            rc = 1
        else:
            survivors = sum(
                int(t["passes_fdr"].sum()) for t in result.event_rate.values() if not t.empty
            )
            print(f"    เงื่อนไขที่ผ่าน FDR (อัตราเกิด): {survivors}")
    return rc


def cmd_confirm(args) -> int:
    cfg = _cfg(args)
    rules = [
        line.strip()
        for line in Path(args.rules_file).read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]
    if not rules:
        print("  ❌ ไม่มีกฎในไฟล์")
        return 1
    print(
        f"\n  ⚠️  กำลังแตะ holdout ด้วย {len(rules)} กฎ — ทำได้ครั้งเดียว\n"
        "      ถ้าไม่ผ่าน ให้บันทึกว่าไม่ผ่าน ห้ามกลับไปแก้แล้วรันซ้ำ (CLAUDE.md กฎข้อ 2)\n"
    )
    for tf in _timeframes(args):
        bars = _load(args, cfg, tf)
        table = confirm_on_holdout(bars, cfg, rules)
        print(f"  {cfg.symbol} {tf}")
        for _, row in table.iterrows():
            mark = "✅" if row["confirmed"] else "❌"
            print(f"    {mark} {row['rule']}")
            print(f"       n={row['n']:,}  E[R]={row['mean_r']:+.4f}  แม่น={row['win_rate']:.1%}")
    return 0


# --- wiring -------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="tradelab", description="ห้องแล็บวิจัยตลาด M1/M5")
    p.add_argument("--symbol", default=None, help=f"default: {DEFAULT.symbol}")
    p.add_argument("--timeframe", choices=list(TIMEFRAMES), default=None, help="default: ทั้ง M1 และ M5")
    p.add_argument("--synthetic", action="store_true", help="ใช้ข้อมูลจำลองแทนข้อมูลจริง")
    p.add_argument("--synthetic-bars", type=int, default=60_000)

    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("check", help="ตรวจว่าต่อ MT5 ได้มั้ย").set_defaults(fn=cmd_check)

    f = sub.add_parser("fetch", help="ดึงข้อมูลจาก MT5 มาเก็บ")
    f.add_argument("--years", type=float, default=3.0)
    f.set_defaults(fn=cmd_fetch)

    c = sub.add_parser("import-csv", help="นำเข้าข้อมูลจากไฟล์ CSV")
    c.add_argument("path")
    c.add_argument("--timeframe", required=True, choices=list(TIMEFRAMES), dest="timeframe")
    c.set_defaults(fn=cmd_import_csv)

    sub.add_parser("sanity", help="ตรวจว่าระบบซื่อสัตย์").set_defaults(fn=cmd_sanity)
    sub.add_parser("events", help="นับเหตุการณ์ที่ตรวจจับได้").set_defaults(fn=cmd_events)
    sub.add_parser("features", help="ดูว่ามี feature อะไรบ้าง").set_defaults(fn=cmd_features)

    s = sub.add_parser("study", help="วิจัยเต็มรูปแบบ + ออกรายงาน")
    s.add_argument("--out", default=None, help="โฟลเดอร์รายงาน")
    s.add_argument("--skip-lookahead", action="store_true", help="ข้ามการตรวจ look-ahead (เร็วขึ้น แต่เสี่ยง)")
    s.add_argument("--skip-clusters", action="store_true")
    s.set_defaults(fn=cmd_study)

    cf = sub.add_parser("confirm", help="ทดสอบ holdout — ครั้งเดียวเท่านั้น")
    cf.add_argument("--rules-file", required=True)
    cf.set_defaults(fn=cmd_confirm)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.fn(args))
    except FileNotFoundError as exc:
        print(f"  ❌ {exc}")
        return 1
    except KeyboardInterrupt:
        print("\n  ยกเลิก")
        return 130


if __name__ == "__main__":
    sys.exit(main())
