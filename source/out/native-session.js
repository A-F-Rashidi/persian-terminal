"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NativeSession = void 0;
const node_crypto_1 = require("node:crypto");
const terminal_output_1 = require("./terminal-output");
const vscode = require("vscode");
/** Uses VS Code's managed PTY/ConPTY, including its remote-host support. */
class NativeSession {
    shell;
    cwd;
    notify;
    terminal;
    execution;
    subscriptions = [];
    disposed = false;
    stopped = false;
    ended = false;
    drained = false;
    output;
    requestedCwd;
    code = null;
    constructor(shell, cwd, notify) {
        this.shell = shell;
        this.cwd = cwd;
        this.notify = notify;
    }
    get busy() { return !!this.execution; }
    get alive() { return !!this.terminal; }
    async ready(timeoutMs = 10000) {
        if (this.disposed)
            throw new Error('این تب بسته شده است.');
        if (!this.terminal) {
            this.terminal = vscode.window.createTerminal({
                name: 'Persian Terminal · ' + this.shell.kind, shellPath: this.shell.executable,
                cwd: this.cwd, isTransient: true,
                env: { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
            });
            this.subscriptions.push(vscode.window.onDidEndTerminalShellExecution(event => {
                if (event.terminal !== this.terminal || event.execution !== this.execution)
                    return;
                this.ended = true;
                this.code = event.exitCode ?? null;
                this.finish();
            }), vscode.window.onDidCloseTerminal(terminal => {
                if (terminal !== this.terminal)
                    return;
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
        if (this.disposed)
            throw new Error('این تب بسته شده است.');
        if (!this.terminal?.shellIntegration) {
            this.terminal?.show();
            throw new Error('اتصال شل به پنل آماده نشد. Shell Integration را در تنظیمات VS Code فعال کن و از PowerShell 7، Bash یا Zsh استفاده کن. ترمینال اصلی برای ادامه باز شد.');
        }
    }
    execute(command, cwd) {
        if (this.busy || !this.terminal?.shellIntegration || this.disposed)
            throw new Error('ترمینال آماده اجرا نیست.');
        this.stopped = false;
        this.ended = false;
        this.drained = false;
        this.code = null;
        this.requestedCwd = cwd;
        const token = (0, node_crypto_1.randomBytes)(16).toString('hex') + '__';
        this.output = new terminal_output_1.TerminalOutput('__PT_BEGIN_' + token);
        const prefix = this.shell.kind === 'powershell' || this.shell.kind === 'pwsh'
            ? "[Console]::Write('__PT_BEGIN_'+'" + token + "'); "
            : "printf '%s%s' '__PT_BEGIN_' '" + token + "'; ";
        const execution = this.terminal.shellIntegration.executeCommand(prefix + command);
        this.execution = execution;
        const stream = execution.read();
        void (async () => {
            try {
                for await (const data of stream) {
                    if (this.disposed || this.execution !== execution)
                        break;
                    const text = this.output.write(data);
                    if (text)
                        this.notify({ type: 'data', stream: 'stdout', data: text });
                }
            }
            catch {
                if (!this.disposed)
                    this.notify({ type: 'error', message: 'خواندن خروجی قطع شد؛ ترمینال اصلی را بررسی کن.' });
            }
            finally {
                if (this.execution === execution) {
                    const tail = this.output?.end();
                    if (tail)
                        this.notify({ type: 'data', stream: 'stdout', data: tail });
                    this.drained = true;
                    this.finish();
                }
            }
        })();
    }
    finish() {
        if (!this.execution || !this.ended || !this.drained || this.disposed)
            return;
        this.execution = undefined;
        const cwd = this.requestedCwd || this.terminal?.shellIntegration?.cwd?.fsPath;
        if (cwd) {
            this.cwd = cwd;
            this.notify({ type: 'cwd', cwd });
        }
        this.notify({ type: 'exit', code: this.code, signal: null, stopped: this.stopped });
    }
    input(text) {
        if (!this.busy || !this.terminal || this.ended || this.disposed)
            return false;
        this.output?.expectInput(text);
        this.terminal.sendText(text.replace(/\r?\n/g, '\r'), false);
        return true;
    }
    eof() { if (this.busy)
        this.terminal?.sendText(process.platform === 'win32' ? '\x1a\r' : '\x04', false); }
    stop() { this.stopped = true; if (this.busy)
        this.terminal?.sendText('\x03', false); }
    show() { this.terminal?.show(); }
    dispose() {
        this.disposed = true;
        this.execution = undefined;
        for (const sub of this.subscriptions)
            sub.dispose();
        this.terminal?.dispose();
        this.terminal = undefined;
    }
}
exports.NativeSession = NativeSession;
//# sourceMappingURL=native-session.js.map