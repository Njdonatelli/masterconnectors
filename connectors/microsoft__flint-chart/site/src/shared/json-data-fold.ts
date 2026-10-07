import { foldEffect } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';

const DEFAULT_FOLD_KEYS = ['data'];

/** Find object/array value ranges for JSON properties like `"data": { ... }`. */
export function findJsonPropertyValueRanges(
  text: string,
  keys: string[],
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (const key of keys) {
    const needle = `"${key}"`;
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const keyIdx = text.indexOf(needle, searchFrom);
      if (keyIdx === -1) break;

      let i = keyIdx + needle.length;
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] !== ':') {
        searchFrom = keyIdx + 1;
        continue;
      }
      i++;
      while (i < text.length && /\s/.test(text[i])) i++;

      const valueStart = i;
      const open = text[valueStart];
      if (open !== '{' && open !== '[') {
        searchFrom = keyIdx + 1;
        continue;
      }

      const closeIdx = findMatchingJsonBracket(text, valueStart);
      if (closeIdx === -1) {
        searchFrom = keyIdx + 1;
        continue;
      }

      ranges.push({ from: valueStart, to: closeIdx + 1 });
      searchFrom = closeIdx + 1;
    }
  }
  return ranges;
}

function findMatchingJsonBracket(text: string, start: number): number {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Fold `data` (and other) property values in a CodeMirror view. */
export function foldJsonProperties(view: EditorView, keys: string[] = DEFAULT_FOLD_KEYS) {
  const doc = view.state.doc.toString();
  const effects = findJsonPropertyValueRanges(doc, keys).map(({ from, to }) =>
    // Match lang-json foldInside: hide inner content, keep surrounding brackets.
    foldEffect.of({ from: from + 1, to: to - 1 }),
  );
  if (effects.length > 0) view.dispatch({ effects });
}

/** Wait for the JSON syntax tree before folding (doc swap / first paint). */
export function scheduleFoldJsonProperties(view: EditorView, keys: string[] = DEFAULT_FOLD_KEYS) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => foldJsonProperties(view, keys));
  });
}
