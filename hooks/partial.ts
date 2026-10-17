export type Key = 'file_path' | 'content' | 'old_string' | 'new_string' | 'command';
type Fields = Partial<Record<Key, string>>;
type Flags = Partial<Record<Key, true>>;
type Counts = Partial<Record<Key, number>>;
type Phase = 'start' | 'reading' | 'done' | 'invalid' | 'limited';
type Mode = 'idle' | 'key' | 'string' | 'atom';
type Num = '-' | '0' | 'i' | '.' | 'f' | 'e' | 's' | 'x';

export type State = Readonly<{
  phase: Phase;
  stack: string;
  mode: Mode;
  key: string | null;
  target: Key | null;
  escape: 0 | 1 | 2;
  hex: number;
  digits: number;
  literal: string | null;
  num: Num;
  values: Readonly<Fields>;
  truncated: Readonly<Flags>;
  closed: Readonly<Flags>;
  // Line breaks (\n) seen in each tail key's whole value, cut part included.
  breaks: Readonly<Counts>;
}>;

const LIMIT: Readonly<Record<Key, number>> = {
  file_path: 4096, content: 20000, old_string: 20000, new_string: 20000, command: 4096,
};
const MAX_DEPTH = 64;
const ESC: Readonly<Record<string, string>> = {
  '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f',
  n: '\n', r: '\r', t: '\t',
};
const wanted = (k: string | null): k is Key =>
  k === 'file_path' || k === 'content' || k === 'old_string' || k === 'new_string' ||
  k === 'command';
const white = (c: string) => c === ' ' || c === '\n' || c === '\r' || c === '\t';
const digit = (c: string) => c >= '0' && c <= '9';
const tail = (k: Key) => k === 'content' || k === 'old_string' || k === 'new_string';

export function initialState(): State {
  return {
    phase: 'start', stack: '', mode: 'idle', key: null, target: null,
    escape: 0, hex: 0, digits: 0, literal: null, num: '0',
    values: {}, truncated: {}, closed: {}, breaks: {},
  };
}

function numberNext(n: Num, c: string): Num | null {
  const d = digit(c), e = c === 'e' || c === 'E';
  switch (n) {
    case '-': return c === '0' ? '0' : d ? 'i' : null;
    case '0': return c === '.' ? '.' : e ? 'e' : null;
    case 'i': return d ? 'i' : c === '.' ? '.' : e ? 'e' : null;
    case '.': return d ? 'f' : null;
    case 'f': return d ? 'f' : e ? 'e' : null;
    case 'e': return c === '+' || c === '-' ? 's' : d ? 'x' : null;
    case 's': case 'x': return d ? 'x' : null;
  }
}

