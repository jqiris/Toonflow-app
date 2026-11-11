from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date
from pathlib import Path
from typing import Any


DATABASE_NAME = "curated-screenplay-methods.sqlite"
MARKDOWN_CATALOG = "MD文件索引.csv"
CATALOG_NAME = "全球剧本知识库索引.csv"
FESTIVAL_CATALOG_NAME = "电影节剧本标签索引.csv"


def find_one(root: Path, filename: str, required: bool) -> Path | None:
    direct_candidates = [
        root / filename,
        root / "99-索引与检索规则" / filename,
    ]
    for candidate in direct_candidates:
        try:
            if candidate.is_file():
                return candidate.resolve()
        except OSError:
            continue

    matches: list[Path] = []
    # 仅在浅层子库目录及其 99-索引与检索规则 下查找目录级索引表，避免在包含数万张色卡或海量小说的网络盘上全盘 rglob 卡死。
    try:
        children = [entry for entry in root.iterdir() if not entry.name.startswith(".")]
    except OSError:
        children = []
    for child in children:
        try:
            if child.is_symlink() or not child.is_dir():
                continue
            for sub_candidate in (child / filename, child / "99-索引与检索规则" / filename):
                if sub_candidate.is_file():
                    matches.append(sub_candidate.resolve())
        except OSError:
            continue

    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        preview = "\n".join(f"- {path}" for path in matches[:10])
        raise RuntimeError(f"发现多个 {filename}，请直接选择正确的数据库文件：\n{preview}")
    if required:
        raise FileNotFoundError(
            f"没有在所选位置找到 {filename}。请选择包含 99-索引与检索规则 的知识库根目录，"
            "或直接选择该 SQLite 文件。"
        )
    return None


def inspect_database(database: Path) -> tuple[int, int]:
    from md_index import connect_readonly
    connection = connect_readonly(database)
    try:
        quick_check = connection.execute("PRAGMA quick_check").fetchone()
        if not quick_check or quick_check[0] != "ok":
            raise RuntimeError(f"SQLite 完整性检查失败：{quick_check}")
        documents = int(connection.execute("SELECT COUNT(*) FROM documents").fetchone()[0])
        chunks = int(connection.execute("SELECT COUNT(*) FROM chunks_content").fetchone()[0])
        return documents, chunks
    finally:
        connection.close()


def default_output() -> Path:
    parent = Path(__file__).resolve().parent.parent
    if parent.name == "film-knowledge-bridge":
        return parent / "references" / "knowledgeBase.json"
    return parent / "knowledgeBase.json"


