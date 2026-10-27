import { NativeSession } from './native-session';
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { stat } from 'node:fs/promises';
import { resolveShell, ShellSpec } from './runner';
import { ShellSession, invocation, shellQuote } from './session';
import { discoverShells, probeShell } from './shells';
import { Transcript } from './transcript';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PersianTerminalProvider(context.extensionUri);
  context.subscriptions.push(provider,
    vscode.window.registerWebviewViewProvider('persianTerminal.output', provider),
    vscode.commands.registerCommand('persianTerminal.open', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.persianTerminal');
      await vscode.commands.executeCommand('persianTerminal.output.focus');
    }),
    vscode.commands.registerCommand('persianTerminal.runPythonFile', async (uri?: vscode.Uri) => {
      try { await provider.runPythonFile(uri); }
      catch (error) { await vscode.window.showErrorMessage(String(error)); }
    })
  );
}

interface Tab {
  key: number; name: string; cwd: string; shell: ShellSpec; session: ShellSession | NativeSession;
  log: Transcript; id: number; started: number; preparing: boolean; checked: boolean; generation: number; fileName?: string; runRequest?: number;
}
class PersianTerminalProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly tabs = new Map<number, Tab>();
  private activeKey = 0;
  private nextKey = 0;
  private preferredShell?: ShellSpec;
  private readonly subscriptions: vscode.Disposable[] = [];
  private viewSubscriptions: vscode.Disposable[] = [];
  private lastSent = -1;
  private flushTimer?: NodeJS.Timeout;
  private disposed = false;
  private get active(): Tab { return this.tabs.get(this.activeKey)!; }
  constructor(private readonly extensionUri: vscode.Uri) {
    this.createTab();
    this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('persianTerminal')) this.sendState();
    }));
  }
  private createTab(): Tab {
    if (this.tabs.size >= 8) throw new Error('هشت تب باز داری؛ برای تب تازه، یکی را ببند.');
    const config = vscode.workspace.getConfiguration('persianTerminal');
    const key = ++this.nextKey;
    const tab = { key, name: `ترمینال ${key}`, cwd: this.active?.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || homedir(),
      shell: this.active?.shell || this.preferredShell || resolveShell(config.get('shell', 'auto'), config.get('shellPath', '')),
      log: new Transcript(), id: 0, started: 0, preparing: false, checked: false, generation: 0 } as Tab;
    this.attach(tab); this.tabs.set(key, tab); this.activeKey = key; this.lastSent = -1;
    return tab;
  }
  private attach(tab: Tab): void {
    const Session = vscode.workspace.getConfiguration('persianTerminal').get<string>('sessionBackend', 'native') === 'legacy' ? ShellSession : NativeSession;
    tab.session = new Session(tab.shell, tab.cwd, event => {
      if (this.disposed || !this.tabs.has(tab.key)) return;
      if (event.type === 'cwd') tab.cwd = event.cwd;
      else if (event.type === 'closed') {
        if (tab.key === this.activeKey) this.post({ type: 'notice', text: 'این نشست بسته شد. با اجرای بعدی از نو شروع می‌کنی؛ متغیرهای قبلی حفظ نمی‌شوند.' });
      } else if (event.type === 'data') {
        for (let offset = 0; offset < event.data.length;) {
          let end = Math.min(offset + 16384, event.data.length);
          const code = event.data.charCodeAt(end - 1);
          if (code >= 0xd800 && code <= 0xdbff && end < event.data.length) end--;
          tab.log.append({ ...event, id: tab.id, data: event.data.slice(offset, end) }); offset = end;
        }
      } else if (event.type === 'error') tab.log.append({ ...event, id: tab.id });
      else tab.log.append({ ...event, id: tab.id, duration: Date.now() - tab.started });
      this.scheduleFlush();
    });
  }
  private async ensureAvailable(tab: Tab): Promise<void> {
    if (tab.checked) return;
    let verified = await probeShell(tab.shell);
    if (tab.session instanceof NativeSession && (tab.shell.kind === 'powershell' || tab.shell.kind === 'sh')) {
      const choices = await discoverShells(tab.shell);
      const supported = choices.find(s => s.kind === 'pwsh') || choices.find(s => s.kind === 'bash' || s.kind === 'zsh');
      if (supported) {
        tab.session.dispose(); tab.shell = supported; this.attach(tab);
        verified = supported;
        this.post({ type: 'notice', text: 'برای ترمینال واقعی، ' + supported.kind + ' انتخاب شد.' });
      }
    }
    if (!this.tabs.has(tab.key) || this.disposed) throw new Error('این تب بسته شده؛ یک تب دیگر انتخاب کن.');
    let spec = verified;
    if (!spec) {
      const available = await discoverShells();
      spec = available.find(s => s.kind === (process.platform === 'win32' ? 'powershell' : 'bash')) || available[0];
      if (!spec) throw new Error('شل قابل اجرا پیدا نشد؛ مسیر شل را در تنظیمات بررسی کن.');
      const original = process.platform === 'win32' ? tab.shell.executable.toLowerCase() : tab.shell.executable;
      const replacement = process.platform === 'win32' ? spec.executable.toLowerCase() : spec.executable;
      if (tab.shell.kind !== spec.kind || original !== replacement) {
        this.post({ type: 'notice', text: `بررسی اولیه «${tab.shell.kind}» موفق نبود؛ برای این تب «${spec.kind}» انتخاب شد.` });
      }
    }
    if (!this.tabs.has(tab.key) || this.disposed) throw new Error('این تب بسته شده؛ یک تب دیگر انتخاب کن.');
    this.preferredShell = spec;
    tab.session.dispose(); tab.shell = spec; this.attach(tab); tab.checked = true;
  }
  resolveWebviewView(view: vscode.WebviewView): void {
    this.viewSubscriptions.forEach(item => item.dispose()); this.viewSubscriptions = []; this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview);
    this.viewSubscriptions.push(view.webview.onDidReceiveMessage((message: unknown) => {
      void this.receive(message).catch(error => { this.post({ type: 'notice', text: String(error) }); this.sendState(); });
    }), view.onDidChangeVisibility(() => { if (view.visible) { this.sendState(); this.flush(); } }),
    view.onDidDispose(() => { if (this.view === view) this.view = undefined; }));
  }
  async runPythonFile(uri?: vscode.Uri): Promise<void> {
    if (!vscode.workspace.isTrusted) { throw new Error('برای اجرای دستور، ابتدا اعتماد به پوشه پروژه را در VS Code تایید کن.'); }
    const tab = this.active;
    const request = tab.runRequest = (tab.runRequest || 0) + 1;
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) { throw new Error('فایل پایتونت را باز کن و اجرا را بزن.'); }
    let document = await vscode.workspace.openTextDocument(target);
    if (document.languageId !== 'python') { throw new Error('فایل انتخاب‌شده پایتون نیست.'); }
    if (document.isUntitled) {
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand('workbench.action.files.save');
      const saved = vscode.window.activeTextEditor?.document;
      if (!saved || saved.isUntitled || saved.languageId !== 'python') { return; }
      document = saved;
    } else if (document.isDirty && !await document.save()) { return; }
    if (!['file', 'vscode-remote'].includes(document.uri.scheme)) { throw new Error('اول فایل را ذخیره کن، بعد اجرا را بزن.'); }
    const resource = document.uri;
    const folder = vscode.workspace.getWorkspaceFolder(resource)?.uri.fsPath;
    const cwd = folder || dirname(resource.fsPath);
    const custom = vscode.workspace.getConfiguration('persianTerminal', resource).get<string>('pythonPath', '').trim();
    let execution: string[] | undefined = custom ? [custom] : undefined;
    if (!execution) {
      const extension = vscode.extensions.getExtension('ms-python.python');
      if (extension) {
        const api = await extension.activate();
        execution = (await api.settings?.getExecutionDetails(resource))?.execCommand;
        if (!execution?.length) { throw new Error('از Python: Select Interpreter مفسر را انتخاب کن، یا Persian Terminal: Python Path را تنظیم کن.'); }
      }
    }
    if (!execution) {
      const candidate = join(cwd, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      execution = await stat(candidate).then(s => s.isFile() ? [candidate] : undefined).catch(() => undefined);
      execution ??= [process.platform === 'win32' ? 'python' : 'python3'];
    }
    const args = [...execution.slice(1), '-u', resource.fsPath];
    if (this.disposed || !this.tabs.has(tab.key) || tab.runRequest !== request) return;
    if (tab.preparing || tab.session.busy) {
      tab.generation++;
      if (tab.session.busy && tab.id) tab.log.append({ type: 'exit', id: tab.id, code: null, signal: null, stopped: true, duration: Date.now() - tab.started });
      tab.session.dispose(); tab.preparing = false; this.attach(tab);
    }
    await vscode.commands.executeCommand('persianTerminal.open');
    if (this.disposed || !this.tabs.has(tab.key) || tab.runRequest !== request) return;
    await this.executeRun(shell => {
      const change = shell.kind === 'powershell' || shell.kind === 'pwsh'
        ? 'Set-Location -LiteralPath ' + shellQuote(cwd, shell) + ' -ErrorAction Stop; '
        : 'cd -- ' + shellQuote(cwd.replace(process.platform === 'win32' ? /\\/g : /$^/g, '/'), shell) + ' && ';
      return change + invocation(execution![0], args, shell);
    }, tab, basename(resource.fsPath), cwd, { executable: execution[0], args });
  }

  private post(message: unknown): void { void this.view?.webview.postMessage(message); }
  private sendState(): void {
    const config = vscode.workspace.getConfiguration('persianTerminal'), tab = this.active;
    if (!tab) return;
    this.post({ type: 'state', tabId: tab.key, fileName: tab.fileName || '', cwd: tab.cwd, shell: tab.shell.kind, busy: tab.preparing || tab.session.busy, runId: tab.id,
      tabs: [...this.tabs.values()].map(t => ({ id: t.key, name: t.name, shell: t.shell.kind, busy: t.preparing || t.session.busy })),
      density: config.get('density', 'compact'), persianAlignment: config.get('persianAlignment', 'right'),
      persianFontFamily: config.get('persianFontFamily'), fontFamily: config.get('fontFamily'), fontSize: config.get('fontSize', 14), maxLines: config.get('maxLines', 2000) });
  }
  private async receive(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const m = message as Record<string, unknown>;
    if (m.type === 'ready') { this.lastSent = -1; this.sendState(); this.flush(); return; }
    const tab = typeof m.tabId === 'number' ? this.tabs.get(m.tabId) : this.active;
    if (!tab) return;
    if (m.type === 'switchTab' && typeof m.target === 'number' && this.tabs.has(m.target)) {
      this.activeKey = m.target; this.lastSent = -1; this.sendState(); this.flush(); return;
    }
    if (m.type === 'clear') { tab.log.clear(); if (tab.key === this.activeKey) { this.lastSent = -1; this.flush(); } return; }
    if ((m.type === 'copy' || m.type === 'save') && typeof m.text === 'string') {
      if (m.text.length > 2_000_000) throw new Error('خروجی برای ذخیره یا کپی کامل بیش از حد طولانی است.');
      if (m.type === 'copy') { await vscode.env.clipboard.writeText(m.text); this.post({ type: 'notice', text: 'متن کپی شد.' }); }
      else {
        const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(join(tab.cwd, `terminal-${tab.key}-${typeof m.runId === 'number' ? m.runId : 'output'}.txt`)), filters: { 'Text files': ['txt', 'log'] }, saveLabel: 'ذخیره خروجی' });
        if (uri) { await vscode.workspace.fs.writeFile(uri, Buffer.from(m.text, 'utf8')); this.post({ type: 'notice', text: 'خروجی ذخیره شد.' }); }
      }
      return;
    }
    if (m.type === 'display') {
      const allowed: Record<string, unknown[]> = { density: ['compact', 'comfortable'], persianAlignment: ['right', 'left', 'auto'] };
      const key = m.key, value = m.value;
      if (typeof key !== 'string' || !(key === 'fontSize' && Number.isInteger(value) && Number(value) >= 10 && Number(value) <= 32 || (Array.isArray(allowed[key]) && allowed[key].includes(value)))) return;
      await vscode.workspace.getConfiguration('persianTerminal').update(key, value, vscode.ConfigurationTarget.Global); this.sendState(); return;
    }
    if (!vscode.workspace.isTrusted) throw new Error('برای اجرای دستور، ابتدا اعتماد به پوشه پروژه را در VS Code تایید کن.');
    if (m.type === 'newTab') { this.createTab(); this.sendState(); this.flush(); return; }
    if (m.type === 'closeTab') {
      tab.session.dispose(); this.tabs.delete(tab.key);
      if (!this.tabs.size) this.createTab();
      else if (this.activeKey === tab.key) this.activeKey = this.tabs.keys().next().value!;
      this.lastSent = -1; this.sendState(); this.flush(); return;
    }
    if (m.type === 'renameTab') {
      const name = await vscode.window.showInputBox({ value: tab.name, prompt: 'نام تب', validateInput: v => v.trim().length > 40 ? 'نام تب را در ۴۰ حرف یا کمتر بنویس.' : undefined });
      if (name?.trim() && this.tabs.has(tab.key)) { tab.name = name.trim().slice(0, 40); this.sendState(); } return;
    }
    if (m.type === 'stop') { tab.generation++; tab.session.stop(); return; }
    if (m.type === 'stdin' && typeof m.text === 'string') {
      if (!tab.session.busy || tab.preparing || m.text.length > 65536) return;
      if (!tab.session.input(m.text)) return;
      tab.log.append({ type: 'input', id: tab.id, text: m.text }); this.flush(); return;
    }
    if (m.type === 'native-terminal') { if (tab.session instanceof NativeSession) tab.session.show(); return; }
    if (m.type === 'eof') { tab.session.eof(); return; }
    if (m.type === 'folder') {
      if (tab.session.busy || tab.preparing) return;
      const folders = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, defaultUri: vscode.Uri.file(tab.cwd), openLabel: 'انتخاب پوشه' });
      if (folders?.[0] && this.tabs.has(tab.key)) {
        await this.executeRun(shell => (shell.kind === 'powershell' || shell.kind === 'pwsh' ? 'Set-Location -LiteralPath ' : 'cd ') + shellQuote(folders[0].fsPath.replaceAll('\\', '/'), shell), tab);
      }
      return;
    }
    if (m.type === 'shell') {
      if (tab.session.busy || tab.preparing) return;
      const available = await discoverShells(tab.shell);
      if (!available.length) throw new Error('شل قابل اجرا پیدا نشد.');
      const selected = await vscode.window.showQuickPick(available.map(shell => ({ label: shell.kind, description: shell.executable, shell })), { title: 'انتخاب شل — با تغییر شل، نشست این تب از نو شروع می‌شود' });
      if (selected && this.tabs.has(tab.key) && !tab.session.busy && !tab.preparing) {
        this.preferredShell = selected.shell;
        tab.session.dispose(); tab.shell = selected.shell; this.attach(tab); tab.checked = true;
        this.sendState(); this.post({ type: 'notice', text: 'شل عوض شد؛ این تب با یک نشست تازه آماده اجراست.' });
      } return;
    }
    if (m.type !== 'run' || typeof m.command !== 'string' || tab.session.busy || tab.preparing) return;
    if (!m.command.trim() || m.command.length > 65536 || m.command.includes('\0')) throw new Error('یک دستور بنویس؛ طول آن نباید بیشتر از ۶۵۵۳۶ نویسه باشد.');
    if (/^(?:cls|clear|clear-host)$/i.test(m.command.trim())) { tab.log.clear(); if (tab.key === this.activeKey) { this.lastSent = -1; this.flush(); } return; }
    await this.executeRun(m.command, tab);
  }
  private async executeRun(command: string | ((shell: ShellSpec) => string), tab: Tab, title?: string, workingDirectory?: string, program?: { executable: string; args: string[] }): Promise<void> {
    if (tab.session.busy || tab.preparing) throw new Error('این تب مشغول اجراست؛ منتظر بمان یا از تب تازه استفاده کن.');
    const generation = tab.generation;
    tab.preparing = true; this.sendState();
    try {
      await this.ensureAvailable(tab);
      if (tab.session instanceof NativeSession) await tab.session.ready();
      if (!(await stat(workingDirectory || tab.cwd)).isDirectory()) throw new Error('پوشه اجرا در دسترس نیست؛ پوشه دیگری انتخاب کن.');
      if (this.disposed || !this.tabs.has(tab.key) || generation !== tab.generation) return;
      if (!vscode.workspace.isTrusted) throw new Error('برای اجرای دستور، ابتدا اعتماد به پوشه پروژه را در VS Code تایید کن.');
      const text = typeof command === 'function' ? command(tab.shell) : command;
      if (workingDirectory) tab.cwd = workingDirectory;
      tab.fileName = title;
      tab.id++; tab.started = Date.now();
      tab.log.append({ type: 'start', id: tab.id, command: text, title, cwd: tab.cwd, shell: tab.shell.kind, at: tab.started });
      try {
        if (program && tab.session instanceof ShellSession && (tab.shell.kind === 'powershell' || tab.shell.kind === 'pwsh')) tab.session.executeProgram(program.executable, program.args, tab.cwd);
        else if (tab.session instanceof NativeSession) tab.session.execute(text, workingDirectory);
        else tab.session.execute(text);
      }
      catch (error) {
        tab.log.append({ type: 'error', id: tab.id, message: String(error) });
        tab.log.append({ type: 'exit', id: tab.id, code: null, signal: null, stopped: false, duration: 0 });
      }
    } finally { if (generation === tab.generation) tab.preparing = false; this.sendState(); this.scheduleFlush(); }
  }
  private scheduleFlush(): void {
    if (!this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = undefined; this.flush(); }, 40);
  }
  private flush(): void {
    if (!this.view?.visible || !this.active) return;
    const batch = this.active.log.readAfter(this.lastSent);
    this.post({ type: 'events', tabId: this.activeKey, reset: this.lastSent === -1 || batch.reset, entries: batch.entries });
    this.lastSent = batch.seq; this.sendState();
  }
  dispose(): void {
    this.disposed = true; if (this.flushTimer) clearTimeout(this.flushTimer);
    for (const tab of this.tabs.values()) tab.session.dispose();
    [...this.viewSubscriptions, ...this.subscriptions].forEach(item => item.dispose());
  }
  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(24).toString('hex');
    const resource = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name));
    return `<!DOCTYPE html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource}; font-src ${webview.cspSource}; connect-src 'none'; base-uri 'none'; form-action 'none'">
<link rel="stylesheet" href="${resource('view.css')}"><title>Persian Terminal</title></head>
<body><header class="toolbar"><div class="identity"><span class="mark" aria-hidden="true">›_</span><strong>Persian Terminal</strong><span class="badge">0.3.5</span></div>
<nav aria-label="ابزارها"><button id="shell" title="انتخاب شل" dir="ltr">shell</button><button id="folder" title="انتخاب پوشه اجرا">پوشه</button><button id="search-toggle" title="جست‌وجو — Ctrl+F">جست‌وجو</button><button id="settings-toggle" title="تنظیمات نمایش" aria-expanded="false">نمایش</button><button id="copy" title="کپی همه خروجی‌ها">کپی</button><button id="clear" title="پاک‌کردن خروجی — Ctrl+L">پاک‌کردن</button><button id="native-terminal" title="نمایش ترمینال اصلی برای برنامه‌های تمام‌صفحه">ترمینال اصلی</button><button id="stop" title="ارسال توقف به برنامه — Ctrl+C" disabled>توقف</button></nav></header>
<div class="tabs-bar"><div id="tabs" role="tablist" aria-label="نشست‌ها"></div><button id="new-tab" title="تب تازه" aria-label="تب تازه">＋</button></div>
<div id="display-settings" class="display-settings" hidden><label>اندازه متن <input id="font-size" type="number" min="10" max="32" value="14"></label><label>فاصله‌ها <select id="density"><option value="compact">فشرده</option><option value="comfortable">معمولی</option></select></label><label>چینش فارسی <select id="alignment"><option value="right">راست‌چین</option><option value="left">چپ‌چین</option><option value="auto">خودکار</option></select></label></div>
<div id="search-bar" class="search-bar" hidden><input id="search-query" type="search" placeholder="جست‌وجو در خروجی این تب…" aria-label="جست‌وجو در خروجی" dir="auto"><span id="search-status" role="status"></span><button id="search-prev" aria-label="نتیجه قبلی">↑</button><button id="search-next" aria-label="نتیجه بعدی">↓</button><button id="search-close" aria-label="بستن جست‌وجو">×</button></div>
<div class="context"><div class="cwd-card"><svg class="cwd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 9h18"/></svg><div class="cwd-details"><span class="cwd-label">پوشه اجرا</span><bdi id="cwd" dir="ltr" aria-label="پوشه اجرای دستورها"></bdi></div><div class="file-details" hidden><span class="file-label">فایل</span><span id="active-file" dir="auto" hidden></span></div></div><span class="dot" id="dot" hidden></span><span id="status" role="status" hidden></span></div>
<main id="output" tabindex="0" aria-label="خروجی دستورها"><div id="welcome" class="welcome"><div class="welcome-title">فارسی را همان‌طور که باید، بخوان.</div><p>دستور اجرا کن؛ فارسی را روان و با حروف متصل بخوان. (ویژه خروجی متنی.)</p></div></main>
<button id="latest" class="latest" hidden>آخرین خروجی ↓</button>
<div id="notice" hidden><span id="notice-text" role="status" aria-live="polite"></span><button id="notice-close" aria-label="بستن اعلان" title="بستن">×</button></div>
<form id="composer"><label id="input-label" for="command">دستور</label><div class="input-row"><span class="prompt" aria-hidden="true">❯</span><textarea id="command" rows="1" dir="ltr" spellcheck="false" autocomplete="off" autocapitalize="off" aria-describedby="hint" placeholder="دستورت را بنویس…"></textarea><button id="run" type="submit" class="primary">اجرا ↵</button><button id="eof" type="button" hidden title="پایان ورودی برنامه — Ctrl+D">EOF</button></div><div class="hint" id="hint"><span>Enter اجرا · Shift+Enter خط بعد · ↑↓ تاریخچه · Ctrl+C توقف</span><span>فارسی و انگلیسی، کنار هم</span></div></form>
<script nonce="${nonce}" src="${resource('ansi.js')}"></script><script nonce="${nonce}" src="${resource('view.js')}"></script></body></html>`;
  }
}
