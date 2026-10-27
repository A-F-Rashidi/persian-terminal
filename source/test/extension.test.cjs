const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHost, until } = require('./host.cjs');
test('host exposes a nonce CSP, restricted local roots and a bottom-panel contribution', () => {
  const host = createHost();
  try {
    assert.match(host.view.webview.html, /default-src 'none'/);
    assert.match(host.view.webview.html, /script-src 'nonce-[a-f0-9]+'/);
    assert.equal(host.view.webview.options.localResourceRoots.length, 1);
    const manifest = require('../package.json');
    assert.equal(manifest.contributes.viewsContainers.panel[0].id, 'persianTerminal');
    assert.equal(manifest.contributes.views.persianTerminal[0].type, 'webview');
    assert.equal(manifest.capabilities.untrustedWorkspaces.supported, false);
  } finally { host.dispose(); }
});
test('real output reaches webview messages and is replayed after hiding', { skip: process.platform === 'win32' }, async () => {
  const host = createHost();
  try {
    host.send({ type: 'ready' });
    host.send({ type: 'run', command: `printf 'سلام دنیا\\n'` });
    await until(() => host.sent.some(m => m.type === 'events' && m.entries.some(e => e.event.type === 'exit')));
    const events = host.sent.filter(m => m.type === 'events').flatMap(m => m.entries.map(e => e.event));
    assert.equal(events.find(e => e.type === 'data').data, 'سلام دنیا\n');
    assert.equal(events.find(e => e.type === 'exit').code, 0);
    host.setVisible(false); host.send({ type: 'run', command: 'printf hidden' });
    await until(() => host.provider.active.log.readAfter(-1).entries.some(e => e.event.type === 'exit' && e.event.id === 2));
    host.setVisible(true);
    assert.ok(host.sent.at(-2).entries.some(e => e.event.data === 'hidden'));
  } finally { host.dispose(); }
});
test('untrusted workspaces cannot execute messages', async () => {
  const host = createHost();
  try {
    host.mock.workspace.isTrusted = false;
    host.send({ type: 'run', command: 'echo should-not-run' });
    await until(() => host.sent.some(m => m.type === 'notice'));
    assert.equal(host.provider.active.session.busy, false);
    assert.ok(!host.sent.some(m => m.type === 'events' && m.entries.some(e => e.event.type === 'start')));
  } finally { host.dispose(); }
});
test('host validates malformed messages and clears replay', () => {
  const host = createHost();
  try {
    for (const message of [null, [], 4, 'run', { type: 'run', command: {} }]) host.send(message);
    host.send({ type: 'clear' });
    const events = host.sent.find(m => m.type === 'events');
    assert.equal(events.reset, true); assert.deepEqual(events.entries, []);
  } finally { host.dispose(); }
});

test('Python Run menu uses selected interpreter, saves file and quotes its path for the selected shell', async () => {
  const host = createHost();
  try {
    let saved = false;
    const uri = host.mock.Uri.file('/tmp/فایل تست\' $x.py'); uri.scheme = 'file';
    host.mock.workspace.openTextDocument = async () => ({ uri, languageId: 'python', isDirty: true, save: async () => { saved = true; return true; } });
    host.mock.workspace.getWorkspaceFolder = () => ({ uri: host.mock.Uri.file(host.root) });
    host.mock.extensions = { getExtension: () => ({ activate: async () => ({ settings: { getExecutionDetails: scope => { assert.equal(scope, uri); return { execCommand: ['/venv path/python', '-X', 'utf8'] }; } } }) }) };
    let launched;
    host.provider.active.checked = true;
    host.provider.active.session.execute = command => { launched = command; };
    await host.commands.get('persianTerminal.runPythonFile')(uri);
    assert.ok(saved);
    const { invocation } = require('../out/session');
    assert.equal(launched, "cd -- '" + host.root + "' && " + invocation('/venv path/python', ['-X', 'utf8', '-u', uri.fsPath], host.provider.active.shell));
    const menus = require('../package.json').contributes.menus;
    assert.equal(menus['editor/title/run'][0].command, 'persianTerminal.runPythonFile');
  } finally { host.dispose(); }
});
test('Python Run refuses untrusted workspace before opening or saving files', async () => {
  const host = createHost();
  try { host.mock.workspace.isTrusted = false; await assert.rejects(host.provider.runPythonFile(), /اعتماد به پوشه پروژه/); }
  finally { host.dispose(); }
});
test('Python Run cancels when saving fails', async () => {
  const host = createHost();
  try {
    const uri = host.mock.Uri.file('/tmp/changed.py');
    host.mock.workspace.openTextDocument = async () => ({ uri, languageId: 'python', isDirty: true, save: async () => false });
    await host.provider.runPythonFile(uri);
    assert.equal(host.provider.active.id, 0);
  } finally { host.dispose(); }
});

