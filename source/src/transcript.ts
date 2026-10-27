export type TranscriptEvent =
  | { type: 'start'; id: number; command: string; title?: string; cwd: string; shell: string; at: number }
  | { type: 'data'; id: number; stream: 'stdout' | 'stderr'; data: string }
  | { type: 'input'; id: number; text: string }
  | { type: 'error'; id: number; message: string }
  | { type: 'exit'; id: number; code: number | null; signal: string | null; stopped: boolean; duration: number };
export interface Entry { seq: number; event: TranscriptEvent; }

/** Bounded replay for hidden/disposed webviews; command history is never saved to disk. */
export class Transcript {
  private entries: { entry: Entry; size: number }[] = [];
  private size = 0;
  private sequence = 0;
  constructor(private readonly limit = 1_000_000, private readonly maxEntries = 4000) {}
  get seq(): number { return this.sequence; }
  append(event: TranscriptEvent): void {
    const size = JSON.stringify(event).length;
    this.entries.push({ entry: { seq: ++this.sequence, event }, size });
    this.size += size;
    while (this.size > this.limit || this.entries.length > this.maxEntries) {
      this.size -= this.entries.shift()!.size;
    }
  }
  clear(): void { this.entries = []; this.size = 0; this.sequence++; }
  readAfter(after: number): { reset: boolean; entries: Entry[]; seq: number } {
    const first = this.entries[0]?.entry.seq ?? this.sequence + 1;
    return { reset: after < first - 1, entries: this.entries.filter(x => x.entry.seq > after).map(x => x.entry), seq: this.sequence };
  }
}
