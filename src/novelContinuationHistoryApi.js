export async function appendNovelContinuationHistoryEvent(event) {
  const payload = event && typeof event === 'object' ? event : {};
  const res = await fetch('/api/novel/continuation-history/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: payload })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function loadNovelContinuationHistory(limit = 300) {
  const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 300));
  const res = await fetch(`/api/novel/continuation-history?limit=${safeLimit}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json();
}
