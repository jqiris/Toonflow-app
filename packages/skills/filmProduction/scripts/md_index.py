from __future__ import annotations

import argparse
from contextlib import closing
import csv
import hashlib
import json
import os
import sqlite3
import time
from pathlib import Path

INDEX_NAME = "knowledgeIndex.sqlite"
SCHEMA = "aistudio-md-2"
KIND_VERSION = "2"
legacyIndexName = "知识库索引.sqlite"


def connect_readonly(path: Path) -> sqlite3.Connection:
    uri = path.resolve().as_uri()
    try:
        conn = sqlite3.connect(uri + "?mode=ro", uri=True, timeout=3)
        conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone()
        return conn
    except sqlite3.OperationalError:
        return sqlite3.connect(uri + "?mode=ro&nolock=1", uri=True, timeout=3)


def supports_trigram() -> bool:
    # Keep the existing public function name for older launcher callers.
    try:
        with closing(sqlite3.connect(":memory:")) as connection:
            connection.execute("CREATE VIRTUAL TABLE probe USING fts5(terms,content='',contentless_delete=1,detail='none')")
        return True
    except sqlite3.Error:
        return False


def index_metadata(root: Path) -> dict:
    for name in (INDEX_NAME, legacyIndexName):
        path = root / name
        if not path.is_file():
            continue
        try:
            with closing(connect_readonly(path)) as connection:
                metadata = dict(connection.execute("SELECT key,value FROM metadata"))
                if metadata.get("schema") not in (SCHEMA, "aistudio-md-1"):
                    continue
                metadata["documents"] = connection.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
                compact = metadata["schema"] == SCHEMA
                metadata["indexed_documents"] = connection.execute("SELECT COUNT(*) FROM documents WHERE indexed=1").fetchone()[0] if compact else metadata["documents"]
                metadata["chunks"] = 0 if compact else connection.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
                metadata["index_path"] = str(path)
                metadata["index_bytes"] = path.stat().st_size
                return metadata
        except (sqlite3.Error, OSError):
            continue
    return {}


def compactTerms(text: str) -> str:
    body = text.casefold()
    # Document-level two-character postings retain short Chinese queries. Exact
    # evidence is always verified from the original MD, never from token matches.
    grams = set(zip(body, body[1:]))
    return " ".join(f"g{ord(a):06x}{ord(b):06x}" for a, b in grams)


def isProcessRunning(pid: int) -> bool:
    if pid <= 0:
        raise ValueError('无效的索引锁进程')
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
    # Windows may keep an exited PID addressable while its parent still owns a
    # process handle. os.kill(pid, 0) alone would leave cancelled builds locked.
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000,False,pid)
    if not handle:
        if ctypes.get_last_error() == 87:
            return False
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        code = wintypes.DWORD()
        if not kernel.GetExitCodeProcess(handle,ctypes.byref(code)):
            raise ctypes.WinError(ctypes.get_last_error())
        return code.value == 259
    finally:
        kernel.CloseHandle(handle)


def stat_relation(prev_size: int, prev_ns: int, stat: os.stat_result) -> str:
    if prev_size != stat.st_size:
        return "different"
    if prev_ns == stat.st_mtime_ns:
        return "exact"
    if (prev_ns % 1_000_000_000 == 0 or stat.st_mtime_ns % 1_000_000_000 == 0) and (
        prev_ns // 1_000_000_000 == stat.st_mtime_ns // 1_000_000_000
    ):
        return "ambiguous"
    return "different"


def same_file_stat(prev_size: int, prev_ns: int, stat: os.stat_result) -> bool:
    return stat_relation(prev_size, prev_ns, stat) == "exact"


