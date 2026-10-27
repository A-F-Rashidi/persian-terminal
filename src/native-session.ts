import { randomBytes } from 'node:crypto';
import { TerminalOutput } from './terminal-output';
import * as vscode from 'vscode';
import { ShellSpec } from './runner';
import { SessionEvent } from './session';

/** Uses VS Code's managed PTY/ConPTY, including its remote-host support. */
export class NativeSession {
  private terminal?: vscode.Terminal;
  private execution?: vscode.TerminalShellExecution;
  private subscriptions: vscode.Disposable[] = [];
  private disposed = false;
  private stopped = false;
  private ended = false;
  private drained = false;
  private output?: TerminalOutput;
  private requestedCwd?: string;
  private code: number | null = null;
  constructor(readonly shell: ShellSpec, public cwd: string, private notify: (event: SessionEvent) => void) {}
  get busy(): boolean { return !!this.execution; }
  get alive(): boolean { return !!this.terminal; }
  async ready(timeoutMs = 10000): Promise<void> {
    if (this.disposed) throw new Error('این تب بسته شده است.');
    if (!this.terminal) {
      this.terminal = vscode.window.createTerminal({
        name: 'Persian Terminal · ' + this.shell.kind, shellPath: this.shell.executable,
        cwd: this.cwd, isTransient: true,
        env: { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
      });
      this.subscriptions.push(vscode.window.onDidEndTerminalShellExecution(event => {
        if (event.terminal !== this.terminal || event.execution !== this.execution) return;
        this.ended = true; this.code = event.exitCode ?? null;
        this.finish();
      }), vscode.window.onDidCloseTerminal(terminal => {
        if (terminal !== this.terminal) return;
        this.terminal = undefined;
        if (this.execution) {
          this.execution = undefined;
          this.notify({ type: 'exit', code: null, signal: null, stopped: this.stopped });
        }
        this.notify({ type: 'closed' });
      }));
    }
    const until = Date.now() + timeoutMs;
    while (!this.terminal?.shellIntegration && !this.disposed && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (this.disposed) throw new Error('این تب بسته شده است.');
    if (!this.terminal?.shellIntegration) {
      this.terminal?.show();
      throw new Error('اتصال شل به پنل آماده نشد. Shell Integration را در تنظیمات VS Code فعال کن و از PowerShell 7، Bash یا Zsh استفاده کن. ترمینال اصلی برای ادامه باز شد.');
    }
  }
  execute(command: string, cwd?: string): void {
    if (this.busy || !this.terminal?.shellIntegration || this.disposed) throw new Error('ترمینال آماده اجرا نیست.');
    this.stopped = false; this.ended = false; this.drained = false; this.code = null;
    this.requestedCwd = cwd;
    const token = randomBytes(16).toString('hex') + '__';
    this.output = new TerminalOutput('__PT_BEGIN_' + token);
    const prefix = this.shell.kind === 'powershell' || this.shell.kind === 'pwsh'
      ? "[Console]::Write('__PT_BEGIN_'+'" + token + "'); "
      : "printf '%s%s' '__PT_BEGIN_' '" + token + "'; ";
    const execution = this.terminal.shellIntegration.executeCommand(prefix + command);
    this.execution = execution;
    const stream = execution.read();
    void (async () => {
      try {
        for await (const data of stream) {
          if (this.disposed || this.execution !== execution) break;
          const text = this.output!.write(data);
          if (text) this.notify({ type: 'data', stream: 'stdout', data: text });
        }
      } catch {
        if (!this.disposed) this.notify({ type: 'error', message: 'خواندن خروجی قطع شد؛ ترمینال اصلی را بررسی کن.' });
      } finally {
        if (this.execution === execution) {
          const tail = this.output?.end(); if (tail) this.notify({ type: 'data', stream: 'stdout', data: tail });
          this.drained = true; this.finish(); }
      }
    })();
  }
  private finish(): void {
    if (!this.execution || !this.ended || !this.drained || this.disposed) return;
    this.execution = undefined;
    const cwd = this.requestedCwd || this.terminal?.shellIntegration?.cwd?.fsPath;
    if (cwd) { this.cwd = cwd; this.notify({ type: 'cwd', cwd }); }
    this.notify({ type: 'exit', code: this.code, signal: null, stopped: this.stopped });
  }
  input(text: string): boolean {
    if (!this.busy || !this.terminal || this.ended || this.disposed) return false;
    this.output?.expectInput(text);
    this.terminal.sendText(text.replace(/\r?\n/g, '\r'), false); return true;
  }
  eof(): void { if (this.busy) this.terminal?.sendText(process.platform === 'win32' ? '\x1a\r' : '\x04', false); }
  stop(): void { this.stopped = true; if (this.busy) this.terminal?.sendText('\x03', false); }
  show(): void { this.terminal?.show(); }
  dispose(): void {
    this.disposed = true; this.execution = undefined;
    for (const sub of this.subscriptions) sub.dispose();
    this.terminal?.dispose(); this.terminal = undefined;
  }
}
