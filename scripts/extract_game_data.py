#!/usr/bin/env python3
"""
Extract Cyberpunk 2077 + Phantom Liberty quest metadata, localization, and
prerequisite/fact graphs from game archives using WolvenKit CLI (cp77tools.exe).

Outputs: data/extracted_quests.json
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_GAME_DIR = Path(r"E:\Cyberpunk 2077")
DEFAULT_WORK_DIR = REPO_ROOT / "extracted_raw"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "extracted_quests.json"


def find_cp77tools(explicit: str | None) -> Path:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit))
    which = shutil.which("cp77tools") or shutil.which("cp77tools.exe")
    if which:
        candidates.append(Path(which))
    candidates.append(Path.home() / ".dotnet" / "tools" / "cp77tools.exe")
    # Fallback: check Antigravity scratch if present
    scratch_glob = Path.home() / ".gemini" / "antigravity" / "brain"
    if scratch_glob.exists():
        for p in scratch_glob.glob("*/scratch/wkit/cp77tools.exe"):
            candidates.append(p)

    for c in candidates:
        if c.exists():
            return c
    raise FileNotFoundError(
        "Could not find cp77tools.exe. Install via `dotnet tool install -g wolvenkit.cli` "
        "or pass --cp77tools <path>."
    )


def run_cmd(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    res = subprocess.run(cmd, check=False)
    if res.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {res.returncode}: {' '.join(cmd)}")


def unbundle_archives(cp77tools: Path, game_dir: Path, work_dir: Path) -> None:
    work_dir.mkdir(parents=True, exist_ok=True)
    archives = [
        (game_dir / "archive" / "pc" / "content" / "basegame_4_gamedata.archive", r"\.(journal|quest|questphase)$", True),
        (game_dir / "archive" / "pc" / "ep1" / "ep1_2_gamedata.archive", r"\.(journal|quest|questphase)$", True),
        (game_dir / "archive" / "pc" / "content" / "lang_en_text.archive", r"onscreens.*\.json$", False),
        (game_dir / "archive" / "pc" / "ep1" / "lang_en_text.archive", r"onscreens.*\.json$", False),
    ]
    for arc, regex, use_gp in archives:
        if not arc.exists():
            print(f"[warn] Archive not found, skipping: {arc}")
            continue
        cmd = [str(cp77tools), "unbundle", str(arc), "-o", str(work_dir), "-r", regex]
        if use_gp:
            cmd.extend(["-gp", str(game_dir)])
        run_cmd(cmd)


def convert_to_json(cp77tools: Path, work_dir: Path, force: bool = False) -> None:
    # Convert journals and onscreens_final.json
    single_targets = [
        work_dir / "base" / "journal" / "cooked_journal.journal",
        work_dir / "ep1" / "journal" / "cooked_journal.journal",
        work_dir / "base" / "localization" / "en-us" / "onscreens" / "onscreens_final.json",
        work_dir / "ep1" / "localization" / "en-us" / "onscreens" / "onscreens_final.json",
    ]
    for t in single_targets:
        if not t.exists():
            continue
        out_json = Path(str(t) + ".json")
        if force or not out_json.exists():
            run_cmd([str(cp77tools), "convert", "s", str(t)])

    # Bulk convert quest and open_world directories
    dir_targets = [
        work_dir / "base" / "quest",
        work_dir / "base" / "open_world",
        work_dir / "ep1" / "quest",
        work_dir / "ep1" / "openworld",
    ]
    for d in dir_targets:
        if not d.exists():
            continue
        if not force:
            # Skip directory if all .questphase files already have .questphase.json
            pending = [
                f for f in d.rglob("*.questphase")
                if not Path(str(f) + ".json").exists()
            ]
            if not pending:
                print(f"[skip] Already converted: {d}")
                continue
        run_cmd([str(cp77tools), "convert", "s", str(d)])


def load_localization(work_dir: Path) -> dict[str, str]:
    loc: dict[str, str] = {}
    for rel in [
        Path("base/localization/en-us/onscreens/onscreens_final.json.json"),
        Path("ep1/localization/en-us/onscreens/onscreens_final.json.json"),
    ]:
        p = work_dir / rel
        if not p.exists():
            continue
        with p.open("r", encoding="utf-8") as f:
            data = json.load(f)
        entries = data["Data"]["RootChunk"]["root"]["Data"]["entries"]
        for e in entries:
            key = str(e.get("primaryKey", ""))
            val = e.get("femaleVariant") or e.get("maleVariant") or ""
            if key:
                loc[key] = val
    return loc


def resolve_loc(val: Any, loc: dict[str, str]) -> str:
    if isinstance(val, dict):
        raw = val.get("$value") or val.get("value") or ""
    else:
        raw = str(val or "")
    if raw.startswith("LocKey#"):
        key = raw.split("#", 1)[1]
        return loc.get(key, raw)
    return raw


def walk_journal_quests(node: Any, path: str, source: str, loc: dict[str, str], out: list[dict[str, Any]]) -> None:
    if not isinstance(node, dict):
        return
    ntype = node.get("$type", "")
    nid = node.get("id", "")
    cur_path = f"{path}/{nid}" if path else nid

    if ntype == "gameJournalQuest":
        # Collect child phase/objective IDs for reference
        phases = []
        for ch in node.get("entries", []):
            cd = ch.get("Data", ch) if isinstance(ch, dict) else {}
            if isinstance(cd, dict) and cd.get("id"):
                phases.append(cd["id"])

        out.append({
            "journalId": nid,
            "journalPath": cur_path,
            "source": source,
            "questType": node.get("type"),
            "title": resolve_loc(node.get("title"), loc),
            "districtID": node.get("districtID"),
            "isVersionTracking": "game_version_tracking" in cur_path,
            "journalPhases": phases,
        })

    for ch in node.get("entries", []):
        cd = ch.get("Data", ch) if isinstance(ch, dict) else ch
        walk_journal_quests(cd, cur_path, source, loc, out)


def load_journal_quests(work_dir: Path, loc: dict[str, str]) -> list[dict[str, Any]]:
    quests: list[dict[str, Any]] = []
    for source, rel in [
        ("base", Path("base/journal/cooked_journal.journal.json")),
        ("ep1", Path("ep1/journal/cooked_journal.journal.json")),
    ]:
        p = work_dir / rel
        if not p.exists():
            continue
        with p.open("r", encoding="utf-8") as f:
            data = json.load(f)
        root = data["Data"]["RootChunk"]["entry"]["Data"]
        walk_journal_quests(root, "", source, loc, quests)
    return quests


def extract_condition(cond_obj: Any) -> list[dict[str, Any]]:
    """Recursively extract fact and journal conditions from a quest condition Data dict."""
    if not isinstance(cond_obj, dict):
        return []
    cd = cond_obj.get("Data", cond_obj)
    if not isinstance(cd, dict):
        return []
    ctype = cd.get("$type", "")
    results: list[dict[str, Any]] = []

    if ctype == "questFactsDBCondition":
        ft = (cd.get("type") or {}).get("Data") or {}
        if isinstance(ft, dict) and ft.get("factName"):
            results.append({
                "kind": "fact",
                "factName": ft.get("factName"),
                "comparison": ft.get("comparisonType"),
                "value": ft.get("value"),
            })
    elif ctype == "questJournalCondition":
        jt = (cd.get("type") or {}).get("Data") or {}
        if isinstance(jt, dict):
            path_obj = (jt.get("path") or {}).get("Data") or {}
            jpath = path_obj.get("realPath") or path_obj.get("className") if isinstance(path_obj, dict) else None
            results.append({
                "kind": "journal",
                "journalPath": jpath,
                "state": jt.get("state"),
            })
    elif ctype == "questLogicalCondition":
        op = cd.get("operation", "AND")
        for sub_key in ("conditions",):
            for sub in cd.get(sub_key, []):
                for r in extract_condition(sub):
                    r["logicalOp"] = op
                    results.append(r)
        # Some logical conditions use condition1 / condition2
        for sub_key in ("condition1", "condition2"):
            if cd.get(sub_key):
                for r in extract_condition(cd[sub_key]):
                    r["logicalOp"] = op
                    results.append(r)
    return results


def parse_graph_nodes(graph_data: dict[str, Any], info: dict[str, Any]) -> None:
    if not isinstance(graph_data, dict):
        return
    for node in graph_data.get("nodes", []):
        nd = node.get("Data", node) if isinstance(node, dict) else {}
        if not isinstance(nd, dict):
            continue
        ntype = nd.get("$type", "")

        if ntype == "questPhaseNodeDefinition":
            dp = (nd.get("phaseResource") or {}).get("DepotPath") or {}
            val = dp.get("$value") if isinstance(dp, dict) else dp
            if val and val != "0":
                info["subphases"].add(str(val).replace("\\", "/"))
            pg = nd.get("phaseGraph")
            if isinstance(pg, dict) and isinstance(pg.get("Data"), dict):
                parse_graph_nodes(pg["Data"], info)

        elif ntype in ("questConditionNodeDefinition", "questPauseConditionNodeDefinition"):
            for c in extract_condition(nd.get("condition")):
                if c["kind"] == "fact":
                    info["factsRequired"].append(c)
                elif c["kind"] == "journal":
                    info["journalConditions"].append(c)

        elif ntype == "questFactsDBManagerNodeDefinition":
            ft = (nd.get("type") or {}).get("Data") or {}
            if isinstance(ft, dict) and ft.get("factName"):
                info["factsSet"].append({
                    "factName": ft.get("factName"),
                    "value": ft.get("value"),
                    "op": ft.get("$type"),
                })

        elif ntype == "questJournalNodeDefinition":
            path_obj = (nd.get("path") or {}).get("Data") or {}
            if isinstance(path_obj, dict):
                jpath = path_obj.get("realPath")
                if jpath:
                    info["journalRefs"].add(jpath)


def parse_all_questphases(work_dir: Path) -> dict[str, dict[str, Any]]:
    phases: dict[str, dict[str, Any]] = {}
    search_dirs = [
        work_dir / "base" / "quest",
        work_dir / "base" / "open_world",
        work_dir / "ep1" / "quest",
        work_dir / "ep1" / "openworld",
    ]
    for sdir in search_dirs:
        if not sdir.exists():
            continue
        for jf in sdir.rglob("*.questphase.json"):
            rel = jf.relative_to(work_dir).as_posix()
            rel_no_json = rel[:-5]  # strip trailing .json
            try:
                with jf.open("r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as exc:
                print(f"[warn] Failed to parse {jf}: {exc}")
                continue
            graph = data.get("Data", {}).get("RootChunk", {}).get("graph", {}).get("Data", {})
            info: dict[str, Any] = {
                "subphases": set(),
                "factsRequired": [],
                "journalConditions": [],
                "factsSet": [],
                "journalRefs": set(),
            }
            parse_graph_nodes(graph, info)
            info["subphases"] = sorted(info["subphases"])
            info["journalRefs"] = sorted(info["journalRefs"])
            phases[rel_no_json] = info
    return phases


def link_quests_to_phases(
    quests: list[dict[str, Any]],
    phases: dict[str, dict[str, Any]],
) -> None:
    # Build reverse index: journalPath prefix -> phase files
    # A questJournalNodeDefinition path looks like "quests/main_quest/prologue/q001_scavenger/01_call_jackie"
    # while gameJournalQuest.journalPath is "quests/main_quest/prologue/q001_scavenger"
    quest_by_path = {q["journalPath"]: q for q in quests}

    # Pre-initialize
    for q in quests:
        q["phaseFiles"] = []
        q["factsRequired"] = []
        q["factsSet"] = []
        q["journalConditions"] = []

    # Map each phase file to any quest whose journalPath is a prefix of a journalRef in that phase,
    # OR whose journalId appears as a path segment in the phase filename.
    phase_to_quests: dict[str, set[str]] = defaultdict(set)
    for phase_path, pinfo in phases.items():
        for jref in pinfo["journalRefs"]:
            # Match longest journalPath prefix
            parts = jref.split("/")
            for i in range(len(parts), 0, -1):
                candidate = "/".join(parts[:i])
                if candidate in quest_by_path:
                    phase_to_quests[phase_path].add(candidate)
                    break

    # Also match by folder/filename containing quest journalId (e.g. /q301_ or /sq027/)
    for q in quests:
        qid = q["journalId"]
        jpath = q["journalPath"]
        if not qid or q["isVersionTracking"]:
            continue
        token = f"/{qid}/"
        token_file = f"/{qid}."
        for phase_path in phases:
            if token in phase_path or phase_path.endswith(token_file[:-1] + ".questphase"):
                phase_to_quests[phase_path].add(jpath)

    # Aggregate facts & conditions onto each quest (deduplicated)
    for phase_path, jpaths in phase_to_quests.items():
        pinfo = phases[phase_path]
        for jpath in jpaths:
            q = quest_by_path[jpath]
            q["phaseFiles"].append(phase_path)
            q["factsRequired"].extend(pinfo["factsRequired"])
            q["factsSet"].extend(pinfo["factsSet"])
            q["journalConditions"].extend(pinfo["journalConditions"])

    for q in quests:
        q["phaseFiles"] = sorted(set(q["phaseFiles"]))
        q["factsRequired"] = _dedup_dicts(q["factsRequired"])
        q["factsSet"] = _dedup_dicts(q["factsSet"])
        q["journalConditions"] = _dedup_dicts(q["journalConditions"])


def _dedup_dicts(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for item in items:
        key = json.dumps(item, sort_keys=True)
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract CP2077 quest data from game archives.")
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--work-dir", type=Path, default=DEFAULT_WORK_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--cp77tools", type=str, default=None)
    parser.add_argument("--skip-unbundle", action="store_true")
    parser.add_argument("--skip-convert", action="store_true")
    parser.add_argument("--force-convert", action="store_true")
    args = parser.parse_args()

    if not args.skip_unbundle or not args.skip_convert:
        cp77tools = find_cp77tools(args.cp77tools)
        print(f"Using cp77tools: {cp77tools}")
        if not args.skip_unbundle:
            unbundle_archives(cp77tools, args.game_dir, args.work_dir)
        if not args.skip_convert:
            convert_to_json(cp77tools, args.work_dir, force=args.force_convert)

    print("Loading localization...")
    loc = load_localization(args.work_dir)
    print(f"  Loaded {len(loc)} localization keys")

    print("Parsing cooked_journal.journal.json...")
    quests = load_journal_quests(args.work_dir, loc)
    print(f"  Found {len(quests)} gameJournalQuest entries")

    print("Parsing .questphase.json files...")
    phases = parse_all_questphases(args.work_dir)
    print(f"  Parsed {len(phases)} questphase files")

    print("Linking quests to questphases...")
    link_quests_to_phases(quests, phases)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "gameDir": str(args.game_dir),
            "totalJournalQuests": len(quests),
            "totalQuestPhasesParsed": len(phases),
            "localizationKeys": len(loc),
        },
        "quests": quests,
        "phases": phases,
    }
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"Wrote {args.output} ({args.output.stat().st_size / 1024 / 1024:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
