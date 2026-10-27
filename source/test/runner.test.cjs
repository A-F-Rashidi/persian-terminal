const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { CommandRunner, resolveShell, shellArgs } = require('../out/runner.js');
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const jsCommand = code => `${quote(process.execPath)} -e ${quote(code)}`;
const shell = { kind: 'sh', executable: '/bin/sh' };
function execute(command, options = {}) {
  const events = [];
  let runner;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { runner.dispose(); reject(new Error('Command timed out')); }, 5000);
    runner = new CommandRunner(event => {
      events.push(event);
      options.onEvent?.(event, runner);
      if (event.type === 'exit') { clearTimeout(timer); resolve(events); }
    });
    runner.start(options.shell || shell, command, options.cwd || process.cwd());
  });
  return { result, runner };
}
const unix = { skip: process.platform === 'win32' };
test('real shell drains UTF-8 stdout and stderr before reporting exit', unix, async () => {
  const code = `const b=Buffer.from('سلام دنیا 😀');for(let i=0;i<b.length;i++)process.stdout.write(b.subarray(i,i+1));process.stderr.write('خطا');process.exitCode=7;`;
  const { result } = execute(jsCommand(code)); const events = await result;
  assert.equal(events.filter(e => e.type === 'data' && e.stream === 'stdout').map(e => e.data).join(''), 'سلام دنیا 😀');
  assert.equal(events.filter(e => e.type === 'data' && e.stream === 'stderr').map(e => e.data).join(''), 'خطا');
  assert.equal(events.at(-1).type, 'exit'); assert.equal(events.at(-1).code, 7);
});
test('folder with spaces and Persian letters is the actual working directory', unix, async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'مسیر اجرا '));
  try {
    const events = await execute('pwd', { cwd }).result;
    assert.equal(events.filter(e => e.type === 'data').map(e => e.data).join('').trim(), cwd);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
test('stdin lines and EOF reach a real process', unix, async () => {
  const { result, runner } = execute(jsCommand(`process.stdin.setEncoding('utf8');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(s));`));
  runner.input('سلام\n'); runner.eof();
  const events = await result;
  assert.equal(events.filter(e => e.type === 'data').map(e => e.data).join(''), 'سلام\n');
});
test('stop interrupts the process group and reports stopped', unix, async () => {
  let stopSent = false;
  const { result } = execute(jsCommand(`process.stdout.write('ready');setInterval(()=>{},1000);`), {
    onEvent(event, runner) { if (!stopSent && event.type === 'data') { stopSent = true; runner.stop(); } }
  });
  const events = await result; assert.equal(events.at(-1).stopped, true);
});
test('a missing shell yields an error and a closed command', unix, async () => {
  const events = await execute('echo x', { shell: { kind: 'sh', executable: '/this-shell-does-not-exist' } }).result;
  assert.equal(events[0].type, 'error'); assert.equal(events.at(-1).type, 'exit');
});
test('concurrent commands are rejected', unix, async () => {
  const { runner, result } = execute(jsCommand('process.stdin.resume()'));
  assert.throws(() => runner.start(shell, 'echo second', process.cwd()), /already running/);
  runner.eof(); await result;
});
test('PowerShell command is encoded losslessly with UTF-8 setup', () => {
  const args = shellArgs({ kind: 'powershell', executable: 'powershell.exe' }, `Write-Output 'سلام دنیا'`);
  const decoded = Buffer.from(args.at(-1), 'base64').toString('utf16le');
  assert.ok(decoded.includes(`Write-Output 'سلام دنیا'`));
  assert.ok(decoded.includes('[Console]::OutputEncoding'));
  assert.ok(!args.includes('-ExecutionPolicy'));
});
test('auto shell resolution and explicit overrides are deterministic', () => {
  assert.equal(resolveShell('auto', '', 'linux', { SHELL: '/bin/bash' }).kind, 'bash');
  assert.equal(resolveShell('auto', '', 'win32', {}).kind, 'powershell');
  assert.equal(resolveShell('pwsh', '/custom/pwsh').executable, '/custom/pwsh');
  assert.throws(() => resolveShell('cmd'), /Unsupported/);
});

test('PowerShell suppresses progress before any module initialization without hiding errors', () => {
  const args = shellArgs({ kind: 'powershell', executable: 'powershell.exe' }, 'Write-Error test');
  const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
  assert.ok(script.startsWith("$ProgressPreference = 'SilentlyContinue'"));
  assert.ok(!script.includes('New-Object'));
  assert.ok(!script.includes('$ErrorActionPreference'));
  assert.equal(args[args.indexOf('-OutputFormat') + 1], 'Text');
});
test('direct Python execution supports Persian paths, stdin, stdout and errors', unix, async () => {
  const { writeFile } = require('node:fs/promises');
  const cwd = await mkdtemp(path.join(tmpdir(), 'پایتون '));
  const file = path.join(cwd, "فایل ' $test.py");
  try {
    await writeFile(file, "import sys\nprint('سلام دنیا')\nprint(input())\nprint('خطای نمونه', file=sys.stderr)\nsys.exit(3)\n");
    const events = [];
    await new Promise((resolve, reject) => {
      const runner = new CommandRunner(event => { events.push(event); if(event.type === 'exit') { clearTimeout(timer); resolve(); } });
      const timer = setTimeout(() => { runner.dispose(); reject(new Error('Python timed out')); }, 5000);
      runner.startProcess('python3', ['-u', file], cwd);
      runner.input('امیر\n');
    });
    assert.equal(events.filter(e => e.type === 'data' && e.stream === 'stdout').map(e => e.data).join(''), 'سلام دنیا\nامیر\n');
    assert.equal(events.filter(e => e.type === 'data' && e.stream === 'stderr').map(e => e.data).join(''), 'خطای نمونه\n');
    assert.equal(events.at(-1).code, 3);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