// One top-level object per state. Raw decoded UTF-16, NOT render-safe text.
// No raw JSON accumulation, recursion, I/O, timers, logging, or deliberate throw.
export function feed(previous: State, chunk: string): State {
  const s = {
    ...previous, values: { ...previous.values },
    truncated: { ...previous.truncated }, closed: { ...previous.closed },
    breaks: { ...previous.breaks },
  };
  if (s.phase === 'invalid' || s.phase === 'limited') return s;

  // At most LIMIT[target] new code units, even for a huge input chunk.
  const buffer: string[] = [];
  let count = 0;
  const flush = () => {
    const k = s.target;
    if (k !== null && count > 0) {
      const cap = LIMIT[k], old = s.values[k] ?? '';
      const start = count > cap ? count % cap : 0;
      const added = start === 0 ? buffer.join('')
        : buffer.slice(start).concat(buffer.slice(0, start)).join('');
      if (tail(k)) {
        if (old.length + count > cap) s.truncated[k] = true;
        s.values[k] = (old + added).slice(-cap);
      } else s.values[k] = old + added;
    }
    buffer.length = 0;
    count = 0;
  };
  const emit = (c: string) => {
    if (s.mode === 'key') {
      if (s.key !== null) s.key = s.key.length < 10 ? s.key + c : null;
      return;
    }
    const k = s.target;
    if (k === null) return;
    const cap = LIMIT[k];
    if (!tail(k)) {
      if (s.truncated[k]) return;
      if ((k === 'command' && (c === '\n' || c === '\r')) ||
          (s.values[k]?.length ?? 0) + count >= cap) {
        s.truncated[k] = true;
        return;
      }
    } else if (c === '\n') s.breaks[k] = (s.breaks[k] ?? 0) + 1;
    buffer[count % cap] = c;
    count++;
  };
  const top = (p: string) => { s.stack = s.stack.slice(0, -1) + p; };
  const pop = () => {
    s.stack = s.stack.slice(0, -1);
    if (!s.stack) s.phase = 'done';
  };

  for (let i = 0; i < chunk.length; i++) {
    if (s.phase === 'invalid' || s.phase === 'limited') break;
    const c = chunk.charAt(i);
    if (s.mode === 'key' || s.mode === 'string') {
      if (s.escape === 2) {
        if (!/^[0-9a-fA-F]$/.test(c)) { s.phase = 'invalid'; continue; }
        s.hex = s.hex * 16 + parseInt(c, 16);
        if (++s.digits === 4) { emit(String.fromCharCode(s.hex)); s.escape = 0; }
      } else if (s.escape === 1) {
        if (c === 'u') { s.escape = 2; s.hex = 0; s.digits = 0; }
        else if (Object.prototype.hasOwnProperty.call(ESC, c)) {
          emit(ESC[c]!); s.escape = 0;
        } else s.phase = 'invalid';
      } else if (c === '\\') s.escape = 1;
      else if (c === '"') {
        if (s.mode === 'key') {
          s.target = s.stack.length === 1 && wanted(s.key) ? s.key : null;
        } else {
          flush();
          if (s.target !== null) s.closed[s.target] = true;
          s.target = null;
        }
        s.key = null;
        s.mode = 'idle';
      } else if (c.charCodeAt(0) < 0x20) s.phase = 'invalid';
      else emit(c);
      continue;
    }
    if (s.mode === 'atom') {
      if (white(c) || c === ',' || c === '}' || c === ']') {
        const complete = s.literal !== null ? s.literal === ''
          : s.num === '0' || s.num === 'i' || s.num === 'f' || s.num === 'x';
        if (!complete) s.phase = 'invalid';
        else { s.mode = 'idle'; i--; } // Reprocess the delimiter, once.
      } else if (s.literal !== null) {
        if (c !== s.literal.charAt(0)) s.phase = 'invalid';
        else s.literal = s.literal.slice(1);
      } else {
        const n = numberNext(s.num, c);
        if (n === null) s.phase = 'invalid'; else s.num = n;
      }
      continue;
    }
    if (white(c)) continue;
    if (s.phase === 'done') { s.phase = 'invalid'; continue; }
    if (s.phase === 'start') {
      if (c === '{') { s.phase = 'reading'; s.stack = 'K'; }
      else s.phase = 'invalid';
      continue;
    }
    // K/k: object key (optional/required); V: value; O: comma/end.
    // A/a: array value (optional/required); D: comma/end.
    const p = s.stack.slice(-1);
    if (p === 'K' || p === 'k') {
      if (c === '}' && p === 'K') pop();
      else if (c === '"') {
        s.mode = 'key'; s.key = s.stack.length === 1 ? '' : null;
        s.target = null; s.escape = 0; top(':');
      } else s.phase = 'invalid';
    } else if (p === ':') {
      if (c === ':') top('V'); else s.phase = 'invalid';
    } else if (p === 'O' || p === 'D') {
      if (c === ',') top(p === 'O' ? 'k' : 'a');
      else if (c === (p === 'O' ? '}' : ']')) pop();
      else s.phase = 'invalid';
    } else if (p === 'A' && c === ']') pop();
    else if (p === 'V' || p === 'A' || p === 'a') {
      if (c !== '"' && c !== '{' && c !== '[' && c !== '-' &&
          !digit(c) && c !== 't' && c !== 'f' && c !== 'n') {
        s.phase = 'invalid'; continue;
      }
      if (s.target !== null) {
        // Last duplicate value wins; non-string values remove old previews.
        delete s.values[s.target]; delete s.truncated[s.target];
        delete s.closed[s.target]; delete s.breaks[s.target];
        if (c === '"') s.values[s.target] = '';
      }
      top(p === 'V' ? 'O' : 'D');
      if (c === '"') { s.mode = 'string'; s.escape = 0; }
      else {
        s.target = null;
        if (c === '{' || c === '[') {
          if (s.stack.length >= MAX_DEPTH) s.phase = 'limited';
          else s.stack += c === '{' ? 'K' : 'A';
        } else {
          s.mode = 'atom';
          s.literal = c === 't' ? 'rue' : c === 'f' ? 'alse' : c === 'n' ? 'ull' : null;
          s.num = c === '-' ? '-' : c === '0' ? '0' : 'i';
        }
      }
    } else s.phase = 'invalid';
  }
  flush();
  return s;
}
