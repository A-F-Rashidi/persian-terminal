/* Shared by the webview and Node tests. Stores logical text; never reverses or reshapes it. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PersianAnsi = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const DEFAULT = Object.freeze({ fg: null, bg: null, bold: false, italic: false, underline: false, inverse: false });
  class OutputModel {
    constructor(maxLines = 2000, maxCells = 200000, maxColumns = 20000) {
      this.maxLines = maxLines;
      this.maxCells = maxCells;
      this.maxColumns = maxColumns;
      this.lines = [[]];
      this.row = 0; this.origin = null;
      this.cursor = 0;
      this.cells = 0;
      this.unsupported = false;
      this.truncated = false;
      this.streams = {};
      this.dirtyFrom = 0;
    }
    stream(name) {
      return this.streams[name] || (this.streams[name] = { mode: 'text', control: '', style: DEFAULT });
    }
    write(data, name = 'stdout') {
      this.dirtyFrom = Math.min(this.dirtyFrom, this.row);
      const state = this.stream(name);
      for (const ch of data) {
        if (state.mode === 'string' || state.mode === 'stringEsc') {
          if (ch === '\x07' || (state.mode === 'stringEsc' && ch === '\\')) state.mode = 'text';
          else state.mode = ch === '\x1b' ? 'stringEsc' : 'string';
          continue;
        }
        if (ch === '\x1b') { state.mode = 'esc'; state.control = ''; continue; }
        if (state.mode === 'esc') {
          if (ch === '[') state.mode = 'csi';
          else if ([']', 'P', '^', '_', 'X'].includes(ch)) state.mode = 'string';
          else if (ch >= ' ' && ch <= '/') state.mode = 'escIntermediate';
          else { state.mode = 'text'; this.unsupported = true; }
          continue;
        }
        if (state.mode === 'escIntermediate') {
          if (ch >= '0' && ch <= '~') state.mode = 'text';
          this.unsupported = true;
          continue;
        }
        if (state.mode === 'csi' || state.mode === 'discardCsi') {
          if (ch >= '@' && ch <= '~') {
            if (state.mode === 'csi') this.csi(state.control, ch, state);
            state.mode = 'text'; state.control = '';
          } else if (state.control.length < 256 && state.mode === 'csi') state.control += ch;
          else { state.mode = 'discardCsi'; this.unsupported = true; }
          continue;
        }
        if (ch === '\n') { this.row++; if (this.row >= this.lines.length) this.lines.push([]); this.cursor = 0; this.trim(); }
        else if (ch === '\r') this.cursor = 0;
        else if (ch === '\b') this.cursor = Math.max(0, this.cursor - 1);
        else if (ch === '\t') {
          const count = 8 - this.cursor % 8;
          for (let i = 0; i < count; i++) this.put(' ', state.style, name);
        } else if (ch >= ' ' && ch !== '\x7f' && !(ch >= '\x80' && ch <= '\x9f')) this.put(ch, state.style, name);
      }
    }
    put(text, style, stream) {
      if (this.cursor >= this.maxColumns) { this.truncated = true; return; }
      const line = this.lines[this.row];
      this.dirtyFrom = Math.min(this.dirtyFrom, this.row);
      const oldLength = line.length;
      line[this.cursor++] = { text, style, stream };
      this.cells += line.length - oldLength;
      this.trim();
    }
    trim() {
      while (this.lines.length > 1 && (this.lines.length > this.maxLines || this.cells > this.maxCells)) {
        this.cells -= this.lines.shift().length;
        this.row = Math.max(0, this.row - 1);
        if (this.origin !== null) this.origin++;
        this.truncated = true;
        this.dirtyFrom = 0;
      }
    }
    csi(params, final, state) {
      if (final === 'm' && /^[\d;]*$/.test(params)) {
        const codes = params === '' ? [0] : params.split(';').map(x => Number(x || 0));
        let s = { ...state.style };
        for (let i = 0; i < codes.length; i++) {
          const c = codes[i];
          if (c === 0) s = { ...DEFAULT };
          else if (c === 1) s.bold = true;
          else if (c === 3) s.italic = true;
          else if (c === 4) s.underline = true;
          else if (c === 7) s.inverse = true;
          else if (c === 22) s.bold = false;
          else if (c === 23) s.italic = false;
          else if (c === 24) s.underline = false;
          else if (c === 27) s.inverse = false;
          else if (c === 39) s.fg = null;
          else if (c === 49) s.bg = null;
          else if (c >= 30 && c <= 37) s.fg = c - 30;
          else if (c >= 90 && c <= 97) s.fg = c - 90 + 8;
          else if (c >= 40 && c <= 47) s.bg = c - 40;
          else if (c >= 100 && c <= 107) s.bg = c - 100 + 8;
          else if ((c === 38 || c === 48) && codes[i + 1] === 5 && codes[i + 2] <= 255 && codes[i + 2] >= 0) {
            s[c === 38 ? 'fg' : 'bg'] = codes[i + 2]; i += 2;
          } else if ((c === 38 || c === 48) && codes[i + 1] === 2 && codes.slice(i + 2, i + 5).length === 3 && codes.slice(i + 2, i + 5).every(x => x >= 0 && x <= 255)) {
            s[c === 38 ? 'fg' : 'bg'] = `rgb(${codes.slice(i + 2, i + 5).join(',')})`; i += 4;
          }
        }
        // Reuse a style object across chunks so Persian text coalesces into one span.
        const key = JSON.stringify(s);
        state.style = JSON.stringify(state.style) === key ? state.style : Object.freeze(s);
      } else if (final === 'K' && /^(0|1|2)?$/.test(params)) {
        const line = this.lines[this.row];
        const old = line.length;
        if (!params || params === '0') line.splice(this.cursor);
        else if (params === '2') {
          line.length = 0;
          // Keep cursor position. put() fills the gap when the next text arrives.
        } else {
          for (let i = 0; i <= Math.min(this.cursor, line.length - 1); i++) line[i] = { text: ' ', style: DEFAULT, stream: 'stdout' };
        }
        this.cells += line.length - old;
      } else if ((final === 'A' || final === 'B') && /^\d*$/.test(params)) {
        this.row = Math.max(0, Math.min(this.maxLines - 1, this.row + (final === 'A' ? -1 : 1) * Number(params || 1)));
        while (this.lines.length <= this.row) this.lines.push([]);
        this.dirtyFrom = Math.min(this.dirtyFrom, this.row);
      } else if ((final === 'H' || final === 'f') && /^[\d;]*$/.test(params)) {
        const [row, column] = params.split(';').map(n => Number(n || 1));
        if (this.origin === null) this.origin = (row || 1) - 1 - this.row;
        this.row = Math.max(0, Math.min(this.maxLines - 1, (row || 1) - 1 - this.origin));
        this.cursor = Math.max(0, Math.min(this.maxColumns, (column || 1) - 1));
        while (this.lines.length <= this.row) this.lines.push([]);
        this.dirtyFrom = Math.min(this.dirtyFrom, this.row);
      } else if (/^\?(25|12|2004|1004)$/.test(params) && (final === 'h' || final === 'l')) {
        // Cursor visibility/blink, bracketed paste and focus reporting do not change text.
      } else if (final === 'q' && /^[0-6]? $/.test(params)) {
        // Cursor shape has no textual effect.
      } else if ((final === 'C' || final === 'D' || final === 'G') && /^\d*$/.test(params)) {
        const amount = Number(params || 1);
        this.cursor = Math.max(0, Math.min(this.maxColumns, final === 'G' ? amount - 1 : this.cursor + (final === 'C' ? amount : -amount)));
      } else this.unsupported = true;
    }
    rows(start = 0) {
      const keys = new WeakMap();
      return this.lines.slice(start).map(line => {
        const spans = [];
        for (let i = 0; i < line.length; i++) {
          const cell = line[i] || { text: ' ', style: DEFAULT, stream: 'stdout' };
          let styleKey = keys.get(cell.style);
          if (!styleKey) { styleKey = JSON.stringify(cell.style); keys.set(cell.style, styleKey); }
          const key = styleKey + cell.stream;
          const previous = spans[spans.length - 1];
          if (previous && previous.key === key) previous.text += cell.text;
          else spans.push({ key, text: cell.text, style: cell.style, stream: cell.stream });
        }
        return spans;
      });
    }
    text() { return this.lines.map(line => Array.from({ length: line.length }, (_, i) => line[i]?.text || ' ').join('')).join('\n'); }
  }
  const names = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White', 'BrightBlack', 'BrightRed', 'BrightGreen', 'BrightYellow', 'BrightBlue', 'BrightMagenta', 'BrightCyan', 'BrightWhite'];
  const fallbacks = ['#1d2028', '#ef6b73', '#89ca78', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#d5dae2', '#737b8c', '#ff858d', '#a6e395', '#f5d59c', '#84c4ff', '#dfa2f6', '#80d4dc', '#ffffff'];
  function color(value) {
    if (value === null) return '';
    if (typeof value === 'string') return /^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/.test(value) ? value : '';
    if (!Number.isInteger(value) || value < 0 || value > 255) return '';
    if (value < 16) return `var(--vscode-terminal-ansi${names[value]}, ${fallbacks[value]})`;
    if (value < 232) {
      const n = value - 16, component = n => n === 0 ? 0 : 55 + n * 40;
      return `rgb(${component(Math.floor(n / 36))},${component(Math.floor(n / 6) % 6)},${component(n % 6)})`;
    }
    const n = 8 + (value - 232) * 10;
    return `rgb(${n},${n},${n})`;
  }
  return { OutputModel, color };
});
