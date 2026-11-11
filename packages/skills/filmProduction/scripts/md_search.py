from __future__ import annotations

import csv
import hashlib
import json
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any


PAGE_MARKER = re.compile(r"<!-- 第\s*(\d+)\s*页 -->")
CHAPTER_MARKER = re.compile(r"<!-- 第\s*(\d+)\s*章 -->")
FORMAL_CATEGORY = re.compile(r"^(?:0[1-8]-|10-小说库$)")
SKIP_FOLDERS = {"待精筛", "90-隔离与待审", "正版待导入", "下载记录", "99-索引与检索规则", "00-小说库检索"}


def placeholder_reason(body: str) -> str | None:
    match = re.search(r"\|\s*提取方式\s*\|\s*(无法转换[^|\n]*|无法解码[^|\n]*|转换失败[^|\n]*|未支持[^|\n]*)\|", body[:5000])
    if match:
        return match.group(1).strip()
    method = re.search(r"\|\s*提取方式\s*\|([^|\n]+)\|", body[:5000])
    if method and "无法正确识别" in method.group(1) and "索引" in method.group(1):
        return method.group(1).strip()
    return None


def _is_reparse_or_link(entry: os.DirEntry[str]) -> bool:
    try:
        if entry.is_symlink():
            return True
        is_junc = getattr(entry, "is_junction", None)
        if callable(is_junc) and is_junc():
            return True
    except OSError:
        return True
    return False


def markdown_files(root: Path, include_novels: bool = True) -> list[Path]:
    files: list[Path] = []
    root = root.resolve()
    visited_dirs: set[Path] = set()

    def scan_dir(current: Path, is_root: bool = False) -> None:
        try:
            real_current = current.resolve()
        except OSError:
            return
        if not real_current.is_relative_to(root) or real_current in visited_dirs:
            return
        visited_dirs.add(real_current)
        try:
            with os.scandir(current) as it:
                entries = list(it)
        except OSError:
            return
        entry_names = {entry.name for entry in entries}
        if not is_root and ("色卡主文档.md" in entry_names or "SKILL.md" in entry_names):
            return
        subdirs: list[Path] = []
        for entry in entries:
            name = entry.name
            if name.startswith("."):
                continue
            try:
                if _is_reparse_or_link(entry):
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if name in {"node_modules", "__pycache__"} or any(marker in name for marker in SKIP_FOLDERS):
                        continue
                    if not include_novels and (name == "10-小说库" or re.fullmatch(r"(?:10-小说库|novels?)", name, re.I)):
                        continue
                    sub_path = Path(entry.path)
                    sub_real = sub_path.resolve()
                    if not sub_real.is_relative_to(root) or sub_real in visited_dirs:
                        continue
                    subdirs.append(sub_path)
                elif entry.is_file(follow_symlinks=False):
                    if is_root and name.casefold() == "readme.md":
                        continue
                    if name.casefold() == "skill.md":
                        continue
                    if name.lower().endswith(".md"):
                        file_path = Path(entry.path)
                        if file_path.resolve().is_relative_to(root):
                            files.append(file_path)
            except OSError:
                continue
        for sub in subdirs:
            scan_dir(sub, False)

    scan_dir(root, True)
    return sorted(files, key=lambda path: str(path).casefold())


def documentKind(path: Path, root: Path) -> str:
    parts = path.relative_to(root).parts
    parents = '/'.join(parts[:-1])
    if any(part == '10-小说库' for part in parts[:-1]) or re.search(r'(?:^|/)(?:10-小说库|小说|novels?)(?:/|$)', parents, re.I):
        return 'novel'
    if any(part.startswith('08-') for part in parts[:-1]) or re.search(r'方法|教程|手册|methods?|guides?', parents, re.I) or re.search(r'方法书|方法论|编剧(?:方法|备忘录|指南)|写作指南|故事结构|电影剧本的结构', path.stem):
        return 'method'
    return 'reference'


