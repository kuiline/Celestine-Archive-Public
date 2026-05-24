#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将仅含 GBK/Big5 等「码位型」cmap 的旧版 TTF 转为浏览器可用的 Unicode BMP cmap (platform 3, encoding 1, format 4)。

另有部分字体已是 Unicode cmap，但表结构不符合 Chrome OTS（如 cmap 段序、**vhea.numberOfVMetrics 大于 numGlyphs**），
则重编译 cmap 并做 **vhea/vmtx 校验**（见 UNICODE_CLEAN_JOBS）。

用法（项目根目录）:
  pip install fonttools
  python scripts/rebuild_legacy_font_cmap.py

默认从「母版字体库」读取原版 TTF，写出 `_web.ttf` 到「字体库」。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable

# 双字节键按此顺序尝试解码为 Unicode
ENCODINGS_2BYTE = ("gbk", "gb18030", "big5hkscs", "big5")

ROOT = Path(__file__).resolve().parent.parent

DEFAULT_JOBS = (
    ("长城中隶体.TTF", "长城中隶体_web.ttf"),
    ("长城粗魏碑体.TTF", "长城粗魏碑体_web.ttf"),
    ("长城行楷体.TTF", "长城行楷体_web.ttf"),
    ("文鼎荊棘體.ttf", "文鼎荊棘體_web.ttf"),
)

# 已是 Unicode cmap，但部分文件 OTS 仍报 cmap 段序错误：重写成单张 format 4（诗句条「全新硬笔楷书简」等同理预防）
UNICODE_CLEAN_JOBS = (
    ("迷你简黄草体.ttf", "迷你简黄草体_web.ttf"),
    ("全新硬笔楷书简.ttf", "全新硬笔楷书简_web.ttf"),
)


def legacy_key_to_unicode(code: int) -> int | None:
    if code < 0x80:
        return code
    if code > 0xFFFF:
        return None
    b = code.to_bytes(2, "big")
    for enc in ENCODINGS_2BYTE:
        try:
            s = b.decode(enc)
        except UnicodeDecodeError:
            continue
        if len(s) == 1:
            return ord(s)
    return None


def largest_cmap_dict(font: TTFont) -> dict:
    best: dict = {}
    best_n = 0
    for t in font["cmap"].tables:
        cm = getattr(t, "cmap", None)
        if cm and len(cm) > best_n:
            best_n = len(cm)
            best = cm
    return best


def build_unicode_cmap(cm: dict) -> tuple[dict, int, int, int]:
    """返回 (unicode -> glyphName), 跳过数, 冲突数(保留先出现的映射)."""
    out: dict[int, str] = {}
    skipped = 0
    conflicts = 0
    for k, gname in cm.items():
        u = legacy_key_to_unicode(int(k))
        if u is None:
            skipped += 1
            continue
        if u in out:
            if out[u] != gname:
                conflicts += 1
            continue
        out[u] = gname
    return out, skipped, conflicts


def rebuild_font_cmap(font: TTFont, unicode_cmap: dict) -> None:
    cmap_new = newTable("cmap")
    cmap_new.tableVersion = 0
    st = CmapSubtable.newSubtable(4)
    st.platformID = 3
    st.platEncID = 1
    st.language = 0
    st.cmap = unicode_cmap
    cmap_new.tables = [st]
    font["cmap"] = cmap_new


def sanitize_tables_for_web_ot_s(font: TTFont, quiet: bool) -> None:
    """
    OTS 常见拒收：vhea.numberOfVMetrics 与 maxp / vmtx 不一致（如垃圾值 25185）。
    仅修正数字不可靠：fontTools 在 compile 时仍可能把 vmtx 判为「过长」并重写为 1。
    标题与环绕短句均为横排，直接移除 vhea+vmtx 即可通过 Chrome OTS。
    """
    if "maxp" not in font:
        return
    ng = font["maxp"].numGlyphs
    if "vhea" not in font or "vmtx" not in font:
        return
    vh = font["vhea"]
    nvmtx = len(font["vmtx"].metrics)
    cap = min(ng, nvmtx)
    if cap < 1:
        return
    nvm = getattr(vh, "numberOfVMetrics", cap)
    if nvm > cap or nvm < 1:
        if not quiet:
            print(f"  移除 vhea/vmtx（原 numberOfVMetrics={nvm}，numGlyphs={ng}）")
        del font["vhea"]
        del font["vmtx"]


def process_unicode_clean(src: Path, dst: Path, quiet: bool) -> bool:
    """保留 Unicode 映射，仅替换为单 subtable format 4，修复 OTS cmap 段序等问题。"""
    font = TTFont(str(src), ignoreDecompileErrors=True, recalcTimestamp=True)
    best = font["cmap"].getBestCmap()
    if not best:
        print(f"[err] 无 Unicode cmap(getBestCmap): {src}", file=sys.stderr)
        return False
    if not quiet:
        print(f"{src.name}: Unicode 重编译 cmap，条目 {len(best)}")
    rebuild_font_cmap(font, dict(best))
    sanitize_tables_for_web_ot_s(font, quiet)
    dst.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(dst))
    return True


def process_one(src: Path, dst: Path, quiet: bool) -> bool:
    # 文鼎等字体 head 表可能多填充字节，严格反序列化会失败；保留原始二进制表仍可保存。
    font = TTFont(str(src), ignoreDecompileErrors=True, recalcTimestamp=True)
    cm = largest_cmap_dict(font)
    if not cm:
        print(f"[err] 无 cmap: {src}", file=sys.stderr)
        return False
    umap, skipped, conflicts = build_unicode_cmap(cm)
    if not quiet:
        print(f"{src.name}: 源映射 {len(cm)} → Unicode {len(umap)}, 跳过 {skipped}, 冲突丢弃 {conflicts}")
    rebuild_font_cmap(font, umap)
    sanitize_tables_for_web_ot_s(font, quiet)
    dst.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(dst))
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="旧字体 cmap → Unicode BMP (3,1,4)")
    ap.add_argument(
        "--input",
        type=Path,
        help="单个输入 TTF（指定时需同时 --output）",
    )
    ap.add_argument("--output", type=Path, help="输出路径")
    ap.add_argument(
        "--root",
        type=Path,
        default=ROOT,
        help="项目根目录（默认脚本上级）",
    )
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args()

    if args.input:
        if not args.output:
            print("与 --input 同时需要 --output", file=sys.stderr)
            return 2
        ok = process_one(args.input, args.output, args.quiet)
        return 0 if ok else 1

    root = args.root
    sources = root / "母版字体库"
    library = root / "字体库"
    failed = 0
    for rel_in, rel_out in DEFAULT_JOBS:
        src = sources / rel_in
        dst = library / rel_out
        if not src.is_file():
            print(f"[skip] 找不到: {src}", file=sys.stderr)
            failed += 1
            continue
        if not process_one(src, dst, args.quiet):
            failed += 1
    for rel_in, rel_out in UNICODE_CLEAN_JOBS:
        src = sources / rel_in
        dst = library / rel_out
        if not src.is_file():
            print(f"[skip] 找不到: {src}", file=sys.stderr)
            failed += 1
            continue
        if not process_unicode_clean(src, dst, args.quiet):
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
