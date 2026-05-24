/**
 * 从 data/rag/novel_index.json 的主文切片（workType=main）合并回 novel.content，
 * 分章格式与 NovelView 一致：@@chapter:标题 + \n\n<<<CHAPTER_SPLIT>>>\n\n
 * 切片间：优先按最长公共后缀/前缀去重叠；无重叠时按段落用 \n\n 拼接（与 chunkTextSemantic 段落切分一致）。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const indexPath = path.join(root, 'data/rag/novel_index.json')
const dbPath = path.join(root, 'data/database.json')

const NOVEL_CHAPTER_SPLIT = '\n\n<<<CHAPTER_SPLIT>>>\n\n'
const MAX_OVERLAP_SCAN = 450

function chapterKeyOrder(key) {
  const m = String(key).match(/^ch(\d+)_/)
  return m ? parseInt(m[1], 10) : 9999
}

function mergeChunkTexts(texts) {
  if (!texts.length) return ''
  let result = texts[0]
  for (let i = 1; i < texts.length; i++) {
    const next = texts[i]
    let maxLen = 0
    const maxCheck = Math.min(result.length, next.length, MAX_OVERLAP_SCAN)
    for (let len = maxCheck; len >= 1; len--) {
      if (result.endsWith(next.slice(0, len))) {
        maxLen = len
        break
      }
    }
    if (maxLen > 0) {
      result += next.slice(maxLen)
    } else {
      result += '\n\n' + next
    }
  }
  return result
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
const docs = index.docs.filter((d) => d.type === 'novel' && d.workType === 'main')
const byChapter = new Map()
for (const d of docs) {
  if (!byChapter.has(d.chapterKey)) byChapter.set(d.chapterKey, [])
  byChapter.get(d.chapterKey).push(d)
}

const sortedKeys = [...byChapter.keys()].sort((a, b) => chapterKeyOrder(a) - chapterKeyOrder(b))
const parts = []
for (const ck of sortedKeys) {
  const arr = byChapter.get(ck).sort((a, b) => a.chunkIndex - b.chunkIndex)
  const chapterTitle = String(arr[0].chapterTitle || '').trim() || ck
  const body = mergeChunkTexts(arr.map((d) => d.text))
  parts.push(`@@chapter:${chapterTitle}\n${body}`)
}

const content = parts.join(NOVEL_CHAPTER_SPLIT)

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'))
if (!db.novel || typeof db.novel !== 'object') db.novel = {}
db.novel.content = content
db.novel.updatedAt = Date.now()

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8')
console.log(
  'OK: novel.content from novel_index (main), chapters=%d chars=%d splits=%d',
  sortedKeys.length,
  content.length,
  (content.match(/<<<CHAPTER_SPLIT>>>/g) || []).length
)