def selected_files(files: list[Path], selections: list[str], root: Path | None = None,
                   relocated: dict[str, str] | None = None) -> set[Path] | None:
    if not selections:
        return None
    selected: set[Path] = set()
    for selection in selections:
        normalized = selection.replace("\\", "/").casefold()
        source_stem = Path(normalized).stem
        exact = [path for path in files
                 if str(path).replace("\\", "/").casefold() == normalized
                 or (root is not None and path.relative_to(root).as_posix().casefold() == normalized)]
        if not exact and root is not None:
            from md_index import index_metadata
            aliases = json.loads(index_metadata(root).get("path_aliases", "[]"))
            for alias in aliases:
                old = str(alias["source"]).replace("\\", "/")
                if normalized not in {old.casefold(), (root / old).as_posix().casefold()}:
                    continue
                target = (root / alias["destination"]).resolve()
                if target in files and hashlib.sha256(target.read_bytes()).hexdigest().casefold() == str(alias["sha256"]).casefold():
                    exact = [target]
                    if relocated is not None:
                        relocated[str(target)] = selection
                    break
        if not exact and (Path(normalized).suffix != ".md" or Path(normalized).is_absolute() or "/" in normalized):
            raise ValueError(f"选定来源不是当前库内的有效 MD 路径，请重新定位该来源，不能用同名文件替代：{selection}")
        matches = exact or [path for path in files if path.stem.casefold() == source_stem]
        if len(matches) != 1:
            raise ValueError(f"选定文件未找到或存在同名文件，请提供完整 MD 路径：{selection}")
        selected.add(matches[0])
    return selected


def festival_stems(config: dict[str, Any], festival: str) -> set[str]:
    catalog = Path(str(config.get("festival_catalog", "")))
    if not catalog.is_file():
        from md_index import index_metadata
        labels = json.loads(index_metadata(Path(str(config.get("root", "")))).get("festival_labels", "[]"))
        return {item["stem"] for item in labels if item["festival"] == festival and item["stem"]}
    with catalog.open("r", encoding="utf-8-sig", newline="") as handle:
        return {
            Path(row["本地完整路径"].replace("\\", "/")).stem.casefold()
            for row in csv.DictReader(handle)
            if row.get("电影节") == festival and row.get("本地完整路径")
        }


