interface ScrollEntry {
  key: string;
  top: number;
  left: number;
}

interface ScrollSnapshot {
  windowX: number;
  windowY: number;
  entries: ScrollEntry[];
}

const restoreSequence = new WeakMap<HTMLElement, number>();

function getScrollableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-scroll-preserve]'));
}

function captureScrollSnapshot(root: HTMLElement): ScrollSnapshot {
  const entries = getScrollableElements(root)
    .map((element) => {
      const key = element.dataset.scrollPreserve;
      if (!key) return null;
      return {
        key,
        top: element.scrollTop,
        left: element.scrollLeft,
      };
    })
    .filter((entry): entry is ScrollEntry => entry !== null);

  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    entries,
  };
}

function restoreScrollSnapshot(root: HTMLElement, snapshot: ScrollSnapshot): void {
  const elementsByKey = new Map<string, HTMLElement>();
  for (const element of getScrollableElements(root)) {
    const key = element.dataset.scrollPreserve;
    if (!key) continue;
    elementsByKey.set(key, element);
  }

  for (const entry of snapshot.entries) {
    const target = elementsByKey.get(entry.key);
    if (!target) continue;
    target.scrollTop = entry.top;
    target.scrollLeft = entry.left;
  }

  window.scrollTo(snapshot.windowX, snapshot.windowY);
}

export function preserveScrollDuringRender(root: HTMLElement, render: () => void): void {
  const seq = (restoreSequence.get(root) ?? 0) + 1;
  restoreSequence.set(root, seq);
  const snapshot = captureScrollSnapshot(root);
  render();
  requestAnimationFrame(() => {
    if (restoreSequence.get(root) !== seq) return;
    restoreScrollSnapshot(root, snapshot);
  });
}
