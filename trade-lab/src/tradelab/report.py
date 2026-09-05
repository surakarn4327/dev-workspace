"""Render a study as Markdown a human can argue with.

Design choice: the report leads with what *failed*. A wall of promising rows at
the top is how research projects like this go wrong - the reader needs to see
the sanity checks and the survival rate before the leaderboard.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .config import Config, REPORT_DIR
from .pipeline import StudyResult

_VOLUME_CAVEAT = (
    "⚠️ ตัวเลขที่อิง volume ทั้งหมดมาจาก **tick volume** (จำนวนครั้งที่ราคาขยับ) "
    "ไม่ใช่ปริมาณซื้อขายจริง — บน XAUUSD/forex ไม่มีตลาดกลาง จึงถือเป็นหลักฐานที่อ่อนกว่า "
    "feature เดียวกันบน futures หรือหุ้น"
)


def render(result: StudyResult, cfg: Config) -> str:
    p: list[str] = []
    a = p.append

    a(f"# ผลวิจัย {result.symbol} {result.timeframe}")
    a("")
    a(f"- ข้อมูล: **{result.bars:,} แท่ง** ({result.span})")
    a(f"- feature ที่คำนวณ: **{result.n_features}** คอลัมน์")
    a(f"- เงื่อนไขที่ทดสอบ: **{result.n_conditions}**")
    a(f"- กันข้อมูลเป็น holdout ไว้: **{cfg.split.holdout_frac:.0%}** (ยังไม่แตะ)")
    a(f"- ต้นทุนที่หัก: spread {cfg.costs.spread_points:g} จุด + slippage {cfg.costs.slippage_points:g} จุด ต่อขา")
    a("")

    # --- 1. gate: did the machinery pass its own checks
    a("## 1. ตรวจความน่าเชื่อถือของระบบก่อน")
    a("")
    a("ถ้าข้อนี้ไม่ผ่าน ตัวเลขทุกอย่างข้างล่างไม่มีความหมาย")
    a("")
    for c in result.sanity:
        mark = "✅" if c.passed else ("❌" if c.blocking else "⚠️")
        a(f"- {mark} **{c.name}** — {c.detail}")
    if result.lookahead_leaks:
        a("")
        a(f"- ❌ **look-ahead** — พบ {len(result.lookahead_leaks)} feature ที่อ่านอนาคต:")
        for leak in result.lookahead_leaks[:10]:
            a(f"  - `{leak.column}` ({leak.n_differing:,} แท่งเปลี่ยนค่า)")
    else:
        a("- ✅ **look-ahead** — ไม่พบ feature ที่อ่านอนาคต")
    a("")

    if not result.sanity_ok or result.lookahead_leaks:
        a("> 🛑 **หยุดที่นี่** — ระบบยังไม่ผ่านการตรวจตัวเอง ต้องแก้ก่อนจะเชื่อผลวิเคราะห์ใดๆ")
        return "\n".join(p)

    # --- 2. events
    a("## 2. เหตุการณ์ที่ตรวจจับได้")
    a("")
    a("```")
    a(result.event_stats.report())
    a("```")
    a("")

    # --- 3. survival summary, before any leaderboard
    a("## 3. สรุปว่ามีอะไร \"รอด\" บ้าง")
    a("")
    a(_survival_table(result))
    a("")
    a("**คอลัมน์ \"รอดจริง\" คือคอลัมน์เดียวที่ควรสนใจ** — ผ่าน FDR อย่างเดียวไม่พอ เพราะ:")
    a("")
    a("- ค่า p คิดจาก*ค่าเฉลี่ยต่อครั้ง* แต่เงินที่ได้จริงคือ*ค่าเฉลี่ยต่อไม้* สองอย่างนี้ต่างกันได้")
    a("- แถวที่มีนัยทางสถิติแต่ E[R] ติดลบ = ไม่ได้เงิน")
    a("- แถวที่กำไรทั้งหมดมาจากไม้เดียว = โชค ไม่ใช่ edge")
    a("")
    a("\"รอดจริง\" ต้องผ่านทั้ง 4 อย่าง: ผ่าน FDR · E[R] ต่อไม้ > 0 · E[R] ต่อครั้ง > 0 · CI ล่าง > 0 · ไม่พึ่งไม้เดียว")
    a("")
    a("> และแม้จะ \"รอดจริง\" ก็ยัง**ไม่ใช่ของจริง** จนกว่าจะผ่าน walk-forward (ข้อ 6) และ holdout (ข้อ 9)")
    a("")
    a(
        "**ถ้า \"อัตราเกิด\" มีของรอด แต่ \"ทำกำไร\" รอด 0** — แปลว่าเจอรูปแบบจริงในตลาด "
        "แต่**เทรดไม่ได้กำไร** ซึ่งเกิดบ่อยมากและไม่ใช่ความผิดพลาด สาเหตุปกติคือรู้ว่า"
        "จะกลับตัวแต่ไม่รู้ว่าจะกลับตัว*แรงพอ*ให้คุ้ม SL + spread หรือไม่"
    )
    a("")

    # --- 4. per family event rate
    a("## 4. จุดกลับตัว / เด้ง / ก่อนวิ่ง เกิดที่ไหน")
    a("")
    a(
        "> **baseline เทียบกับกลุ่มที่ถูกต้อง** — กลับตัวและเด้งเกิดได้เฉพาะที่จุด swing "
        "เท่านั้น จึงเทียบกับ*จุด swing ทั้งหมด* ไม่ใช่ทุกแท่ง (ถ้าเทียบกับทุกแท่ง feature "
        "ที่แค่บอกว่า \"ตอนนี้อยู่ที่จุด swing\" จะได้ lift ฟรี 2-3 เท่าโดยไม่มีข้อมูลอะไรเลย) "
        "ส่วนก่อนวิ่งจริงเกิดได้ทุกแท่ง จึงเทียบกับทุกแท่ง"
    )
    a("")
    thai = {"reversal": "กลับตัว", "bounce": "เด้ง", "expansion": "ก่อนวิ่งจริง"}
    for family, table in result.event_rate.items():
        a(f"### {thai.get(family, family)}")
        a("")
        if table.empty:
            a("_ไม่มีเงื่อนไขไหนมีตัวอย่างพอ_")
            a("")
            continue
        a(f"เงื่อนไขที่ทดสอบ {len(table)} · รอดจริง {_count(table, 'survives')}")
        a("")
        a(_md_table(
            table.head(12),
            ["rule", "n", "n_episodes", "rate", "baseline_rate", "lift", "p_value", "survives"],
            {"rate": "{:.1%}", "baseline_rate": "{:.1%}", "lift": "{:.2f}x", "p_value": "{:.2g}"},
            ["เงื่อนไข", "แท่ง", "ครั้ง", "อัตราเกิด", "baseline", "lift", "p", "รอดจริง"],
        ))
        a("")

    # --- 5. expectancy
    a("## 5. เงื่อนไขไหนทำกำไรจริง (หักต้นทุนแล้ว)")
    a("")
    a(
        "หน่วยเป็น **R** (กำไรเทียบระยะ SL) — `+0.30R` แปลว่าเฉลี่ยต่อไม้ได้ 0.3 เท่าของ"
        "ความเสี่ยงที่ยอมรับ ตัวเลขนี้หัก spread/slippage แล้ว"
    )
    a("")
    a(
        "> คอลัมน์ **ครั้ง** คือจำนวน*โอกาสที่เกิดขึ้นแยกกันจริง* ไม่ใช่จำนวนแท่ง — "
        "เงื่อนไขที่กิน 2,000 แท่งแต่เกิดแค่ 7 ครั้ง (เช่น \"ทุกวันศุกร์\") มีตัวอย่างจริง 7 ตัว "
        "ไม่ใช่ 2,000 ค่า p และช่วงความเชื่อมั่นในตารางคิดจากคอลัมน์นี้"
    )
    a("")
    for side, label in (("long", "ฝั่ง Buy"), ("short", "ฝั่ง Sell")):
        table: pd.DataFrame = getattr(result, f"expectancy_{side}")
        base = result.baseline.get(f"{side}_mean_r", float("nan"))
        a(f"### {label}")
        a("")
        a(f"baseline (เข้าทุกแท่ง): **{base:+.4f}R**")
        a("")
        if table.empty:
            a("_ไม่มีเงื่อนไขไหนมีตัวอย่างพอ_")
            a("")
            continue
        a(_md_table(
            table.head(12),
            ["rule", "n", "n_episodes", "win_rate", "mean_r", "mean_r_episode", "ci_low",
             "max_drawdown_r", "top_trade_share", "survives"],
            {
                "win_rate": "{:.1%}", "mean_r": "{:+.4f}", "mean_r_episode": "{:+.4f}",
                "ci_low": "{:+.3f}", "max_drawdown_r": "{:.1f}", "top_trade_share": "{:.0%}",
            },
            ["เงื่อนไข", "แท่ง", "ครั้ง", "แม่น", "E[R]/ไม้", "E[R]/ครั้ง", "CI ล่าง", "DD",
             "ไม้เดียว%", "รอดจริง"],
        ))
        a("")

    # --- 6. combinations
    a("## 6. ผสมเงื่อนไขแล้วดีขึ้นมั้ย")
    a("")
    if result.mined_rules.empty:
        a("_ไม่พบกฎที่มีตัวอย่างพอ_")
    else:
        a(
            f"ขุดจากต้นไม้ตัดสินใจ ลึกไม่เกิน {cfg.analysis.max_rule_depth} ชั้น "
            f"(ไม่ได้ไล่ทุกชุดแบบ brute force — ดู CLAUDE.md กฎข้อ 4)"
        )
        a("")
        a(_md_table(
            result.mined_rules.head(10),
            ["rule", "depth", "n", "n_episodes", "win_rate", "mean_r", "ci_low",
             "single_trade_risk", "survives"],
            {"win_rate": "{:.1%}", "mean_r": "{:+.4f}", "ci_low": "{:+.3f}"},
            ["กฎ", "ชั้น", "แท่ง", "ครั้ง", "แม่น", "E[R]", "CI ล่าง", "เสี่ยงไม้เดียว",
             "รอดจริง"],
        ))
    a("")

    a("### walk-forward — กฎที่ขุดได้ ใช้กับช่วงถัดไปได้มั้ย")
    a("")
    if result.walk_forward.empty:
        a("_ข้อมูลไม่พอแบ่ง fold_")
    else:
        held = int(result.walk_forward["held_up"].sum())
        a(f"**{held}/{len(result.walk_forward)} fold** ที่กฎยังกำไรบนช่วงที่ไม่เคยเห็น")
        a("")
        a(_md_table(
            result.walk_forward,
            ["fold", "train_mean_r", "train_n", "test_mean_r", "test_n", "test_episodes",
             "held_up"],
            {"train_mean_r": "{:+.4f}", "test_mean_r": "{:+.4f}"},
            ["fold", "E[R] train", "แท่ง train", "E[R] test", "แท่ง test", "ครั้ง test", "รอด"],
        ))
        a("")
        a("_กฎในแต่ละ fold คือกฎที่ดีที่สุดที่ขุดได้จากช่วง train ของ fold นั้น_")
    a("")

    # --- 7. redundancy + importance
    a("## 7. indicator ซ้ำซ้อนกันแค่ไหน")
    a("")
    if result.redundancy.empty:
        a("ไม่พบกลุ่ม feature ที่ซ้ำซ้อนเกินเกณฑ์")
    else:
        a(
            f"feature ที่สหสัมพันธ์กันเกิน {cfg.analysis.redundancy_threshold:.0%} "
            "ถือว่าพูดเรื่องเดียวกัน — ใช้ทั้งกลุ่มพร้อมกันไม่ได้เพิ่มความมั่นใจ"
        )
        a("")
        a(_md_table(result.redundancy.head(15), ["group", "size", "members"], {},
                    ["กลุ่ม", "จำนวน", "สมาชิก"]))
    a("")

    if not result.importance.empty:
        a("### feature ที่โมเดลใช้มากที่สุด")
        a("")
        a("_ความสำคัญ ≠ ทำกำไร — ใช้จัดลำดับว่าควรดูอะไรต่อ ไม่ใช่ข้อสรุป_")
        a("")
        a(_md_table(result.importance.head(15), ["feature", "importance", "importance_std"],
                    {"importance": "{:.5f}", "importance_std": "{:.5f}"},
                    ["feature", "ความสำคัญ", "sd"]))
        a("")

    # --- 8. discovery
    a("## 8. รูปแบบที่ยังไม่มีชื่อ")
    a("")
    if result.clusters.empty:
        a("_ข้อมูลไม่พอจัดกลุ่ม_")
    else:
        a(
            "จัดกลุ่มจุดเหตุการณ์โดย**ไม่บอกโมเดลว่าแนวคิดอะไรมีอยู่ในโลก** "
            "กลุ่มที่กำไรและไม่ตรงกับแนวคิดไหนเลย คือของที่ต้องเอามาดูแล้วตั้งชื่อกันเอง"
        )
        a("")
        a(_md_table(
            result.clusters,
            ["cluster", "n", "n_episodes", "win_rate", "mean_r", "ci_low", "passes_fdr"],
            {"win_rate": "{:.1%}", "mean_r": "{:+.4f}", "ci_low": "{:+.3f}"},
            ["กลุ่ม", "แท่ง", "ครั้ง", "แม่น", "E[R]", "CI ล่าง", "มีนัย"],
        ))
        a("")
        from .analysis.discover import describe_cluster

        best = result.clusters.iloc[0]
        prof = describe_cluster(result.cluster_profile, int(best["cluster"]))
        if not prof.empty:
            a(f"### กลุ่มที่ {int(best['cluster'])} มีลักษณะอะไร")
            a("")
            a("_ค่าเป็น standard deviation เทียบค่าเฉลี่ยรวม — บวกคือสูงกว่าปกติ_")
            a("")
            a(_md_table(prof, ["feature", "z_vs_overall"], {"z_vs_overall": "{:+.2f}"},
                        ["feature", "z"]))
    a("")

    # --- 9. what to do next
    a("## 9. ขั้นถัดไป")
    a("")
    a("1. อ่านข้อ 3 ก่อน — ถ้าไม่มีอะไรรอด ก็คือคำตอบแล้ว ไม่ต้องดันต่อ")
    a("2. เลือกกฎที่ผ่านทั้ง FDR และ walk-forward มา **ไม่เกิน 3-5 ข้อ** แล้ว *แช่ไว้*")
    a("3. รัน `confirm` ครั้งเดียวบน holdout — ผ่านคือของจริง ไม่ผ่านคือบันทึกว่าไม่ผ่าน")
    a("4. ที่ผ่าน holdout ค่อยแปลงเป็น Pine indicator หรือกฎเข้าออเดอร์ใน `smart-ea`")
    a("")
    a("---")
    a("")
    a(_VOLUME_CAVEAT)
    a("")
    return "\n".join(p)


def _count(table: pd.DataFrame, col: str) -> int:
    return int(table[col].sum()) if not table.empty and col in table.columns else 0


def _survival_table(result: StudyResult) -> str:
    thai = {"reversal": "กลับตัว", "bounce": "เด้ง", "expansion": "ก่อนวิ่ง"}
    rows = []
    for family, table in result.event_rate.items():
        rows.append(
            {
                "ชั้นการกรอง": f"อัตราเกิด — {thai.get(family, family)}",
                "ทดสอบ": len(table),
                "ผ่าน FDR": _count(table, "passes_fdr"),
                "ผ่าน Bonferroni": _count(table, "passes_bonferroni"),
                "รอดจริง": _count(table, "survives"),
            }
        )
    for side, label in (("long", "Buy"), ("short", "Sell")):
        table = getattr(result, f"expectancy_{side}")
        rows.append(
            {
                "ชั้นการกรอง": f"ทำกำไร — {label}",
                "ทดสอบ": len(table),
                "ผ่าน FDR": _count(table, "passes_fdr"),
                "ผ่าน Bonferroni": _count(table, "passes_bonferroni"),
                "รอดจริง": _count(table, "survives"),
            }
        )
    if not result.mined_rules.empty:
        rows.append(
            {
                "ชั้นการกรอง": "กฎผสม (ขุดจากต้นไม้)",
                "ทดสอบ": len(result.mined_rules),
                "ผ่าน FDR": _count(result.mined_rules, "passes_fdr"),
                "ผ่าน Bonferroni": "—",
                "รอดจริง": _count(result.mined_rules, "survives"),
            }
        )
    df = pd.DataFrame(rows)
    return _md_table(df, list(df.columns), {})


def _md_table(
    df: pd.DataFrame,
    cols: list[str],
    fmt: dict[str, str],
    headers: list[str] | None = None,
) -> str:
    if df.empty:
        return "_ไม่มีข้อมูล_"
    cols = [c for c in cols if c in df.columns]
    head = headers if headers and len(headers) == len(cols) else cols
    lines = ["| " + " | ".join(str(h) for h in head) + " |",
             "|" + "|".join("---" for _ in cols) + "|"]
    for _, row in df[cols].iterrows():
        cells = []
        for c in cols:
            v = row[c]
            if isinstance(v, bool) or (hasattr(v, "dtype") and str(getattr(v, "dtype", "")) == "bool"):
                cells.append("✅" if v else "—")
            elif c in fmt and pd.notna(v):
                try:
                    cells.append(fmt[c].format(v))
                except (ValueError, TypeError):
                    cells.append(str(v))
            elif pd.isna(v):
                cells.append("—")
            elif isinstance(v, float):
                cells.append(f"{v:,.4g}")
            else:
                cells.append(str(v))
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def save(result: StudyResult, cfg: Config, *, root: Path | None = None) -> Path:
    root = root or REPORT_DIR
    root.mkdir(parents=True, exist_ok=True)
    dest = root / f"{result.symbol}_{result.timeframe}.md"
    dest.write_text(render(result, cfg), encoding="utf-8")
    return dest
