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
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Compute line-level diff between two texts.
 */
export function computeDiff(oldText: string, newText: string): DiffEntry[] {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const result: DiffEntry[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'equal', line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', line: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'remove', line: oldLines[i - 1] });
      i--;
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
