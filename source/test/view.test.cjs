const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createHost, until } = require('./host.cjs');
function fixture() {
  const host = createHost(), sent = [], errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(host.view.webview.html, { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  w.acquireVsCodeApi = () => ({ postMessage: message => sent.push(message) });
  for (const script of ['ansi.js', 'view.js']) w.eval(fs.readFileSync(path.join(host.root, 'media', script), 'utf8'));
  const post = data => w.dispatchEvent(new w.MessageEvent('message', { data }));
  return {
    w, doc: w.document, sent, errors, post,
    events(events, reset = true) { post({ type: 'events', reset, entries: events.map((event, i) => ({ seq: i + 1, event })) }); },
    close() { w.close(); host.dispose(); }
  };
}
const start = { type: 'start', id: 1, command: 'python demo.py', cwd: '/project', shell: 'bash' };
const chunk = data => ({ type: 'data', id: 1, stream: 'stdout', data });

test('DOM coalesces split Persian and keeps hostile HTML literal; copy uses logical text', async () => {
  const f = fixture();
  try {
    f.events([start, chunk('س'), chunk('لام دنیا\n\x1b[32mموفق\x1b[0m\n<img onerror="evil()">')]);
    await until(() => f.doc.querySelector('.line'));
    const first = f.doc.querySelector('.line');
    assert.equal(first.textContent, 'سلام دنیا'); assert.equal(first.children.length, 1);
    assert.equal(first.dir, 'rtl');
    assert.equal(f.doc.querySelectorAll('.run-lines img').length, 0);
    f.doc.getElementById('copy').click();
    const text = f.sent.find(m => m.type === 'copy').text;
    assert.ok(text.includes('سلام دنیا')); assert.ok(text.includes('<img onerror="evil()">'));
    assert.ok(!text.includes('\x1b'));
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});
test('DOM input sends run, history, stdin, EOF and stop through typed messages', () => {
  const f = fixture();
  try {
    const input = f.doc.getElementById('command');
    input.value = 'echo test';
    input.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.ok(f.sent.some(m => m.type === 'run' && m.command === 'echo test'));
    f.post({ type: 'state', busy: false, shell: 'bash', cwd: '/project' });
    input.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    assert.equal(input.value, 'echo test');
    f.post({ type: 'state', busy: true, shell: 'bash', cwd: '/project' });
    input.value = 'سلام';
    input.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.ok(f.sent.some(m => m.type === 'stdin' && m.text === 'سلام\n'));
    f.doc.getElementById('eof').click(); f.doc.getElementById('stop').click();
    assert.ok(f.sent.some(m => m.type === 'eof')); assert.ok(f.sent.some(m => m.type === 'stop'));
    assert.equal(input.dir, 'ltr');
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});
test('DOM bounds long output, clears it and displays command exit status', async () => {
  const f = fixture();
  try {
    f.post({ type: 'state', busy: false, shell: 'bash', cwd: '/project', maxLines: 100 });
    f.events([start, chunk('سلام دنیا\n'.repeat(10000)), { type: 'exit', id: 1, code: 7, stopped: false, duration: 100 }]);
    await until(() => f.doc.querySelector('.line'));
    assert.ok(f.doc.querySelectorAll('.line').length <= 100);
    assert.equal(f.doc.querySelector('.output-warning').hidden, false);
    assert.match(f.doc.querySelector('.run-footer').textContent, /7/);
    assert.ok(f.doc.querySelector('.run-footer').classList.contains('failed'));
    f.events([]);
    await until(() => !f.doc.querySelector('.run'));
    assert.equal(f.doc.getElementById('welcome').hidden, false);
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('compact Python header keeps full command accessible and preserves literal output when copied', async () => {
  const f = fixture();
  try {
    const command = '"C:\\Users\\amir\\.venv\\Scripts\\python.exe" -u "C:\\project\\test.py"';
    const text = 'd8b3d984d8a7d985\nسلام خوبی؟\n18\n';
    f.events([{ ...start, command, title: 'test.py', shell: 'python' }, chunk(text), { type: 'exit', id: 1, code: 0, stopped: false, duration: 60 }]);
    await until(() => f.doc.querySelector('.line'));
    assert.equal(f.doc.querySelector('.run-command').textContent, 'test.py');
    assert.equal(f.doc.querySelector('.run-details').open, false);
    assert.equal(f.doc.querySelector('.run-details').hidden, false);
    assert.equal(f.doc.querySelector('.full-command').textContent, command);
    assert.equal(f.doc.querySelectorAll('.line').length, 3);
    assert.equal(f.doc.querySelectorAll('.has-persian').length, 1);
    assert.equal(f.doc.querySelector('.has-persian').textContent, 'سلام خوبی؟');
    assert.match(f.doc.querySelector('.run-footer').textContent, /با موفقیت اجرا شد/);
    f.doc.getElementById('copy').click();
    assert.ok(f.sent.find(m => m.type === 'copy').text.includes(text));
  } finally { f.close(); }
});

test('Persian and mixed lines are RTL while ASCII output and copied characters remain intact', async () => {
  const f = fixture();
  try {
    const text = 'سلام دنیا\n[INFO] فایل report.py آماده است: 42\nPython 3.13\n18\n';
    f.events([start, chunk(text), { type: 'exit', id: 1, code: 0, stopped: false, duration: 20 }]);
    await until(() => f.doc.querySelector('.line'));
    const lines = [...f.doc.querySelectorAll('.line')];
    assert.deepEqual(lines.map(line => line.dir), ['rtl', 'rtl', 'auto', 'auto']);
    assert.equal(lines.map(line => line.textContent).join('\n') + '\n', text);
    assert.equal(f.doc.querySelector('.run-footer').parentElement.className, 'run-header');
    f.doc.getElementById('copy').click();
    assert.ok(f.sent.find(m => m.type === 'copy').text.endsWith(text));
    assert.equal(f.doc.getElementById('command').dir, 'ltr');
  } finally { f.close(); }
});

test('search spans ANSI colors without changing copy/export text; settings send validated choices',async()=>{
 const f=fixture();try{
  f.events([start,chunk('سلا\x1b[32mم دنیا\x1b[0m\nسلام دنیا\n')]);await until(()=>f.doc.querySelector('.line'));
  f.doc.getElementById('search-toggle').click();
  const query=f.doc.getElementById('search-query');query.value='سلام دنیا';query.dispatchEvent(new f.w.Event('input'));
  assert.equal(f.doc.getElementById('search-status').textContent,'1 / 2');assert.equal(f.doc.querySelectorAll('mark.current').length,2);
  f.doc.getElementById('search-next').click();assert.equal(f.doc.getElementById('search-status').textContent,'2 / 2');
  f.doc.querySelector('.run-actions button').click();assert.equal(f.sent.at(-1).text,'سلام دنیا\nسلام دنیا\n');
  f.doc.querySelectorAll('.run-actions button')[1].click();assert.equal(f.sent.at(-1).type,'save');assert.equal(f.sent.at(-1).text,'سلام دنیا\nسلام دنیا\n');
  f.doc.getElementById('density').value='comfortable';f.doc.getElementById('density').dispatchEvent(new f.w.Event('change'));
  assert.equal(f.sent.at(-1).key,'density');assert.equal(f.sent.at(-1).value,'comfortable');
  f.doc.getElementById('search-close').click();assert.equal(f.doc.querySelectorAll('mark').length,0);
 }finally{f.close();}
});
test('switching tabs preserves separate input drafts and applies display preferences',()=>{
 const f=fixture();try{
  const tabs=[{id:1,name:'اول',shell:'bash',busy:false},{id:2,name:'دوم',shell:'sh',busy:true}];
  f.post({type:'state',tabId:1,tabs,busy:false,density:'compact',persianAlignment:'right'});
  f.doc.getElementById('command').value='echo first';
  f.post({type:'state',tabId:2,tabs,busy:true,density:'comfortable',persianAlignment:'left',fontSize:18});
  assert.equal(f.doc.getElementById('command').value,'');f.doc.getElementById('command').value='input second';
  f.post({type:'state',tabId:1,tabs,busy:false,density:'comfortable',persianAlignment:'left'});
  assert.equal(f.doc.getElementById('command').value,'echo first');
  assert.equal(f.doc.documentElement.dataset.density,'comfortable');assert.equal(f.doc.documentElement.dataset.alignment,'left');
  f.doc.getElementById('new-tab').click();assert.equal(f.sent.at(-1).type,'newTab');
  f.doc.querySelectorAll('.tab-select')[1].click();assert.equal(f.sent.at(-1).target,2);
 }finally{f.close();}
});

test('notifications close softly and a new message cancels a pending hide', async () => {
  const f = fixture();
  try {
    f.post({ type: 'notice', text: '<path>' + 'x'.repeat(1000) });
    const box = f.doc.getElementById('notice');
    assert.equal(box.hidden, false);
    assert.equal(box.querySelector('path'), null);
    f.doc.getElementById('notice-close').click();
    assert.equal(box.hidden, false);
    assert.ok(box.classList.contains('leaving'));
    f.post({ type: 'notice', text: 'پیام جدید' });
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.equal(box.hidden, false);
    assert.equal(f.doc.getElementById('notice-text').textContent, 'پیام جدید');
    f.doc.getElementById('notice-close').click();
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.equal(box.hidden, true);
  } finally { f.close(); }
});

test('notice expires after five seconds even while hovered or focused and aligns with input', async () => {
  const f = fixture();
  try {
    f.doc.querySelector('.input-row').getBoundingClientRect = () => ({ right: 900, top: 600, width: 800 });
    const original = f.w.setTimeout;
    let expire;
    f.w.setTimeout = (fn, ms) => ms === 5000 ? (expire = fn, 12345) : original(fn, ms);
    f.post({ type: 'notice', text: 'هشدار' });
    const box = f.doc.getElementById('notice');
    assert.equal(box.style.right, (f.w.innerWidth - 900) + 'px');
    assert.equal(box.style.maxWidth, '360px');
    box.dispatchEvent(new f.w.Event('mouseenter'));
    box.dispatchEvent(new f.w.Event('focusin'));
    assert.equal(typeof expire, 'function');
    expire();
    assert.ok(box.classList.contains('leaving'));
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.equal(box.hidden, true);
  } finally { f.close(); }
});

test('interactive replies stay between prompts while copy retains actual program output', async () => {
  const f = fixture();
  try {
    f.events([start, chunk('اهل کجایی؟'), { type: 'input', id: 1, text: 'تبریز\n' },
      chunk('رنگ؟'), { type: 'input', id: 1, text: '<سبز>\n' }, chunk('نتیجه\n'),
      { type: 'exit', id: 1, code: 0, duration: 10 }]);
    await until(() => f.doc.querySelectorAll('.input-echo').length === 2 && f.doc.querySelectorAll('.line').length === 3);
    assert.deepEqual([...f.doc.querySelectorAll('.input-echo-value')].map(x => x.textContent), ['تبریز', '<سبز>']);
    assert.deepEqual([...f.doc.querySelectorAll('.line')].map(x => x.textContent), ['اهل کجایی؟', 'رنگ؟', 'نتیجه']);
    assert.equal(f.doc.querySelector('.input-echo-value').children.length, 0);
    f.doc.querySelector('.run-actions button').click();
    assert.equal(f.sent.find(x => x.type === 'copy').text, 'اهل کجایی؟رنگ؟نتیجه\n');
    assert.equal(f.doc.querySelector('.input-note'), null);
    f.events([start, chunk('پرسش'), { type: 'input', id: 1, text: '\n' }]);
    await until(() => f.doc.querySelector('.input-echo-value')?.textContent === '⏎');
  } finally { f.close(); }
});

test('directory context shows filename and clears it for shell commands', () => {
 const f=fixture();try {
  f.post({type:'state',cwd:'/project',fileName:'نمونه.py',shell:'powershell',busy:true});
  assert.equal(f.doc.getElementById('active-file').textContent,'نمونه.py');
  assert.equal(f.doc.getElementById('active-file').hidden,false);
  f.post({type:'state',cwd:'/project',fileName:'',shell:'powershell',busy:false});
  assert.equal(f.doc.getElementById('active-file').hidden,true);
 } finally {f.close();}
});

test('prompts have no output caption; only text after the last answer is labeled when finished', async()=>{
 const f=fixture();try{
  f.events([start,chunk('شهر؟'),{type:'input',id:1,text:'تبریز\n'},chunk('رنگ؟'),
   {type:'input',id:1,text:'سبز\n'},chunk('از تبریز رنگ سبز رو دوست داره')]);
  await until(()=>f.doc.querySelectorAll('.input-echo').length===2);
  assert.equal(f.doc.querySelectorAll('.run-lines[data-label]').length,0);
  f.events([{type:'exit',id:1,code:0,duration:10}],false);
  await until(()=>f.doc.querySelector('.run-lines[data-label]')?.textContent === 'از تبریز رنگ سبز رو دوست داره');
  assert.equal(f.doc.querySelectorAll('.run-lines[data-label]').length,1);
  assert.equal(f.doc.querySelector('.run-lines[data-label]').textContent,'از تبریز رنگ سبز رو دوست داره');
 }finally{f.close();}
});

test('display output preservation switch sends booleans and follows saved state',()=>{
 const f=fixture();try{
  const toggle=f.doc.getElementById('preserve-output');
  f.post({type:'state',preserveOutput:true});assert.equal(toggle.checked,true);
  toggle.click();assert.ok(f.sent.some(m=>m.type==='display'&&m.key==='preserveOutput'&&m.value===false));
  f.post({type:'state',preserveOutput:false});assert.equal(toggle.checked,false);
  toggle.click();assert.ok(f.sent.some(m=>m.type==='display'&&m.key==='preserveOutput'&&m.value===true));
 }finally{f.close();}
});