def candidate_documents(root: Path, queries: list[dict], files: list[Path]) -> list[set[str] | None]:
    fallback = [None for _ in queries]
    metadata = index_metadata(root)
    if not metadata:
        return fallback
    try:
        with closing(connect_readonly(Path(metadata["index_path"]))) as connection:
            compact = metadata["schema"] == SCHEMA
            registered = {row[0]: row[1:] for row in connection.execute("SELECT path,size,modified_ns" + (",indexed" if compact else "") + " FROM documents")}
            changed = set()
            for source in files:
                relative = source.relative_to(root).as_posix()
                stat = source.stat()
                previous = registered.get(relative)
                if previous is None or not same_file_stat(previous[0], previous[1], stat) or compact and not previous[2]:
                    changed.add(relative)
            results = []
            for query in queries:
                terms = str(query.get("text", "")).split()
                strong = [term.casefold() for term in terms if len(term) >= (2 if compact else 3)]
                if not strong or str(query.get("mode", "any")) != "all" and len(strong) != len(terms):
                    results.append(None)
                    continue
                expressions = []
                for term in strong:
                    if compact:
                        tokens = compactTerms(term).split()
                    else:
                        tokens = list(dict.fromkeys(term[i:i + 3] for i in range(len(term) - 2)))
                    expressions.append("(" + " AND ".join('"' + token.replace('"', '""') + '"' for token in tokens) + ")")
                sets = []
                for expression in expressions:
                    sql = "SELECT d.path FROM search JOIN documents d ON d.id=search.rowid WHERE search MATCH ?" if compact else "SELECT DISTINCT d.path FROM search JOIN chunks c ON c.id=search.rowid JOIN documents d ON d.id=c.document_id WHERE search MATCH ?"
                    sets.append({row[0] for row in connection.execute(sql, (expression,))})
                matched = set.intersection(*sets) if str(query.get("mode", "any")) == "all" else set.union(*sets)
                results.append(matched | changed)
            return results
    except (sqlite3.Error, OSError):
        return fallback