def first_evidence(body: str, terms: list[str], mode: str) -> tuple[int | None, int, str, int | None] | None:
    lowered = body.casefold()
    positions = [lowered.find(term.casefold()) for term in terms]
    if mode == "all" and any(position < 0 for position in positions):
        return None
    found = [position for position in positions if position >= 0]
    if not found:
        return None
    # 选择能覆盖更多查询词的真实正文窗口，避免最早的偶然用词垄断证据。
    position = max(found, key=lambda start: (sum(term.casefold() in lowered[max(0, start - 80):start + 500] for term in terms), -start))
    marker_position = body.rfind("<!-- 第", 0, position)
    marker = PAGE_MARKER.match(body, marker_position) if marker_position >= 0 else None
    page = int(marker.group(1)) if marker else None
    chapter_marker = CHAPTER_MARKER.match(body, marker_position) if marker_position >= 0 else None
    chapter = int(chapter_marker.group(1)) if chapter_marker else None
    start = max(position - 80, 0)
    snippet = " ".join(body[start : position + 180].split())
    if start:
        snippet = "…" + snippet
    chunk = max(1, (position - marker_position) // 1400 + 1) if marker_position >= 0 else position // 1400 + 1
    return page, chunk, snippet, chapter


def retrieve_markdown(config: dict[str, Any], profile: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    root = Path(str(config.get("root", ""))).expanduser()
    if not root.is_dir():
        raise FileNotFoundError(f"MD 知识库目录不存在：{root}")
    queries = profile.get("queries")
    if not isinstance(queries, list) or not queries:
        raise ValueError("检索画像必须包含非空 queries 数组。")
    raw_selections = [str(item) for item in profile.get("selected_documents", [])]
    need_novels = bool(
        raw_selections
        or profile.get("include_novels", False)
        or any(
            "novel" in str(q.get("lane", "")).casefold()
            or "小说" in str(q.get("lane", ""))
            or str(q.get("source_kind", "")) == "novel"
            or "10-小说库" in str(q.get("path_contains", ""))
            for q in queries
        )
    )
    files = markdown_files(root, include_novels=need_novels)
    if not files and not need_novels:
        files = markdown_files(root, include_novels=True)
    if not files:
        raise FileNotFoundError("没有找到正式分类中的 MD 文件，请确认已解压知识库。")
    relocated: dict[str, str] = {}
    selected = selected_files(files, raw_selections, root, relocated)
    if selected is None:
        from md_index import candidate_documents
        indexed_candidates = candidate_documents(root, queries, files)
    else:
        indexed_candidates = [None for _ in queries]
    lane_hits: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    prepared = []
    for query_number, query in enumerate(queries):
        terms = str(query.get("text", "")).split()
        if not terms:
            raise ValueError("检索词不能为空。")
        lane = str(query.get("lane", "reference"))
        novel_lane = "novel" in lane.casefold() or "小说" in lane
        include = query.get("path_contains", [])
        include = [str(value).replace("\\", "/") for value in (include if isinstance(include, list) else [include]) if value]
        sourceKind = str(query.get('source_kind', ''))
        if selected is None and not include and not sourceKind:
            sourceKind = 'method' if lane == 'method' or '方法' in lane else 'novel' if novel_lane else ''
        exclude = query.get("path_excludes", [])
        exclude = [str(value).replace("\\", "/") for value in (exclude if isinstance(exclude, list) else [exclude]) if value]
        if selected is None and not novel_lane and not profile.get("include_novels", False) and not any("10-小说库" in value for value in include):
            exclude.append("10-小说库")
        if (lane == "method" or "方法" in lane) and not query.get("include_journals", False):
            exclude.append("影视研究期刊")
        festival = str(query.get("festival", "")).strip()
        prepared.append((query, lane, terms, include, exclude, festival_stems(config, festival) if festival else None, indexed_candidates[query_number], sourceKind))
    for path in files:
        if selected is not None and path not in selected:
            continue
        normalized_path = str(path).replace("\\", "/").casefold()
        kind = documentKind(path, root)
        relevant = [
            (query, lane, terms)
            for query, lane, terms, include, exclude, festival, candidates, sourceKind in prepared
            if (not include or any(value.casefold() in normalized_path for value in include))
            and (not sourceKind or kind == sourceKind)
            and (selected is not None or kind != 'novel' or profile.get('include_novels', False) or 'novel' in lane.casefold() or '小说' in lane)
            and not any(value.casefold() in normalized_path for value in exclude)
            and (festival is None or path.stem.casefold() in festival)
            and (candidates is None or path.relative_to(root).as_posix() in candidates)
        ]
        if not relevant:
            continue
        try:
            body = path.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError) as error:
            if selected is not None:
                raise ValueError(f"指定来源不可读取，不能声称已精读：{path}") from error
            continue
        invalid = placeholder_reason(body)
        if invalid:
            if selected is not None:
                raise ValueError(f"指定文件只有占位说明，不能当作原作或剧本正文：{path}；{invalid}")
            continue
        first_page = body.find("<!-- 第")
        if first_page >= 0:
            body = body[first_page:]
        for query, lane, terms in relevant:
            required_terms = [str(term).casefold() for term in query.get("required_any", []) if str(term).strip()]
            if required_terms and not any(term in (path.stem + "\n" + body).casefold() for term in required_terms):
                continue
            mode = str(query.get("mode", "any"))
            evidence = first_evidence(body, terms, mode)
            if evidence is None:
                continue
            page, chunk, snippet, chapter = evidence
            title_matches = sum(term.casefold() in path.stem.casefold() for term in terms)
            # 全文的持续相关性参与排序；短窗口仍只作为来源证据返回。
            lowered_body = body.casefold()
            text_matches = sum((1 if term.casefold() in lowered_body else 0) + 0.2 * min(lowered_body.count(term.casefold()), 2) for term in terms)
            weight = float(query.get("weight", 1.0))
            item = lane_hits[lane].setdefault(str(path), {
                "name": path.name, "path": str(path), "stored_path": str(path),
                "source_exists": True, "page": page, "chunk": chunk, "chapter": chapter,
                "document_kind": kind,
                "snippet": snippet, "score": 0.0, "queries": [], "evidence": [],
            })
            # 长篇合集、辞典不能仅因篇幅大而挤掉更贴近当前任务的原稿。
            item["score"] += weight * (text_matches + 6 * title_matches) / (10 * (1 + len(body) / 400000))
            if str(path) in relocated:
                item["relocated_from"] = relocated[str(path)]
            item["queries"].append(str(query["text"]))
            item["evidence"].append({"query": str(query["text"]), "page": page, "chapter": chapter, "chunk": chunk, "snippet": snippet})
    limits = profile.get("lane_limits", {})
    result: dict[str, list[dict[str, Any]]] = {}
    for lane, hits in lane_hits.items():
        ranked = sorted(hits.values(), key=lambda item: (-item["score"], item["name"]))
        for item in ranked:
            item["score"] = round(item["score"], 6)
            item["queries"] = list(dict.fromkeys(item["queries"]))
        result[lane] = ranked[: int(limits.get(lane, 5))]
    for _, lane, _, _, _, _, _, _ in prepared:
        result.setdefault(lane, [])
    return result
