"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandRunner = void 0;
exports.resolveShell = resolveShell;
exports.shellArgs = shellArgs;
const powershell_text_1 = require("./powershell-text");
const node_child_process_1 = require("node:child_process");
const node_path_1 = require("node:path");
function resolveShell(kind, customPath = '', platform = process.platform, env = process.env) {
    let selected;
    if (kind === 'auto') {
        const login = (0, node_path_1.basename)(env.SHELL || '/bin/sh');
        selected = platform === 'win32' ? 'powershell' : login === 'bash' || login === 'zsh' ? login : 'sh';
    }
    else if (['powershell', 'pwsh', 'bash', 'sh', 'zsh'].includes(kind)) {
        selected = kind;
    }
    else {
        throw new Error('Unsupported shell type.');
    }
    let executable = selected === 'powershell'
        ? platform === 'win32' ? (0, node_path_1.join)(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell'
        : selected;
    if (kind === 'auto' && platform !== 'win32' && env.SHELL && (0, node_path_1.basename)(env.SHELL) === selected) {
        executable = env.SHELL;
    }
    if (customPath) {
        executable = customPath;
    }
    return { kind: selected, executable };
}
function shellArgs(shell, command) {
    if (shell.kind === 'powershell' || shell.kind === 'pwsh') {
        const script = `$ProgressPreference = 'SilentlyContinue'\n$utf8 = [System.Text.UTF8Encoding]::new($false)\n[Console]::OutputEncoding = $utf8\n[Console]::InputEncoding = $utf8\n$OutputEncoding = $utf8\n$global:LASTEXITCODE = 0\n& {\n${command}\n}\nif (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE }; exit 1 }`;
        return ['-NoLogo', '-NoProfile', '-InputFormat', 'Text', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
    }
    if (shell.kind === 'bash') {
        return ['--noprofile', '--norc', '-c', command];
    }
    if (shell.kind === 'zsh') {
        return ['-f', '-c', command];
    }
    return ['-c', command];
}
/** One command per process. There is deliberately no terminal/TTY emulation here. */
class CommandRunner {
    notify;
    child;
    escalation;
    stopped = false;
    constructor(notify) {
        this.notify = notify;
    }
    get busy() { return this.child !== undefined; }
    start(shell, command, cwd) {
        if (this.child) {
            throw new Error('A command is already running.');
        }
        if (!command.trim() || command.length > 65536 || command.includes('\0')) {
            throw new Error('Command is empty, too long, or contains NUL.');
        }
        this.startProcess(shell.executable, shellArgs(shell, command), cwd, shell.kind === 'powershell' || shell.kind === 'pwsh');
    }
    startProcess(executable, args, cwd, powershell = false, environment = process.env) {
        if (this.child) {
            throw new Error('A command is already running.');
        }
        this.stopped = false;
        const child = (0, node_child_process_1.spawn)(executable, args, {
            cwd, windowsHide: true, detached: process.platform !== 'win32',
            stdio: 'pipe', env: { ...environment, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
        });
        this.child = child;
        const stderrDecoder = powershell ? new powershell_text_1.PowerShellTextDecoder(data => this.notify({ type: 'data', stream: 'stderr', data })) : undefined;
        for (const stream of ['stdout', 'stderr']) {
            // setEncoding keeps incomplete UTF-8 code points between OS pipe chunks.
            child[stream].setEncoding('utf8');
            child[stream].on('data', (data) => {
                if (stream === 'stderr' && stderrDecoder)
                    stderrDecoder.write(data);
                else
                    this.notify({ type: 'data', stream, data });
            });
        }
        child.stdin.on('error', () => { });
        child.on('error', (error) => this.notify({ type: 'error', message: error.code === 'ENOENT'
                ? `برنامه «${executable}» یا پوشه اجرا پیدا نشد. مسیر را بررسی کن؛ برای شل ویندوز از انتخاب شل، auto یا powershell را انتخاب کن.`
                : error.message }));
        child.on('close', (code, signal) => {
            stderrDecoder?.end();
            if (this.escalation) {
                clearTimeout(this.escalation);
                this.escalation = undefined;
            }
            if (this.child === child) {
                this.child = undefined;
            }
            this.notify({ type: 'exit', code, signal, stopped: this.stopped });
        });
    }
    input(data) {
        if (!this.child || this.stopped || !this.child.stdin.writable || data.length > 65536) {
            return;
        }
        this.child.stdin.write(data, () => { });
    }
    eof() { this.child?.stdin.end(); }
    stop(force = false) {
        const child = this.child;
        if (!child?.pid) {
            return;
        }
        this.stopped = true;
        if (this.escalation) {
            clearTimeout(this.escalation);
        }
        if (process.platform === 'win32') {
            // Pipes cannot deliver console Ctrl+C. Terminate the process tree explicitly.
            const taskkill = (0, node_path_1.join)(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
            const killer = (0, node_child_process_1.spawn)(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            killer.on('error', () => { child.kill(); });
            killer.on('close', (code) => { if (code !== 0 && this.child === child) {
                child.kill();
            } });
        }
        else {
            const signalGroup = (signal) => {
                try {
                    process.kill(-child.pid, signal);
                }
                catch (error) {
                    if (error.code !== 'ESRCH') {
                        child.kill(signal);
                    }
                }
            };
            signalGroup(force ? 'SIGKILL' : 'SIGINT');
            if (!force) {
                this.escalation = setTimeout(() => signalGroup('SIGKILL'), 800);
                this.escalation.unref();
            }
        }
    }
    dispose() { this.stop(true); }
}
exports.CommandRunner = CommandRunner;
//# sourceMappingURL=runner.js.map