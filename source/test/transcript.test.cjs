const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Transcript } = require('../out/transcript.js');
const data = text => ({ type: 'data', id: 1, stream: 'stdout', data: text });
test('replay includes exactly unseen events', () => {
  const log = new Transcript(); log.append(data('one')); const first = log.readAfter(0);
  log.append(data('two')); assert.equal(log.readAfter(first.seq).entries[0].event.data, 'two');
  assert.equal(log.readAfter(log.seq).entries.length, 0);
});
test('bounded replay requests a reset after evicting old output', () => {
  const log = new Transcript(200, 2); log.append(data('one')); log.append(data('two')); log.append(data('three'));
  const replay = log.readAfter(0); assert.equal(replay.reset, true); assert.ok(replay.entries.length <= 2);
});
test('clear invalidates pending replay without restoring previous text', () => {
  const log = new Transcript(); log.append(data('secret')); const seq = log.seq; log.clear();
  const replay = log.readAfter(seq); assert.equal(replay.reset, true); assert.deepEqual(replay.entries, []);
});