def build(root: Path, incremental: bool = True, verify_full: bool = False, includeNovels: bool = False, includeJournals: bool = False) -> dict:
    from md_search import markdown_files, placeholder_reason, documentKind
    root = root.expanduser().resolve()
    files = markdown_files(root)
    if not files:
        raise ValueError("资料目录没有MD原文。")
    if not supports_trigram():
        raise RuntimeError("需要支持FTS5 contentless_delete的SQLite；原文和旧索引保留，请更新本地运行组件。")
    lock = root / "knowledgeIndex.lock"
    if lock.exists():
        try:
            previousPid = int(lock.read_text(encoding="utf-8"))
            if not isProcessRunning(previousPid) and lock.read_text(encoding="utf-8") == str(previousPid):
                lock.unlink()
        except (ValueError, OSError):
            pass
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.write(descriptor, str(os.getpid()).encode()); os.close(descriptor)
    started = time.perf_counter()
    target = root / INDEX_NAME
    output = target if target.exists() else root / "knowledgeIndex.building.sqlite"
    connection = None
    try:
        previousMetadata = index_metadata(root)
        connection = sqlite3.connect(output, timeout=10)
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute("PRAGMA cache_size=-32000")
        existing = connection.execute("SELECT 1 FROM sqlite_master WHERE name='metadata'").fetchone()
        if not existing:
            connection.executescript("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE documents(id INTEGER PRIMARY KEY,path TEXT UNIQUE,title TEXT,category TEXT,kind TEXT,size INTEGER,modified_ns INTEGER,sha256 TEXT,indexed INTEGER NOT NULL DEFAULT 0);CREATE INDEX document_kind ON documents(kind);CREATE TABLE excluded_sources(path TEXT PRIMARY KEY,reason TEXT);CREATE VIRTUAL TABLE search USING fts5(terms,content='',contentless_delete=1,detail='none');")
            connection.execute("INSERT INTO metadata VALUES('schema',?)", (SCHEMA,))
            connection.execute("INSERT INTO metadata VALUES('kind_version',?)", (KIND_VERSION,))
            for key in ("festival_labels", "path_aliases", "cleanup_summary"):
                if previousMetadata.get(key):
                    connection.execute("INSERT INTO metadata VALUES(?,?)", (key, previousMetadata[key]))
            connection.commit()
        else:
            current_meta = dict(connection.execute("SELECT key,value FROM metadata"))
            if current_meta.get("schema") != SCHEMA:
                raise RuntimeError("轻量索引格式不匹配，未覆盖现有文件。")
            if current_meta.get("kind_version") != KIND_VERSION:
                with connection:
                    for doc_id, rel_path, old_kind, old_indexed in connection.execute("SELECT id,path,kind,indexed FROM documents").fetchall():
                        new_kind = documentKind(root / rel_path, root)
                        new_eligible = (new_kind != "novel" or includeNovels) and ("影视研究期刊" not in rel_path or includeJournals)
                        if new_kind != old_kind or (old_indexed and not new_eligible):
                            if old_indexed and not new_eligible:
                                connection.execute("DELETE FROM search WHERE rowid=?", (doc_id,))
                                connection.execute("UPDATE documents SET kind=?,indexed=0,sha256='' WHERE id=?", (new_kind, doc_id))
                            else:
                                connection.execute("UPDATE documents SET kind=? WHERE id=?", (new_kind, doc_id))
                    connection.execute("INSERT OR REPLACE INTO metadata VALUES('kind_version',?)", (KIND_VERSION,))
        old = {row[1]: row for row in connection.execute("SELECT id,path,size,modified_ns,sha256,indexed,kind FROM documents")}
        excluded = {row[0]: row[1] for row in connection.execute("SELECT path,reason FROM excluded_sources")}
        seen = set(); updated = 0; unchanged = 0; removed = 0
        for position, source in enumerate(files, 1):
            relative = source.relative_to(root).as_posix(); seen.add(relative)
            try:
                stat = source.stat()
            except OSError:
                continue
            previous = old.get(relative); kind = documentKind(source, root)
            eligible = (kind != "novel" or includeNovels) and ("影视研究期刊" not in relative or includeJournals)
            rel_state = stat_relation(previous[2], previous[3], stat) if previous and previous[6] == kind else "different"
            is_permanent_excluded = relative in excluded and not str(excluded[relative]).startswith("临时读取异常：")
            if rel_state == "exact" and (not eligible or previous[5] or is_permanent_excluded):
                unchanged += 1
            elif rel_state == "ambiguous" and previous and previous[4] and (not eligible or previous[5]):
                try:
                    raw_bytes = source.read_bytes()
                except OSError:
                    # 临时 I/O 失败保留旧有效索引，下次自动重试，不入 excluded_sources
                    continue
                current_digest = hashlib.sha256(raw_bytes).hexdigest()
                if current_digest == previous[4]:
                    with connection:
                        connection.execute("UPDATE documents SET modified_ns=? WHERE id=?", (stat.st_mtime_ns, previous[0]))
                    unchanged += 1
                else:
                    rel_state = "different"
            if rel_state not in ("exact", "ambiguous") or not (not eligible or (previous and previous[5]) or (rel_state == "exact" and is_permanent_excluded)):
                body = None
                invalid = None
                raw_bytes: bytes | None = None
                if eligible:
                    try:
                        raw_bytes = source.read_bytes()
                    except OSError:
                        # 临时 I/O 异常：保留旧有效索引，不标记为永久坏源，下次可重试
                        continue
                    try:
                        body = raw_bytes.decode("utf-8-sig")
                        invalid = placeholder_reason(body)
                        if not invalid and not body.strip():
                            invalid = "空文件"
                    except UnicodeError as error:
                        invalid = f"编码异常：{type(error).__name__}"
                indexed = int(eligible and not invalid)
                digest = hashlib.sha256(raw_bytes).hexdigest() if (indexed and raw_bytes is not None) else ""
                try:
                    after = source.stat()
                except OSError:
                    continue
                if (after.st_size, after.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
                    raise RuntimeError(f"读取时原文发生变化，稍后更新即可：{relative}")
                with connection:
                    if previous:
                        connection.execute("DELETE FROM search WHERE rowid=?", (previous[0],))
                        connection.execute("DELETE FROM documents WHERE id=?", (previous[0],))
                    cursor = connection.execute("INSERT INTO documents(path,title,category,kind,size,modified_ns,sha256,indexed) VALUES(?,?,?,?,?,?,?,?)", (relative, source.stem, relative.split('/')[0] if '/' in relative else '未分类', kind, stat.st_size, stat.st_mtime_ns, digest, indexed))
                    if indexed and body is not None:
                        connection.execute("INSERT INTO search(rowid,terms) VALUES(?,?)", (cursor.lastrowid, compactTerms(body)))
                    connection.execute("DELETE FROM excluded_sources WHERE path=?", (relative,))
                    if invalid:
                        connection.execute("INSERT INTO excluded_sources VALUES(?,?)", (relative, invalid))
                updated += 1
            if position % 25 == 0 or position == len(files):
                print(json.dumps({"processed": position, "total": len(files), "updated": updated}, ensure_ascii=False), flush=True)
        with connection:
            for relative, previous in old.items():
                if relative not in seen:
                    connection.execute("DELETE FROM search WHERE rowid=?", (previous[0],))
                    connection.execute("DELETE FROM documents WHERE id=?", (previous[0],))
                    connection.execute("DELETE FROM excluded_sources WHERE path=?", (relative,)); removed += 1
            connection.execute("INSERT OR REPLACE INTO metadata VALUES('completed_at',datetime('now'))")
            connection.execute("INSERT OR REPLACE INTO metadata VALUES('scope',?)", (json.dumps({'novels': includeNovels, 'journals': includeJournals}),))
        if not target.exists() or verify_full:
            if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("索引校验未通过，原库保留。")
        count = connection.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        indexedCount = connection.execute("SELECT COUNT(*) FROM documents WHERE indexed=1").fetchone()[0]
        rows = connection.execute("SELECT title,kind,category,path,size,modified_ns,indexed FROM documents ORDER BY path").fetchall()
        pending = root / "knowledgeCatalog.pending.csv"
        with pending.open('w', encoding='utf-8-sig', newline='') as handle:
            writer = csv.writer(handle); writer.writerow(['书名','资料类型','分类','相对路径','文件字节','修改时间纳秒','正文加速'])
            for row in rows:
                writer.writerow(["'" + v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v for v in row])
        os.replace(pending, root / "knowledgeCatalog.csv")
        connection.close(); connection = None
        if output != target:
            os.replace(output, target)
        summary = {'schema':SCHEMA,'kindVersion':KIND_VERSION,'documents':count,'indexedDocuments':indexedCount,'bytes':target.stat().st_size,'modifiedMs':target.stat().st_mtime_ns/1000000}
        pendingSummary = root / 'knowledgeIndex.pending.json'
        pendingSummary.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
        os.replace(pendingSummary,root/'knowledgeIndex.json')
        return {"documents": count, "indexedDocuments": indexedCount, "chunks": 0, "updated": updated, "unchanged": unchanged, "removed": removed, "seconds": round(time.perf_counter()-started,3), "bytes": target.stat().st_size, "index": str(target), "catalog": str(root/'knowledgeCatalog.csv'), "validation": "原文只读；相对路径；正文不复制入库"}
    finally:
        if connection is not None:
            connection.close()
        lock.unlink(missing_ok=True)


def catalog(root: Path, query: str = "", kind: str = "", page: int = 1, pageSize: int = 40, scan: bool = False) -> dict:
    from md_search import markdown_files, documentKind
    metadata = index_metadata(root)
    if not scan and metadata.get('schema') == SCHEMA and metadata.get('kind_version') == KIND_VERSION:
        with closing(connect_readonly(Path(metadata['index_path']))) as connection:
            connection.row_factory = sqlite3.Row
            pattern = '%' + query.replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%'
            where = " WHERE (title LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\')" + (" AND kind=?" if kind else '')
            values = [pattern, pattern] + ([kind] if kind else [])
            total = connection.execute('SELECT COUNT(*) FROM documents' + where, values).fetchone()[0]
            rows = connection.execute('SELECT path,title,kind,size AS bytes FROM documents' + where + ' ORDER BY path LIMIT ? OFFSET ?', values + [pageSize,(page-1)*pageSize]).fetchall()
            counts = dict(connection.execute('SELECT kind,COUNT(*) FROM documents GROUP BY kind'))
            return {'total':total,'libraryTotal':sum(counts.values()),'counts':counts,'page':page,'pageSize':pageSize,'documents':[dict(row) for row in rows],'index':metadata}
    if not scan and metadata.get('schema') == SCHEMA:
        with closing(connect_readonly(Path(metadata['index_path']))) as connection:
            all_rows = connection.execute('SELECT path,title,size FROM documents ORDER BY path').fetchall()
            counts: dict[str, int] = {}; filtered_rows = []
            q_lower = query.casefold()
            for rel_path, title, size_bytes in all_rows:
                source_kind = documentKind(root / rel_path, root)
                counts[source_kind] = counts.get(source_kind, 0) + 1
                if (kind and source_kind != kind) or (q_lower and q_lower not in rel_path.casefold() and q_lower not in str(title).casefold()):
                    continue
                filtered_rows.append({'path': rel_path, 'title': title, 'kind': source_kind, 'bytes': size_bytes})
            start = (page - 1) * pageSize
            return {'total': len(filtered_rows), 'libraryTotal': sum(counts.values()), 'counts': counts, 'page': page, 'pageSize': pageSize, 'documents': filtered_rows[start:start + pageSize], 'index': metadata}
    allFiles = markdown_files(root); counts = {}; rows = []
    for path in allFiles:
        sourceKind = documentKind(path, root); counts[sourceKind] = counts.get(sourceKind, 0) + 1
        relative = path.relative_to(root).as_posix()
        if (kind and sourceKind != kind) or query.casefold() not in relative.casefold():
            continue
        rows.append({"path": relative, "title": path.stem, "kind": sourceKind, "bytes": path.stat().st_size})
    start = (page-1)*pageSize
    return {"total": len(rows), "libraryTotal": len(allFiles), "counts": counts, "page": page, "pageSize": pageSize, "documents": rows[start:start+pageSize], "index": index_metadata(root)}


def main() -> None:
    parser = argparse.ArgumentParser(description="轻量MD目录和全文加速，原文保留可见，支持增量与换路径")
    parser.add_argument("root", type=Path); parser.add_argument("--incremental", action="store_true"); parser.add_argument("--verify-full", action="store_true")
    parser.add_argument("--include-novels", action="store_true"); parser.add_argument("--include-journals", action="store_true")
    parser.add_argument("--catalog", action="store_true"); parser.add_argument("--scan", action="store_true"); parser.add_argument("--query", default=""); parser.add_argument("--kind", default=""); parser.add_argument("--page", type=int, default=1); parser.add_argument("--page-size", type=int, default=40)
    parser.add_argument("--read-source"); parser.add_argument("--offset", type=int, default=0)
    args = parser.parse_args();root = args.root.expanduser().resolve()
    if args.read_source:
        relative = Path(args.read_source.replace('\\', '/'))
        source = root / relative
        if relative.is_absolute() or source.is_symlink() or not source.resolve().is_relative_to(root) or source.suffix.casefold() != '.md':
            raise ValueError('只能读取所选知识库内的MD原文。')
        offset = max(0,args.offset)
        with source.open(encoding='utf-8-sig') as handle:
            remaining = offset
            while remaining:
                skipped = handle.read(min(remaining,65536))
                if not skipped: break
                remaining -= len(skipped)
            body = handle.read(60000); more = bool(handle.read(1))
        result = {'path':relative.as_posix(),'title':source.stem,'text':body,'offset':offset,'nextOffset':offset+len(body),'hasMore':more}
    else:
        result = catalog(root,args.query,args.kind,max(1,args.page),min(100,max(1,args.page_size)),args.scan) if args.catalog else build(root,args.incremental,args.verify_full,args.include_novels,args.include_journals)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
