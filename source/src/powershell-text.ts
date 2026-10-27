// Decode only PowerShell's marked stderr transport, never arbitrary stdout/XML.
const sax = require('../vendor/sax');
const marker = '#< CLIXML';
function decodeDocument(xml: string): string {
  const parser = sax.parser(true);
  let depth = 0, capture = false, text = '', output = '', unsupported = false;
  parser.ondoctype = () => { throw new Error('Unsupported doctype'); };
  parser.onopentag = (node: { name: string; attributes: Record<string, string> }) => {
    depth++;
    if (depth === 1 && node.name !== 'Objs') { throw new Error('Not CLIXML'); }
    if (depth === 2) {
      capture = node.name === 'S'; text = '';
      // Unknown serialized objects are preserved rather than silently discarded.
      if (!capture) unsupported = true;
    }
  };
  const append = (value: string) => { if (capture) text += value; };
  parser.ontext = append; parser.oncdata = append;
  parser.onclosetag = () => {
    if (depth === 2 && capture) {
      // One pass: escaped underscores must not trigger a second decoding pass.
      output += text.replace(/_x([0-9a-f]{4})_/gi, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      capture = false;
    }
    depth--;
  };
  parser.write(xml).close();
  if (unsupported) throw new Error('Unsupported CLIXML object');
  return output;
}
export class PowerShellTextDecoder {
  private buffer = '';
  private xml = false;
  constructor(private readonly emit: (text: string) => void) {}
  write(data: string): void {
    this.buffer += data;
    while (this.buffer) {
      if (this.xml) {
        const end = this.buffer.indexOf('</Objs>');
        if (end < 0) {
          if (this.buffer.length > 262144) this.flushRaw();
          return;
        }
        const doc = this.buffer.slice(0, end + 7);
        this.buffer = this.buffer.slice(end + 7); this.xml = false;
        try { const decoded = decodeDocument(doc.trim()); if (decoded) this.emit(decoded); }
        catch { this.emit(marker + '\n' + doc); }
        continue;
      }
      const match = /(?:^|\n)#< CLIXML\r?\n/.exec(this.buffer);
      if (match) {
        const prefix = this.buffer.slice(0, match.index) + (match[0].startsWith('\n') ? '\n' : '');
        if (prefix) this.emit(prefix);
        this.buffer = this.buffer.slice(match.index + match[0].length); this.xml = true;
        continue;
      }
      const lastLine = this.buffer.lastIndexOf('\n') + 1;
      const tail = this.buffer.slice(lastLine);
      if (tail && (marker.startsWith(tail) || tail === marker + '\r')) {
        if (lastLine) this.emit(this.buffer.slice(0, lastLine));
        this.buffer = tail; return;
      }
      this.emit(this.buffer); this.buffer = '';
    }
  }
  private flushRaw(): void {
    if (this.buffer || this.xml) this.emit((this.xml ? marker + '\n' : '') + this.buffer);
    this.buffer = ''; this.xml = false;
  }
  end(): void { this.flushRaw(); }
}
