/**
 * DiffEngine — line-level LCS-based diff for prompt versioning.
 */

export interface DiffEntry {
  type: 'equal' | 'add' | 'remove';
  line: string;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

function escapeHTML(str: string): string {
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Compute line-level diff between two texts using Myers O(ND) diff algorithm.
 */
export function computeDiff(oldText: string, newText: string): DiffEntry[] {
  if (!oldText && !newText) return [];
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];
  const n = oldLines.length;
  const m = newLines.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) {
    return newLines.map((line) => ({ type: 'add', line }));
  }
  if (m === 0) {
    return oldLines.map((line) => ({ type: 'remove', line }));
  }

  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  v.fill(-1);
  v[offset + 1] = 0;

  const trace: Int32Array[] = [];
  let reached = false;

  for (let d = 0; d <= max; d++) {
    trace.push(new Int32Array(v));

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }

      let y = x - k;
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }

      v[offset + k] = x;
      if (x >= n && y >= m) {
        reached = true;
        break;
      }
    }
    if (reached) break;
  }

  const result: DiffEntry[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d--) {
    const vPrev = trace[d];
    const k = x - y;
    let prevK: number;

    if (k === -d || (k !== d && vPrev[offset + k - 1] < vPrev[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = vPrev[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      result.unshift({ type: 'equal', line: oldLines[x] });
    }

    if (d > 0) {
      if (x === prevX) {
        y--;
        result.unshift({ type: 'add', line: newLines[y] });
      } else {
        x--;
        result.unshift({ type: 'remove', line: oldLines[x] });
      }
    }
  }

  return result;
}


/**
 * Generate side-by-side diff HTML panels.
 */
export function toSideBySideHTML(diff: DiffEntry[]): { leftHTML: string; rightHTML: string; stats: DiffStats } {
  const leftLines: string[] = [];
  const rightLines: string[] = [];
  const stats: DiffStats = { added: 0, removed: 0, unchanged: 0 };
  let leftNum = 0, rightNum = 0;

  for (const entry of diff) {
    const escaped = escapeHTML(entry.line);
    if (entry.type === 'equal') {
      leftNum++; rightNum++; stats.unchanged++;
      leftLines.push(`<div class="diff-line diff-equal"><span class="diff-num">${leftNum}</span><span class="diff-text">${escaped}</span></div>`);
      rightLines.push(`<div class="diff-line diff-equal"><span class="diff-num">${rightNum}</span><span class="diff-text">${escaped}</span></div>`);
    } else if (entry.type === 'remove') {
      leftNum++; stats.removed++;
      leftLines.push(`<div class="diff-line diff-remove"><span class="diff-num">${leftNum}</span><span class="diff-text">${escaped}</span></div>`);
      rightLines.push(`<div class="diff-line diff-empty"><span class="diff-num"></span><span class="diff-text"></span></div>`);
    } else {
      rightNum++; stats.added++;
      leftLines.push(`<div class="diff-line diff-empty"><span class="diff-num"></span><span class="diff-text"></span></div>`);
      rightLines.push(`<div class="diff-line diff-add"><span class="diff-num">${rightNum}</span><span class="diff-text">${escaped}</span></div>`);
    }
  }

  return { leftHTML: leftLines.join(''), rightHTML: rightLines.join(''), stats };
}

/**
 * Generate unified diff HTML.
 */
export function toUnifiedHTML(diff: DiffEntry[]): string {
  let lineNum = 0;
  return diff.map(entry => {
    lineNum++;
    const escaped = escapeHTML(entry.line);
    const prefix = entry.type === 'equal' ? ' ' : entry.type === 'add' ? '+' : '-';
    return `<div class="diff-line diff-${entry.type}"><span class="diff-prefix">${prefix}</span><span class="diff-num">${lineNum}</span><span class="diff-text">${escaped}</span></div>`;
  }).join('');
}
