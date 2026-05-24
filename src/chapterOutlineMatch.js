/**
 * 章节梗概手札匹配：兼容「第 n 章 / 第 n 张」与阿拉伯数字、中文数字（如一、三、十一、二十三）。
 * 旧逻辑只认「第 n 张梗概」+ 标签「第 n 张」，与常见「第三章梗概」等命名不一致。
 */

function chineseNumeral1to99(n) {
  const d = '零一二三四五六七八九';
  const x = Math.floor(Math.max(1, Math.min(99, Number(n) || 1)));
  if (x < 10) return d[x];
  if (x === 10) return '十';
  if (x < 20) return '十' + d[x % 10];
  if (x < 100) {
    const tens = Math.floor(x / 10);
    const ones = x % 10;
    if (tens === 1) return '十' + (ones ? d[ones] : '');
    return d[tens] + '十' + (ones ? d[ones] : '');
  }
  return String(x);
}

/**
 * @param {unknown} scrapbook
 * @param {number} chapterIndex1Based 当前卷录序号（1=第一章）
 * @returns {object | null}
 */
export function findChapterOutlineScrapbookItem(scrapbook, chapterIndex1Based) {
  const n = Math.max(1, Number(chapterIndex1Based) || 1);
  const cn = chineseNumeral1to99(n);
  const titleNeedles = [
    `第${n}张梗概`,
    `第${n}章梗概`,
    `第${cn}张梗概`,
    `第${cn}章梗概`
  ];
  const tagNeedles = [`第${n}张`, `第${n}章`, `第${cn}张`, `第${cn}章`];
  const list = Array.isArray(scrapbook) ? scrapbook : [];

  const titleMatches = (title) => {
    const t = String(title || '');
    if (titleNeedles.some((needle) => t.includes(needle))) return true;
    if (!t.includes('梗概')) return false;
    return (
      t.includes(`第${n}章`) ||
      t.includes(`第${n}张`) ||
      t.includes(`第${cn}章`) ||
      t.includes(`第${cn}张`)
    );
  };

  return (
    list.find((item) => {
      const title = String(item?.title || '');
      const tags = Array.isArray(item?.tags) ? item.tags : [];
      const titleOk = titleMatches(title);
      const tagOk = tags.some((tag) =>
        tagNeedles.some((needle) => String(tag).includes(needle))
      );
      return titleOk || tagOk;
    }) || null
  );
}
