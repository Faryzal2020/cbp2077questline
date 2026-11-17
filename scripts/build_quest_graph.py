#!/usr/bin/env python3
"""
Build data/curated_quests.json and data/quest_graph.json by merging
quest_list.md (plus optional data/curated_overrides.json) with data/extracted_quests.json.

Excludes standalone NCPD signals (Type 'N') from the graph view.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from validate_quest_list import (
    is_playable_game_quest,
    match_quest,
    normalize_title,
    parse_quest_list,
)


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_QUEST_LIST = REPO_ROOT / "quest_list.md"
DEFAULT_EXTRACTED = REPO_ROOT / "data" / "extracted_quests.json"
DEFAULT_OVERRIDES = REPO_ROOT / "data" / "curated_overrides.json"
DEFAULT_CURATED_OUT = REPO_ROOT / "data" / "curated_quests.json"
DEFAULT_GRAPH_OUT = REPO_ROOT / "data" / "quest_graph.json"

EXCLUDED_GRAPH_TYPES = {"N"}  # Standalone NCPD Scanner Hustles

DEBUG_FACT_RE = re.compile(r"^(CYB-|CP77-|.*_debug|.*_testing|debug_|test_)", re.IGNORECASE)


def expand_id_range(token: str, ordered_ids: list[str], id_set: set[str]) -> list[str]:
    """Expand a range like 'G01–G23' or 'S13–S26b' using the table's row order."""
    token = token.strip()
    m = re.match(r"^([A-Z]+\d+[a-z]?)[–\-]([A-Z]+\d+[a-z]?)$", token)
    if not m:
        return [token] if token in id_set else []
    start_id, end_id = m.group(1), m.group(2)
    if start_id in ordered_ids and end_id in ordered_ids:
        i0 = ordered_ids.index(start_id)
        i1 = ordered_ids.index(end_id)
        if i0 <= i1:
            return ordered_ids[i0 : i1 + 1]
    return []


def extract_id_refs(text: str, ordered_ids: list[str], id_set: set[str]) -> list[str]:
    """Extract all quest IDs (including ranges like G01–G23) referenced in a cell."""
    if not text or text == "—":
        return []
    refs: list[str] = []
    # First match ranges like G01–G23 or S13–S26b
    for m in re.finditer(r"\b([A-Z]+\d+[a-z]?[–\-][A-Z]+\d+[a-z]?)\b", text):
        refs.extend(expand_id_range(m.group(1), ordered_ids, id_set))
    # Then match standalone IDs (avoiding double-counting range endpoints by stripping ranges)
    stripped = re.sub(r"\b[A-Z]+\d+[a-z]?[–\-][A-Z]+\d+[a-z]?\b", " ", text)
    for m in re.finditer(r"\b([A-Z]{1,3}\d+[a-z]?)\b", stripped):
        tid = m.group(1)
        if tid in id_set:
            refs.append(tid)
    # Deduplicate preserving order
    seen: set[str] = set()
    out: list[str] = []
    for r in refs:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def parse_rewards(rewards_str: str) -> list[dict[str, Any]]:
    if not rewards_str or rewards_str == "—":
        return []
    items = [x.strip() for x in rewards_str.split(",") if x.strip()]
    return [
        {
            "name": item,
            "method": "quest_reward",
            "missable": False,
        }
        for item in items
    ]


def infer_arc(row: dict[str, str], gq: dict[str, Any] | None) -> str:
    qid = row["id"]
    qtype = row["type"]
    jpath = (gq or {}).get("journalPath", "")
    if qtype in ("PL", "PLE"):
        return "Phantom Liberty"
    if qtype in ("E",):
        return "Endings"
    if qtype == "CP":
        return "Cyberpsychos"
    if qtype == "T":
        return "Tarot"
    if qtype == "IC":
        return "Dogtown IC"
    if qtype == "G":
        if "ep1/" in jpath or row["giver"] == "Mr. Hands" and qid not in ("G64",):
            return "Gigs (Dogtown)"
        return f"Gigs ({row['giver']})"
    if qtype in ("M", "MI"):
        if "prologue" in jpath or qid in ("M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10", "M11"):
            return "Prologue / Act 1"
        if "epilogue" in jpath or qid in ("M30", "M31", "M32", "M33", "M34", "M35", "M36", "M37", "M38", "M39", "M40", "M41", "M42", "M43"):
            return "Act 3 / Finale"
        return "Act 2 (Main)"
    if "ep1/" in jpath or qid in ("S93", "S94", "S95", "S96", "S97", "S98", "S98b", "S99", "S100", "S100b", "S101", "S102", "S103", "S104", "S105", "S106", "S107", "S108", "S123", "S124", "S125", "S126"):
        return "Side (Phantom Liberty)"
    return "Side Quests"


