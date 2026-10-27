"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transcript = void 0;
/** Bounded replay for hidden/disposed webviews; command history is never saved to disk. */
class Transcript {
    limit;
    maxEntries;
    entries = [];
    size = 0;
    sequence = 0;
    constructor(limit = 1_000_000, maxEntries = 4000) {
        this.limit = limit;
        this.maxEntries = maxEntries;
    }
    get seq() { return this.sequence; }
    append(event) {
        const size = JSON.stringify(event).length;
        this.entries.push({ entry: { seq: ++this.sequence, event }, size });
        this.size += size;
        while (this.size > this.limit || this.entries.length > this.maxEntries) {
            this.size -= this.entries.shift().size;
        }
    }
    clear() { this.entries = []; this.size = 0; this.sequence++; }
    readAfter(after) {
        const first = this.entries[0]?.entry.seq ?? this.sequence + 1;
        return { reset: after < first - 1, entries: this.entries.filter(x => x.entry.seq > after).map(x => x.entry), seq: this.sequence };
    }
}
exports.Transcript = Transcript;
//# sourceMappingURL=transcript.js.map