def build_config(selected: Path) -> dict[str, Any]:
    selected = selected.expanduser().resolve()
    if not selected.exists():
        raise FileNotFoundError(f"所选路径不存在：{selected}")

    if selected.is_file() and selected.name in {"知识库索引.sqlite", "knowledgeIndex.sqlite"}:
        selected = selected.parent
    if selected.is_file() and selected.name == "md-knowledge-index.sqlite":
        selected = selected.parent.parent

    from md_index import INDEX_NAME, KIND_VERSION, SCHEMA, connect_readonly, index_metadata
    from md_search import documentKind
    indexed = index_metadata(selected) if selected.is_dir() else {}
    indexed_counts: dict[str, int] | None = None
    if indexed and indexed.get("schema") == SCHEMA and int(indexed.get("documents", 0)) > 0:
        try:
            from contextlib import closing
            with closing(connect_readonly(Path(str(indexed["index_path"])))) as conn:
                if indexed.get("kind_version") == KIND_VERSION:
                    indexed_counts = {str(row[0]): int(row[1]) for row in conn.execute("SELECT kind, COUNT(*) FROM documents GROUP BY kind")}
                else:
                    counts_tmp: dict[str, int] = {}
                    for (rel_path,) in conn.execute("SELECT path FROM documents"):
                        k = documentKind(selected / str(rel_path), selected)
                        counts_tmp[k] = counts_tmp.get(k, 0) + 1
                    indexed_counts = counts_tmp
        except (sqlite3.Error, OSError):
            indexed_counts = None

    if selected.is_dir() and indexed_counts is None:
        from md_search import markdown_files, documentKind
        available_markdown = markdown_files(selected)
    else:
        available_markdown = []

    legacy_database_present = selected.is_dir() and any(
        path.is_file() for path in (selected / DATABASE_NAME, selected / "99-索引与检索规则" / DATABASE_NAME)
    )
    if indexed or (available_markdown and not legacy_database_present) or (selected.is_dir() and (selected / MARKDOWN_CATALOG).is_file()):
        root = selected
        if indexed_counts is not None:
            novels_count = indexed_counts.get("novel", 0)
            scripts_count = indexed_counts.get("reference", 0)
            methods_count = indexed_counts.get("method", 0)
            readable = sum(indexed_counts.values())
        else:
            readable = len(available_markdown)
            if not readable:
                raise FileNotFoundError("这个资料目录中没有可读的MD剧本或方法书，请先放入资料再选择。")
            from md_search import documentKind
            kinds = [documentKind(path, root) for path in available_markdown]
            novels_count = kinds.count("novel")
            scripts_count = kinds.count("reference")
            methods_count = kinds.count("method")
        if not readable:
            raise FileNotFoundError("这个资料目录中没有可读的MD剧本或方法书，请先放入资料再选择。")
        festival_catalog = find_one(root, FESTIVAL_CATALOG_NAME, False)
        return {
            "name": "AI STUDIO 洋子本地影视知识库（MD）",
            "mode": "markdown",
            "root": str(root),
            "database": str(indexed.get("index_path", "")),
            "catalog": str(root / "knowledgeCatalog.csv") if (root / "knowledgeCatalog.csv").is_file() else str(root / MARKDOWN_CATALOG) if (root / MARKDOWN_CATALOG).is_file() else "",
            "festival_catalog": str(festival_catalog) if festival_catalog else "",
            "readable_documents": readable,
            "indexed_documents": indexed.get("indexed_documents", 0),
            "index_schema": indexed.get("schema", ""),
            "index_bytes": indexed.get("index_bytes", 0),
            "indexed_chunks": indexed.get("chunks", 0),
            "document_counts": {"novels": novels_count, "other_markdown": readable - novels_count, "scripts": scripts_count, "methods": methods_count},
            "generated_at": date.today().isoformat(),
        }

    if selected.is_file():
        if selected.name != DATABASE_NAME:
            raise ValueError(f"请选择知识库根目录或 {DATABASE_NAME}，当前文件不正确：{selected.name}")
        database = selected
        root = selected.parent.parent if selected.parent.name == "99-索引与检索规则" else selected.parent
    else:
        root = selected
        database = find_one(root, DATABASE_NAME, True)
        if database is None:
            raise FileNotFoundError(DATABASE_NAME)

    catalog = find_one(root, CATALOG_NAME, False)
    festival_catalog = find_one(root, FESTIVAL_CATALOG_NAME, False)
    documents, chunks = inspect_database(database)
    return {
        "name": "AI STUDIO 洋子本地专业知识库",
        "mode": "sqlite",
        "root": str(root),
        "database": str(database),
        "catalog": str(catalog) if catalog else "",
        "festival_catalog": str(festival_catalog) if festival_catalog else "",
        "indexed_documents": documents,
        "indexed_chunks": chunks,
        "generated_at": date.today().isoformat(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="配置 AI STUDIO 洋子本地专业知识库")
    parser.add_argument("root", help="知识库根目录，或旧版 curated-screenplay-methods.sqlite 文件")
    parser.add_argument("--output", help="knowledgeBase.json 输出位置")
    args = parser.parse_args()

    config = build_config(Path(args.root))
    output = Path(args.output).expanduser() if args.output else default_output()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print("本地知识库配置完成")
    print(f"配置文件：{output.resolve()}")
    print(f"知识库根目录：{config['root']}")
    if config.get("mode") == "markdown":
        print(f"可直接读取的 MD 文件：{config['readable_documents']}")
        print(f"单一索引文档：{config['indexed_documents']}；片段：{config['indexed_chunks']}")
        print("检索方式：索引筛选候选，再核对 MD 正文与页码锚点；无索引时回退正文扫描，不把整库塞给模型")
    else:
        print(f"正式索引文档：{config['indexed_documents']}")
        print(f"全文检索片段：{config['indexed_chunks']}")


if __name__ == "__main__":
    main()
