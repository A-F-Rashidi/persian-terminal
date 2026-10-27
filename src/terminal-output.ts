/** Removes our startup boundary and an exact, immediate terminal input echo. */
export class TerminalOutput {
  private started = false;
  private pending = '';
  private echo = '';
  constructor(private marker: string) {}
  expectInput(text: string): void { this.echo += text.replace(/\r\n/g, '\n'); }
  write(data: string): string {
    this.pending += data;
    if (!this.started) {
      const at = this.pending.indexOf(this.marker);
      if (at < 0) {
        if (this.pending.length > 131072) this.pending = this.pending.slice(-this.marker.length);
        return '';
      }
      this.pending = this.pending.slice(at + this.marker.length); this.started = true;
    }
    if (this.echo) {
      // Compare visible characters while retaining original offsets. ConPTY can
      // interleave cursor movement, colors and OSC metadata with echoed input.
      let normalized = '';
      const ends: number[] = [];
      for (let i = 0; i < this.pending.length;) {
        if (this.pending[i] === '\x1b') {
          const rest = this.pending.slice(i);
          const control = /^(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\))/.exec(rest);
          if (!control) break;
          i += control[0].length; continue;
        }
        if (this.pending[i] === '\r') { i++; continue; }
        normalized += this.pending[i++];
        ends.push(i);
        if (normalized.length >= this.echo.length) break;
      }
      if (normalized.startsWith(this.echo)) {
        this.pending = this.pending.slice(ends[this.echo.length - 1]);
      } else if (this.echo.startsWith(normalized) && this.pending.length < 131072) return '';
      this.echo = '';
    }
    const output = this.pending; this.pending = ''; return output;
  }
  end(): string {
    if (!this.started) return '';
    const pending = this.pending; this.pending = '';
    if (pending.replace(/\r\n/g, '\n') === this.echo) { this.echo = ''; return ''; }
    return pending;
  }
}