test('standalone clear aliases clear transcript and webview without starting a shell', async () => {
  const host = createHost();
  try {
    host.provider.active.session.execute = () => { throw new Error('clear must not launch a shell'); };
    for (const command of ['cls', 'clear', ' CLS ', '\nClear-Host\t', 'CLEAR']) {
      host.provider.active.log.append({ type: 'data', id: 1, stream: 'stdout', data: 'سلام' });
      await host.provider.receive({ type: 'run', command });
      assert.deepEqual(host.provider.active.log.readAfter(-1).entries, []);
      const reset = host.sent.filter(m => m.type === 'events').at(-1);
      assert.equal(reset.reset, true);
      assert.deepEqual(reset.entries, []);
      assert.equal(host.provider.active.session.busy, false);
    }
    host.setVisible(false);
    host.provider.active.log.append({ type: 'data', id: 1, stream: 'stdout', data: 'old' });
    await host.provider.receive({ type: 'run', command: 'clear' });
    host.setVisible(true);
    assert.deepEqual(host.sent.filter(m => m.type === 'events').at(-1).entries, []);
  } finally { host.dispose(); }
});
test('clear words inside other commands or stdin are preserved literally', async () => {
  const host = createHost();
  try {
    const commands = [], inputs = [];
    host.provider.active.checked = true;
    host.provider.active.session.execute = (command) => commands.push(command);
    host.provider.active.session.input = text => inputs.push(text);
    for (const command of ['echo clear', 'clear; echo hello', 'printf cls']) {
      await host.provider.receive({ type: 'run', command });
    }
    Object.defineProperty(host.provider.active.session, 'busy', { get: () => true });
    await host.provider.receive({ type: 'stdin', text: 'clear\n' });
    assert.deepEqual(commands, ['echo clear', 'clear; echo hello', 'printf cls']);
    assert.deepEqual(inputs, ['clear\n']);
  } finally { host.dispose(); }
});

test('tabs execute concurrently, preserve independent variables and clear without resetting shell', { skip: process.platform === 'win32' }, async () => {
  const host=createHost();
  try {
    const first=host.provider.active;
    await host.provider.receive({type:'run',tabId:first.key,command:'export PT_TAB=first'});
    await until(()=>!first.session.busy);
    await host.provider.receive({type:'newTab'}); const second=host.provider.active;
    await host.provider.receive({type:'run',command:'export PT_TAB=second; sleep 0.1; printf second'});
    await host.provider.receive({type:'switchTab',target:first.key});
    await host.provider.receive({type:'clear'});
    await host.provider.receive({type:'run',command:'printf "$PT_TAB"'});
    await until(()=>!first.session.busy&&!second.session.busy);
    assert.equal(first.log.readAfter(-1).entries.filter(e=>e.event.type==='data').map(e=>e.event.data).join(''),'first');
    assert.equal(second.log.readAfter(-1).entries.filter(e=>e.event.type==='data').map(e=>e.event.data).join(''),'second');
    await host.provider.receive({type:'closeTab',tabId:second.key});
    assert.equal(host.provider.tabs.size,1); assert.ok(first.session.alive);
  } finally {host.dispose();}
});
test('display preferences validate values; export writes UTF-8 only to chosen destination', async()=>{
  const host=createHost();
  try {
    await host.provider.receive({type:'display',key:'density',value:'comfortable'});
    await host.provider.receive({type:'display',key:'fontSize',value:18});
    await host.provider.receive({type:'display',key:'fontSize',value:999});
    await host.provider.receive({type:'display',key:'shellPath',value:'/malicious'});
    assert.equal(host.settings.fontSize,18);assert.equal(host.settings.density,'comfortable');assert.equal(host.settings.shellPath,'');
    const writes=[];host.mock.workspace.fs={writeFile:async(uri,bytes)=>writes.push([uri,Buffer.from(bytes).toString('utf8')])};
    host.mock.window.showSaveDialog=async()=>undefined;
    await host.provider.receive({type:'save',text:'سلام'});assert.equal(writes.length,0);
    const target=host.mock.Uri.file('/chosen/output.txt');host.mock.window.showSaveDialog=async()=>target;
    await host.provider.receive({type:'save',text:'سلام\n42',runId:1});assert.deepEqual(writes,[[target,'سلام\n42']]);
  }finally{host.dispose();}
});
test('closing the last tab keeps the verified shell for the replacement tab', {skip:process.platform==='win32'}, async()=>{
 const host=createHost();try{
  await host.provider.ensureAvailable(host.provider.active);
  const chosen=host.provider.active.shell;
  host.settings.shell='zsh';host.settings.shellPath='/missing-shell';
  await host.provider.receive({type:'closeTab'});
  assert.deepEqual(host.provider.active.shell,chosen);
 }finally{host.dispose();}
});