def infer_parallel_group(row: dict[str, str]) -> str | None:
    title = row["title"]
    if title.startswith("Epistrophy:"):
        return "Epistrophy"
    if title.startswith("Beat on the Brat:") and row["id"] != "S05" and row["id"] != "S66":
        return "Beat on the Brat"
    if title.startswith("Fool on the Hill:"):
        return "Fool on the Hill"
    if title.startswith("Tomorrow Never Knows:"):
        return "Tomorrow Never Knows"
    if row["type"] == "IC":
        return "Increased Criminal Activity"
    if row["type"] == "CP" and "=" in row["req"]:
        return "Cyberpsycho Sightings (Badlands/City)"
    if row["type"] == "G" and "=" in row["req"]:
        return f"Gigs: {row['giver']}"
    return None


def clean_facts(facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for f in facts:
        name = f.get("factName", "")
        if not name or DEBUG_FACT_RE.match(name):
            continue
        key = f"{name}|{f.get('comparison')}|{f.get('value')}"
        if key not in seen:
            seen.add(key)
            out.append({
                "factName": name,
                "comparison": f.get("comparison"),
                "value": f.get("value"),
            })
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Build curated_quests.json and quest_graph.json.")
    parser.add_argument("--quest-list", type=Path, default=DEFAULT_QUEST_LIST)
    parser.add_argument("--extracted", type=Path, default=DEFAULT_EXTRACTED)
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES)
    parser.add_argument("--curated-out", type=Path, default=DEFAULT_CURATED_OUT)
    parser.add_argument("--graph-out", type=Path, default=DEFAULT_GRAPH_OUT)
    args = parser.parse_args()

    rows = parse_quest_list(args.quest_list)
    with args.extracted.open("r", encoding="utf-8") as f:
        extracted = json.load(f)

    overrides: dict[str, Any] = {}
    if args.overrides.exists():
        with args.overrides.open("r", encoding="utf-8") as f:
            overrides = json.load(f)
    edge_overrides: dict[str, Any] = overrides.get("_edges", {})

    game_quests = [q for q in extracted["quests"] if is_playable_game_quest(q)]
    by_exact: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_norm: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for q in game_quests:
        by_exact[q["title"].lower().strip()].append(q)
        by_norm[normalize_title(q["title"])].append(q)
    all_titles_norm = list(by_norm.keys())

    ordered_ids = [r["id"] for r in rows]
    id_set = set(ordered_ids)

    curated: dict[str, Any] = {}
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    edge_keys: set[tuple[str, str, str]] = set()

    def add_edge(src: str, tgt: str, kind: str, label: str = "") -> None:
        if src == tgt:
            return
        if src not in graph_id_set or tgt not in graph_id_set:
            return
        eov = edge_overrides.get(f"{src}->{tgt}", {})
        final_kind = eov.get("kind", kind)
        final_label = eov.get("label", label)
        k = (src, tgt, final_kind)
        if k not in edge_keys:
            edge_keys.add(k)
            edge_obj: dict[str, Any] = {
                "id": f"{src}->{tgt}:{final_kind}",
                "source": src,
                "target": tgt,
                "kind": final_kind,
                "label": final_label,
                "exclusive": bool(eov.get("exclusive", False)),
            }
            if eov.get("condition"):
                edge_obj["condition"] = eov["condition"]
            edges.append(edge_obj)

    graph_rows = [r for r in rows if r["type"] not in EXCLUDED_GRAPH_TYPES]
    graph_id_set = {r["id"] for r in graph_rows}

    for row in graph_rows:
        qid = row["id"]
        _, gqs, _ = match_quest(row, by_exact, by_norm, all_titles_norm)
        gq = gqs[0] if gqs else None

        ov = overrides.get(qid, {})
        rewards = ov.get("rewards") if "rewards" in ov else parse_rewards(row["rewards"])
        req_text = row["req"]
        ponr = "PONR" in req_text
        repeatable = "repeatable" in req_text.lower()
        during_match = re.search(r"during:\s*([A-Z]+\d+[a-z]?)", req_text)
        during_id = during_match.group(1) if during_match else None

        unlock_refs = extract_id_refs(row["unlocks"], ordered_ids, graph_id_set)
        req_refs = extract_id_refs(req_text, ordered_ids, graph_id_set)

        curated_entry = {
            "id": qid,
            "journalId": gq["journalId"] if gq else None,
            "type": row["type"],
            "title": row["title"],
            "giver": row["giver"],
            "rewards": rewards,
            "reqText": req_text,
            "unlocksRaw": row["unlocks"],
            "ponr": ponr,
            "repeatable": repeatable,
            "during": during_id,
        }
        curated[qid] = curated_entry

        node = {
            "id": qid,
            "type": row["type"],
            "title": row["title"],
            "giver": row["giver"],
            "arc": ov.get("arc") or infer_arc(row, gq),
            "parallelGroup": ov.get("parallelGroup") or infer_parallel_group(row),
            "journalId": gq["journalId"] if gq else None,
            "journalPath": gq["journalPath"] if gq else None,
            "gameQuestType": gq["questType"] if gq else None,
            "district": (gq.get("districtID") or "").replace("Districts.", "") if gq else None,
            "rewards": rewards,
            "reqText": req_text,
            "ponr": ponr,
            "repeatable": repeatable,
            "during": during_id,
            "factsRequired": clean_facts(gq.get("factsRequired", [])) if gq else [],
        }
        nodes.append(node)

        # Build edges from Unlocks column (parse per comma-separated item so [+] only applies to its item)
        unlocks_str = row["unlocks"]
        if unlocks_str and unlocks_str != "—":
            leading_choice = unlocks_str.strip().startswith("`[!]`") or unlocks_str.strip().startswith("[!]")
            for part in unlocks_str.split(","):
                part_refs = extract_id_refs(part, ordered_ids, graph_id_set)
                if not part_refs:
                    continue
                if "[+]" in part:
                    ekind, elabel = "and", "[+]"
                elif "[!]" in part or leading_choice:
                    ekind, elabel = "choice", "[!]"
                else:
                    ekind, elabel = "unlock", ""
                for tgt in part_refs:
                    add_edge(qid, tgt, ekind, elabel)

        # Build edges from Req / Notes column (only explicit prerequisites not already covered by Unlocks)
        if during_id and during_id in graph_id_set:
            add_edge(qid, during_id, "during", "during")
        for src in req_refs:
            if src == during_id:
                continue
            if "`=`" in req_text or "=" in req_text:
                # Parallel group siblings don't need N*N edges; handled via parallelGroup
                continue
            kind = "and" if "[+]" in req_text else "choice" if "[!]" in req_text else "unlock"
            label = "[+]" if kind == "and" else "[!]" if kind == "choice" else ""
            add_edge(src, qid, kind, label)

    args.curated_out.parent.mkdir(parents=True, exist_ok=True)
    with args.curated_out.open("w", encoding="utf-8") as f:
        json.dump(curated, f, indent=2, ensure_ascii=False)

    graph_payload = {
        "meta": {
            "totalNodes": len(nodes),
            "totalEdges": len(edges),
            "excludedTypes": sorted(EXCLUDED_GRAPH_TYPES),
        },
        "nodes": nodes,
        "edges": edges,
    }
    with args.graph_out.open("w", encoding="utf-8") as f:
        json.dump(graph_payload, f, indent=2, ensure_ascii=False)

    public_graph = REPO_ROOT / "public" / "data" / "quest_graph.json"
    if public_graph.parent.exists():
        with public_graph.open("w", encoding="utf-8") as f:
            json.dump(graph_payload, f, indent=2, ensure_ascii=False)

    print(f"Wrote {args.curated_out} ({len(curated)} quests)")
    print(f"Wrote {args.graph_out} ({len(nodes)} nodes, {len(edges)} edges)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
