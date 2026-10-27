const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHost } = require('../test/host.cjs');
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');

(async () => {
  const host = createHost();
  const dir = path.join(host.root, 'test-results'); await fs.mkdir(dir, { recursive: true });
  const html = path.join(dir, 'preview.html'); await fs.writeFile(html, host.view.webview.html);
  const extraArgs = process.env.CHROMIUM_SINGLE_PROCESS ? ['--single-process', '--no-zygote', '--disable-gpu'] : [];
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', ...extraArgs] });
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 560 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__sent = [];
      window.acquireVsCodeApi = () => ({ postMessage: message => window.__sent.push(message) });
    });
    await page.goto(pathToFileURL(html).href);
    await page.waitForFunction(() => window.__sent?.some(m => m.type === 'ready'));
    const post = data => page.evaluate(message => window.postMessage(message, '*'), data);
    await post({ type: 'state', busy: false, cwd: '/home/amir/projects/سلام', shell: 'bash', fontFamily: 'DejaVu Sans, monospace', fontSize: 15, maxLines: 100 });
    const entries = [
      { type: 'start', id: 1, command: 'python demo.py', cwd: '/home/amir', shell: 'bash' },
      { type: 'data', id: 1, stream: 'stdout', data: 'س' },
      { type: 'data', id: 1, stream: 'stdout', data: 'لام دنیا؛ این ترمینال فارسی را درست نمایش می‌دهد.\n' },
      { type: 'data', id: 1, stream: 'stdout', data: '\x1b[32mموفق: \x1b[0mفایل report.py با Python 3.12 اجرا شد.\n' },
      { type: 'data', id: 1, stream: 'stderr', data: 'هشدار: فایل config.json پیدا نشد.\n' },
      { type: 'data', id: 1, stream: 'stdout', data: '<img src=x onerror="window.pwned=true">\nDownload 100%\rDone\x1b[K\n' },
      { type: 'exit', id: 1, code: 0, stopped: false, duration: 170 }
    ];
    await post({ type: 'events', reset: true, entries: entries.map((event, i) => ({ seq: i + 1, event })) });
    await page.waitForFunction(() => document.querySelector('.line')?.textContent.startsWith('سلام'));
    assert.equal(await page.locator('.line').first().locator('span').count(), 1);
    assert.equal(await page.locator('.line').first().getAttribute('dir'), 'rtl');
    assert.equal(await page.locator('.line').first().evaluate(n => getComputedStyle(n).unicodeBidi), 'isolate');
    assert.equal(await page.locator('.run-lines img').count(), 0);
    assert.equal(await page.evaluate(() => window.pwned), undefined);
    assert.ok((await page.locator('.run-lines').innerText()).includes('Done'));
    assert.equal(await page.locator('#command').evaluate(n => getComputedStyle(n).direction), 'ltr');
    await page.locator('#copy').click();
    const copied = await page.evaluate(() => window.__sent.find(m => m.type === 'copy').text);
    assert.ok(copied.includes('سلام دنیا')); assert.ok(!copied.includes('\x1b'));
    await page.locator('#command').fill('echo test'); await page.locator('#command').press('Enter');
    assert.ok(await page.evaluate(() => window.__sent.some(m => m.type === 'run' && m.command === 'echo test')));
    await post({ type: 'state', busy: true, cwd: '/tmp', shell: 'bash' });
    await page.locator('#command').fill('42'); await page.locator('#command').press('Enter');
    assert.ok(await page.evaluate(() => window.__sent.some(m => m.type === 'stdin' && m.text === '42\n')));
    await page.locator('#command').press('Control+c');
    assert.ok(await page.evaluate(() => window.__sent.some(m => m.type === 'stop')));
    await post({ type: 'state', busy: false, cwd: '/home/amir/projects/سلام', shell: 'bash' });
    await page.locator('#command').press('ArrowUp'); assert.equal(await page.locator('#command').inputValue(), 'echo test');
    await page.locator('#command').fill('');
    await page.screenshot({ path: path.join(dir, 'dark.png') });
    await page.evaluate(() => {
      const style = document.documentElement.style;
      for (const [key, value] of Object.entries({ 'panel-background': '#ffffff', 'terminal-background': '#ffffff', 'terminal-foreground': '#202020', 'foreground': '#202020', 'descriptionForeground': '#555555', 'input-background': '#f7f7f7', 'input-foreground': '#202020', 'panel-border': '#dddddd' })) style.setProperty('--vscode-' + key, value);
    });
    await page.setViewportSize({ width: 460, height: 580 });
    await page.screenshot({ path: path.join(dir, 'light-narrow.png') });
    assert.equal(await page.evaluate(() => document.body.scrollWidth > window.innerWidth), false);
    await post({ type: 'events', reset: false, entries: [{ seq: 9, event: { type: 'data', id: 1, stream: 'stdout', data: ('سلام long output\n').repeat(10000) } }] });
    await page.waitForFunction(() => document.querySelector('.output-warning:not([hidden])'));
    assert.ok(await page.locator('.line').count() <= 100);
    await post({ type: 'events', reset: true, entries: [] });
    await page.waitForFunction(() => !document.querySelector('.run'));
    assert.equal(await page.locator('#welcome').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('UI smoke passed: bidi, shaping spans, ANSI, XSS literal text, logical copy, input, stdin, stop, history, dark/light narrow layouts, output budget, clear.');
  } finally { await browser.close(); host.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