test('submitted input is replayed between prompt and result; idle input is ignored', async () => {
  const host = createHost();
  try {
    await host.provider.receive({ type: 'stdin', text: 'ignored\n' });
    assert.equal(host.provider.active.log.readAfter(-1).entries.length, 0);
    await host.provider.receive({ type: 'run', command: 'printf "Name?"; read name; printf "Hello %s\\n" "$name"' });
    await until(() => host.provider.active.log.readAfter(-1).entries.some(e => e.event.type === 'data' && e.event.data.includes('Name?')));
    await host.provider.receive({ type: 'stdin', text: 'Amir\n' });
    await until(() => !host.provider.active.session.busy);
    const events = host.provider.active.log.readAfter(-1).entries.map(x => x.event);
    const index = events.findIndex(e => e.type === 'input');
    assert.equal(events[index].text, 'Amir\n');
    assert.ok(events.slice(index + 1).some(e => e.type === 'data' && e.data.includes('Hello Amir')));
  } finally { host.dispose(); }
});

test('Python without a workspace runs in its file folder and reports matching cwd', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const host = createHost();
  const dir = fs.mkdtempSync(path.join(host.root, 'cwd test '));
  try {
    const file = path.join(dir, 'sample.py');
    fs.writeFileSync(file, 'import os\nprint(os.getcwd())\n');
    const uri = host.mock.Uri.file(file); uri.scheme = 'file';
    host.mock.workspace.openTextDocument = async () => ({ uri, languageId: 'python', isDirty: false });
    host.mock.workspace.getWorkspaceFolder = () => undefined;
    host.mock.extensions = { getExtension: () => ({ activate: async () => ({ settings: { getExecutionDetails: () => ({ execCommand: ['python3'] }) } }) }) };
    await host.provider.runPythonFile(uri);
    await until(() => !host.provider.active.session.busy);
    assert.equal(host.provider.active.cwd, dir);
    const events = host.provider.active.log.readAfter(-1).entries.map(e => e.event);
    assert.equal(events.find(e => e.type === 'start').cwd, dir);
    assert.ok(events.filter(e => e.type === 'data').map(e => e.data).join('').includes(dir));
    assert.equal(events.find(e => e.type === 'exit').code, 0);
  } finally { host.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rerunning Python closes a waiting session and starts fresh in the same tab', async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const host=createHost(), file=path.join(host.root,'rerun-test.py');
 try{
  fs.writeFileSync(file,"print('fresh run')\n");
  const uri=host.mock.Uri.file(file);uri.scheme='file';
  host.mock.workspace.openTextDocument=async()=>({uri,languageId:'python',isDirty:false});
  host.mock.workspace.getWorkspaceFolder=()=>({uri:host.mock.Uri.file(host.root)});
  host.mock.extensions={getExtension:()=>({activate:async()=>({settings:{getExecutionDetails:()=>({execCommand:['python3']})}})})};
  await host.provider.receive({type:'run',command:'printf waiting; read answer'});
  const before=host.provider.active.session,key=host.provider.active.key;
  await until(()=>before.busy);
  await host.provider.runPythonFile(uri);
  assert.notEqual(host.provider.active.session,before);
  assert.equal(host.provider.active.key,key);
  await until(()=>!host.provider.active.session.busy&&!before.alive);
  const events=host.provider.active.log.readAfter(-1).entries.map(e=>e.event);
  assert.ok(events.some(e=>e.type==='exit'&&e.id===1&&e.stopped));
  assert.ok(events.some(e=>e.type==='data'&&e.id===2&&e.data.includes('fresh run')));
 }finally{host.dispose();fs.rmSync(file,{force:true});}
});
