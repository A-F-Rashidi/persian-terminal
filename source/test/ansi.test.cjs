const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OutputModel, color } = require('../media/ansi.js');

test('split Persian chunks coalesce into a single logical span', () => {
  const m = new OutputModel();
  for (const text of ['س', 'لا', 'م ', 'دن', 'یا؛ ', 'Python 3.12']) m.write(text);
  assert.equal(m.text(), 'سلام دنیا؛ Python 3.12');
  assert.equal(m.rows()[0].length, 1);
});
test('split ANSI sequences and resets retain logical Persian', () => {
  const m = new OutputModel();
  m.write('\x1b[3'); m.write('2mسلام'); m.write('\x1b[0m دنیا');
  assert.equal(m.text(), 'سلام دنیا');
  assert.equal(m.rows()[0][0].style.fg, 2);
  assert.equal(m.rows()[0][1].style.fg, null);
});
test('CR, backspace and erase line replace progress output', () => {
  const m = new OutputModel();
  m.write('100% downloading\rDone\x1b[K\nabc\bX');
  assert.equal(m.text(), 'Done\nabX');
});
test('erase whole line preserves cursor and fills gap', () => {
  const m = new OutputModel(); m.write('abc\x1b[2KX');
  assert.equal(m.text(), '   X'); assert.equal(m.cells, 4);
});
test('OSC title and hyperlink controls are swallowed, labels stay plain text', () => {
  const m = new OutputModel();
  m.write('\x1b]0;title\x07سلام \x1b]8;;https://evil.test\x1b');
  m.write('\\link\x1b]8;;\x1b\\');
  assert.equal(m.text(), 'سلام link');
});
test('DCS and unsupported grid controls do not become printable commands', () => {
  const m = new OutputModel(); m.write('\x1bPbad\x1b\\ok\x1b[2J!');
  assert.equal(m.text(), 'ok!'); assert.equal(m.unsupported, true);
});
test('independent pipe parsers do not consume one another’s escape sequences', () => {
  const m = new OutputModel(); m.write('\x1b[3'); m.write('خطا', 'stderr'); m.write('1mok');
  assert.equal(m.text(), 'خطاok');
  assert.equal(m.rows()[0][1].style.fg, 1);
});
test('256 colors, true color, bold and inverse are parsed', () => {
  const m = new OutputModel(); m.write('\x1b[1;7;38;5;196;48;2;10;20;30mسلام');
  const style = m.rows()[0][0].style;
  assert.equal(style.fg, 196); assert.equal(style.bg, 'rgb(10,20,30)');
  assert.equal(style.bold, true); assert.equal(style.inverse, true);
  assert.equal(color(196), 'rgb(255,0,0)'); assert.equal(color(255), 'rgb(238,238,238)');
  assert.equal(color('url(evil)'), '');
});
test('line and column budgets bound long running logs', () => {
  const m = new OutputModel(3, 200, 5);
  m.write('123456789\na\nb\nc');
  assert.equal(m.text(), 'a\nb\nc'); assert.equal(m.lines.length, 3);
  assert.equal(m.truncated, true);
});
test('HTML remains literal logical text and tabs expand', () => {
  const m = new OutputModel(); m.write('<img onerror="evil()">\nA\tB');
  assert.equal(m.text(), '<img onerror="evil()">\nA       B');
});
test('overlong CSI payload is discarded without unbounded memory', () => {
  const m = new OutputModel(); m.write('\x1b[' + '1;'.repeat(100000) + 'mسلام');
  assert.equal(m.text(), 'سلام'); assert.equal(m.unsupported, true);
  assert.ok(m.stream('stdout').control.length < 257);
});
test('dirty rendering only revisits the unfinished line', () => {
  const m = new OutputModel(); m.write('one\ntwo'); m.dirtyFrom = Infinity;
  m.write('!'); assert.equal(m.dirtyFrom, 1);
  assert.equal(m.rows(1)[0][0].text, 'two!');
});
