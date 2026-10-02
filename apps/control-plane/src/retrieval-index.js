import crypto from 'node:crypto';

export const RETRIEVAL_VECTOR_DIMENSIONS = 256;

export const contentRevision = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function chunkDocumentText(value, { targetSize = 1400, overlap = 220 } = {}) {
  const text = String(value || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (!text) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + targetSize);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n\n', end), text.lastIndexOf('\n', end), text.lastIndexOf('。', end), text.lastIndexOf('. ', end));
      if (boundary > start + Math.floor(targetSize * 0.55)) end = boundary + 1;
    }
    const content = text.slice(start, end).trim();
    if (content) chunks.push(content);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function features(value) {
  const normalized = String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const result = normalized.match(/[a-z0-9][a-z0-9._/-]{1,}|[\u3400-\u9fff]|[\u3400-\u9fff]{2,}/g) || [];
  for (let index = 0; index < normalized.length - 2; index += 1) {
    const gram = normalized.slice(index, index + 3);
    if (!/^\s+$/.test(gram)) result.push(gram);
  }
  return result;
}

export function localRetrievalVector(value, dimensions = RETRIEVAL_VECTOR_DIMENSIONS) {
  const vector = Array(dimensions).fill(0);
  for (const feature of features(value)) {
    const digest = crypto.createHash('sha256').update(feature).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    vector[index] += digest[4] & 1 ? 1 : -1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  return magnitude ? vector.map(item => Number((item / magnitude).toFixed(7))) : vector;
}

export function lexicalRetrievalScore(query, content) {
  const terms = [...new Set(features(query).filter(term => term.length > 1))];
  if (!terms.length) return 0;
  const haystack = String(content || '').normalize('NFKC').toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? Math.min(3, term.length / 2) : 0), 0) / terms.length;
}
