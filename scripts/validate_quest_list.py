#!/usr/bin/env python3
"""
Validate quest_list.md against data/extracted_quests.json.
Produces data/validation_report.md.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_QUEST_LIST = REPO_ROOT / "quest_list.md"
DEFAULT_EXTRACTED = REPO_ROOT / "data" / "extracted_quests.json"
DEFAULT_REPORT = REPO_ROOT / "data" / "validation_report.md"


def normalize_title(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"^(gig|cyberpsycho sighting|reported crime|suspected organized crime activity|fool on the hill|tomorrow never knows):\s*", "", s)
    s = re.sub(r"[’'`\".,!?;:()\-–—]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_quest_list(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8") as f:
        for line_no, raw in enumerate(f, 1):
            line = raw.strip()
            if not line.startswith("|"):
                continue
            parts = [p.strip() for p in line.split("|")[1:-1]]
            if len(parts) < 7:
                continue
            qid, qtype, title, giver, rewards, req, unlocks = parts[:7]
            if qid in ("ID", ":---") or qid.startswith("---"):
                continue
            rows.append({
                "line": str(line_no),
                "id": qid,
                "type": qtype,
                "title": title,
                "giver": giver,
                "rewards": rewards,
                "req": req,
                "unlocks": unlocks,
            })
    return rows


def match_quest(
    row: dict[str, str],
    by_exact: dict[str, list[dict[str, Any]]],
    by_norm: dict[str, list[dict[str, Any]]],
    all_titles_norm: list[str],
) -> tuple[str, list[dict[str, Any]], float]:
    # Endings, Tarots, and Dogtown IC activities are journal sub-entries/POIs, not gameJournalQuest
    if row["type"] in ("E", "PLE", "T", "IC"):
        return "subentry_type", [], 0.0

    raw_title = row["title"]
    # Support "A / B" dual titles
    candidates = [t.strip() for t in raw_title.split(" / ")] if " / " in raw_title else [raw_title]

    for c in candidates:
        low = c.lower().strip()
        if low in by_exact:
            return "exact", by_exact[low], 1.0

    for c in candidates:
        norm = normalize_title(c)
        if norm in by_norm:
            return "normalized", by_norm[norm], 0.99

    # Fuzzy match on normalized title
    best_score = 0.0
    best_norm = None
    for c in candidates:
        norm = normalize_title(c)
        matches = difflib.get_close_matches(norm, all_titles_norm, n=1, cutoff=0.78)
        if matches:
            score = difflib.SequenceMatcher(None, norm, matches[0]).ratio()
            if score > best_score:
                best_score = score
                best_norm = matches[0]
    if best_norm is not None:
        return "fuzzy", by_norm[best_norm], best_score

    return "unmatched", [], 0.0


NON_PLAYABLE_PREFIXES = (
    "quests/vehicle_metaquest/",
    "quests/street_stories/e3_vm_hack_v2/",
)

NON_PLAYABLE_META_IDS = {
    "01_climbing_the_ladder",
    "03_haru_kasai",
    "04_mysterious_stranger",
    "05_arasaka_princess",
    "06_samurai_reunited",
    "07_nc_underground",
    "08_headhunter",
    "10_survive",
    "11_johnny_business",
}

CONTAINER_QUEST_IDS = {
    "mq025_psycho_brawl",     # Beat on the Brat (covered by S05, S63-S66)
    "sq_cyberpsychos_regina", # Cyberpsychosis (covered by S08, CP01-CP17)
    "mq033_tarot",            # Fool on the Hill (covered by T01-T20)
    "mq033_ep1",              # Tomorrow Never Knows (covered by T21-T24)
    "sq025_delamain",         # Epistrophy (covered by S42-S48)
    "q300_phantom_liberty",   # Phantom Liberty (covered by PL01-PL20)
    "courier_outro",          # Courier outro (internal vehicle courier tracker)
    "sa_ep1_15",              # Internal sandbox activity stub
}


def is_playable_game_quest(q: dict[str, Any]) -> bool:
    if q.get("isVersionTracking"):
        return False
    title = (q.get("title") or "").strip()
    if not title or title.startswith("!") or title.startswith("LocKey"):
        return False
    jpath = q.get("journalPath", "")
    if any(jpath.startswith(p) for p in NON_PLAYABLE_PREFIXES):
        return False
    if q.get("journalId") in NON_PLAYABLE_META_IDS:
        return False
    if q.get("journalId") in CONTAINER_QUEST_IDS:
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate quest_list.md against extracted_quests.json.")
    parser.add_argument("--quest-list", type=Path, default=DEFAULT_QUEST_LIST)
    parser.add_argument("--extracted", type=Path, default=DEFAULT_EXTRACTED)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    if not args.extracted.exists():
        print(f"Error: {args.extracted} not found. Run scripts/extract_game_data.py first.", file=sys.stderr)
        return 1

    rows = parse_quest_list(args.quest_list)
    with args.extracted.open("r", encoding="utf-8") as f:
        extracted = json.load(f)

    game_quests = [q for q in extracted["quests"] if is_playable_game_quest(q)]

    by_exact: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_norm: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for q in game_quests:
        by_exact[q["title"].lower().strip()].append(q)
        by_norm[normalize_title(q["title"])].append(q)
    all_titles_norm = list(by_norm.keys())

    matched_journal_paths: set[str] = set()
    exact_matches = []
    norm_matches = []
    fuzzy_matches = []
    subentry_rows = []
    unmatched_rows = []

    for row in rows:
        kind, gqs, score = match_quest(row, by_exact, by_norm, all_titles_norm)
        for gq in gqs:
            matched_journal_paths.add(gq["journalPath"])
        gq0 = gqs[0] if gqs else None
        entry = (row, gq0, score)
        if kind == "exact":
            exact_matches.append(entry)
        elif kind == "normalized":
            norm_matches.append(entry)
        elif kind == "fuzzy":
            fuzzy_matches.append(entry)
        elif kind == "subentry_type":
            subentry_rows.append(row)
        else:
            unmatched_rows.append(row)

    # Find in-game quests not in quest_list.md (exclude StreetStory / NCPD)
    missing_from_md = [
        q for q in game_quests
        if q["journalPath"] not in matched_journal_paths
        and q.get("questType") not in ("StreetStory",)
    ]

    # Build report
    lines: list[str] = []
    lines.append("# Quest List Validation Report\n")
    lines.append(f"- **Rows in `quest_list.md`:** {len(rows)}")
    lines.append(f"- **In-game `gameJournalQuest` (excl. version tracking):** {len(game_quests)}")
    lines.append(f"- **Exact title matches:** {len(exact_matches)}")
    lines.append(f"- **Normalized matches (prefix/punctuation diffs):** {len(norm_matches)}")
    lines.append(f"- **Fuzzy matches (potential title typos):** {len(fuzzy_matches)}")
    lines.append(f"- **Unmatched `quest_list.md` rows:** {len(unmatched_rows)}")
    lines.append(f"- **In-game quests missing from `quest_list.md` (excl. `StreetStory`/NCPD):** {len(missing_from_md)}\n")

    lines.append("## 1. Potential Title Mismatches (Fuzzy Matches)\n")
    if fuzzy_matches:
        lines.append("| Line | ID | `quest_list.md` Title | In-Game Title | `journalId` | Type | Score |")
        lines.append("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
        for row, gq, score in fuzzy_matches:
            lines.append(
                f"| {row['line']} | {row['id']} | {row['title']} | {gq['title']} | `{gq['journalId']}` | {gq['questType']} | {score:.2f} |"
            )
    else:
        lines.append("_None._")
    lines.append("")

    lines.append("## 2. Normalized Matches (Prefix / Punctuation Differences)\n")
    if norm_matches:
        lines.append("| Line | ID | `quest_list.md` Title | In-Game Title | `journalId` |")
        lines.append("| :--- | :--- | :--- | :--- | :--- |")
        for row, gq, _ in norm_matches[:50]:
            lines.append(f"| {row['line']} | {row['id']} | {row['title']} | {gq['title']} | `{gq['journalId']}` |")
        if len(norm_matches) > 50:
            lines.append(f"\n_... and {len(norm_matches) - 50} more._")
    else:
        lines.append("_None._")
    lines.append("")

    lines.append("## 3. Unmatched Rows in `quest_list.md`\n")
    lines.append("_(Note: Endings `E`/`PLE`, Tarot `T`, NCPD `N`, and `IC` activities are often tracked as journal sub-entries, POIs, or facts rather than standalone `gameJournalQuest` records.)_\n")
    by_type: dict[str, list[dict[str, str]]] = defaultdict(list)
    for r in unmatched_rows:
        by_type[r["type"]].append(r)
    for qtype, items in sorted(by_type.items()):
        lines.append(f"### Type `{qtype}` ({len(items)})\n")
        for r in items[:40]:
            lines.append(f"- Line {r['line']} **{r['id']}**: {r['title']}")
        if len(items) > 40:
            lines.append(f"- _... and {len(items) - 40} more_")
        lines.append("")

    lines.append("## 4. In-Game Quests Missing from `quest_list.md` (excl. `StreetStory`)\n")
    m_by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for q in missing_from_md:
        m_by_type[str(q.get("questType"))].append(q)
    for qtype, items in sorted(m_by_type.items()):
        lines.append(f"### `{qtype}` ({len(items)})\n")
        for q in sorted(items, key=lambda x: x["title"]):
            lines.append(f"- `{q['journalId']}` — **{q['title']}** (`{q['journalPath']}`)")
        lines.append("")

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text("\n".join(lines), encoding="utf-8")

    print("\n".join(lines[:10]))
    print(f"Full report written to {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
