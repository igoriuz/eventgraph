/**
 * Reading source as text without parsing it: telling code from the comments,
 * strings and regex literals in it. Every extractor that matches a pattern or
 * balances brackets needs this, and each used to carry its own copy.
 */

/** Words after which a `/` starts a regex rather than dividing. */
const BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void', 'throw', 'new', 'delete', 'await', 'yield']);

/**
 * The index of the closing `/` of a regex literal opening at `open`, or -1
 * when the slash there is a division. A slash divides after a value — a name,
 * a number, a closing bracket — and opens a regex after anything else.
 */
function regexEnd(content: string, open: number): number {
  let before = open - 1;
  while (before >= 0 && /\s/.test(content[before]!)) before--;
  if (before >= 0 && /[\w$)\]}'"`]/.test(content[before]!)) {
    const word = /[A-Za-z]+$/.exec(content.slice(Math.max(0, before - 9), before + 1))?.[0];
    if (!word || !BEFORE_REGEX.has(word)) return -1;
  }

  let inClass = false;
  for (let i = open + 1; i < content.length; i++) {
    const char = content[i]!;
    if (char === '\n') return -1;
    if (char === '\\') i++;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) return i;
  }
  return -1;
}

/** A stretch of source that is not code. `end` is its last character. */
interface NonCode {
  kind: 'comment' | 'string' | 'regex';
  end: number;
}

/**
 * The comment, string or regex literal starting at `at`, if one does.
 *
 * Comments are looked for before quotes, because they are what actually breaks
 * a naive scan: an apostrophe in `// partner's encounter` opens a string that
 * never closes. A regex literal is recognised by what stands before it, so
 * that a quote or a backtick inside one does not open a string either.
 *
 * Not a parser. Where the guess is wrong, as in JSX text, a `'` or `"` string
 * still ends at the line break at the latest and a regex never spans lines, so
 * the damage stays in that line. An unterminated comment or template literal
 * runs to the end of the file.
 */
function nonCodeAt(content: string, at: number): NonCode | undefined {
  const char = content[at];

  if (char === '/' && content[at + 1] === '/') {
    const end = content.indexOf('\n', at);
    return { kind: 'comment', end: end === -1 ? content.length - 1 : end - 1 };
  }
  if (char === '/' && content[at + 1] === '*') {
    const end = content.indexOf('*/', at + 2);
    return { kind: 'comment', end: end === -1 ? content.length - 1 : end + 1 };
  }
  if (char === '/') {
    const end = regexEnd(content, at);
    return end === -1 ? undefined : { kind: 'regex', end };
  }
  if (char === '"' || char === "'" || char === '`') {
    let close = at + 1;
    for (; close < content.length; close++) {
      if (content[close] === '\\') close++;
      else if (content[close] === char || (char !== '`' && content[close] === '\n')) break;
    }
    return { kind: 'string', end: Math.min(close, content.length - 1) };
  }
  return undefined;
}

/**
 * The source text of the call or object starting at `open`, brackets balanced.
 *
 * Every extractor that reads a declaration spanning lines needs this: a route
 * table entry, a reducer body, a table declaration. Brackets inside comments,
 * strings and regex literals do not count — without that, one apostrophe in a
 * comment made the block run to the end of the file, which read as one reducer
 * emitting every event in the module rather than as a parse failure.
 */
export function blockAt(content: string, open: number): string {
  const closing: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const opening = content[open];
  if (!opening || !(opening in closing)) return '';
  const close = closing[opening]!;

  let depth = 0;
  for (let i = open; i < content.length; i++) {
    const skipped = nonCodeAt(content, i);
    if (skipped) {
      i = skipped.end;
      continue;
    }

    if (content[i] === opening) depth++;
    else if (content[i] === close) {
      depth--;
      if (depth === 0) return content.slice(open, i + 1);
    }
  }
  return content.slice(open);
}

/**
 * `content` with its comments blanked out — and, on request, the insides of
 * its string literals — every other character left at its offset.
 *
 * A pattern run over the result cannot match inside a comment, and with the
 * strings blanked it cannot match text that is merely quoted either. Offsets
 * are unchanged, so a match is read back from the original at the same place.
 * The quotes themselves stay, which is what lets a caller find a string
 * argument here and take its value from there.
 */
export function blank(content: string, what: 'comments' | 'comments-and-strings'): string {
  const out = content.split('');
  const wipe = (from: number, to: number) => {
    for (let i = from; i <= to; i++) if (out[i] !== '\n') out[i] = ' ';
  };

  for (let i = 0; i < content.length; i++) {
    const skipped = nonCodeAt(content, i);
    if (!skipped) continue;

    if (skipped.kind === 'comment') wipe(i, skipped.end);
    else if (skipped.kind === 'string' && what === 'comments-and-strings') {
      // Between the quotes; an unterminated string has no closing one to keep.
      const closed = skipped.end > i && content[skipped.end] === content[i];
      wipe(i + 1, closed ? skipped.end - 1 : skipped.end);
    }
    i = skipped.end;
  }
  return out.join('');
}
