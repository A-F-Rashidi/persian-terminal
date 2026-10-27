import { PowerShellTextDecoder } from './powershell-text';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { join, basename } from 'node:path';

export type ShellKind = 'powershell' | 'pwsh' | 'bash' | 'sh' | 'zsh';
export interface ShellSpec { kind: ShellKind; executable: string; }
export type RunEvent =
  | { type: 'data'; stream: 'stdout' | 'stderr'; data: string }
  | { type: 'error'; message: string }
  | { type: 'exit'; code: number | null; signal: string | null; stopped: boolean };

export function resolveShell(kind: string, customPath = '', platform = process.platform, env = process.env): ShellSpec {
  let selected: ShellKind;
  if (kind === 'auto') {
    const login = basename(env.SHELL || '/bin/sh');
    selected = platform === 'win32' ? 'powershell' : login === 'bash' || login === 'zsh' ? login : 'sh';
  } else if (['powershell', 'pwsh', 'bash', 'sh', 'zsh'].includes(kind)) {
    selected = kind as ShellKind;
  } else { throw new Error('Unsupported shell type.'); }
  let executable = selected === 'powershell'
    ? platform === 'win32' ? join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell'
    : selected;
  if (kind === 'auto' && platform !== 'win32' && env.SHELL && basename(env.SHELL) === selected) { executable = env.SHELL; }
  if (customPath) { executable = customPath; }
  return { kind: selected, executable };
}

export function shellArgs(shell: ShellSpec, command: string): string[] {
  if (shell.kind === 'powershell' || shell.kind === 'pwsh') {
    const script = `$ProgressPreference = 'SilentlyContinue'\n$utf8 = [System.Text.UTF8Encoding]::new($false)\n[Console]::OutputEncoding = $utf8\n[Console]::InputEncoding = $utf8\n$OutputEncoding = $utf8\n$global:LASTEXITCODE = 0\n& {\n${command}\n}\nif (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE }; exit 1 }`;
    return ['-NoLogo', '-NoProfile', '-InputFormat', 'Text', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  }
  if (shell.kind === 'bash') { return ['--noprofile', '--norc', '-c', command]; }
  if (shell.kind === 'zsh') { return ['-f', '-c', command]; }
  return ['-c', command];
}

/** One command per process. There is deliberately no terminal/TTY emulation here. */
export class CommandRunner {
  private child?: ChildProcessWithoutNullStreams;
  private escalation?: NodeJS.Timeout;
  private stopped = false;
  constructor(private readonly notify: (event: RunEvent) => void) {}
  get busy(): boolean { return this.child !== undefined; }

  start(shell: ShellSpec, command: string, cwd: string): void {
    if (this.child) { throw new Error('A command is already running.'); }
    if (!command.trim() || command.length > 65536 || command.includes('\0')) { throw new Error('Command is empty, too long, or contains NUL.'); }
    this.startProcess(shell.executable, shellArgs(shell, command), cwd, shell.kind === 'powershell' || shell.kind === 'pwsh');
  }

  startProcess(executable: string, args: string[], cwd: string, powershell = false, environment: NodeJS.ProcessEnv = process.env): void {
    if (this.child) { throw new Error('A command is already running.'); }
    this.stopped = false;
    const child = spawn(executable, args, {
      cwd, windowsHide: true, detached: process.platform !== 'win32',
      stdio: 'pipe', env: { ...environment, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
    });
    this.child = child;
    const stderrDecoder = powershell ? new PowerShellTextDecoder(data => this.notify({ type: 'data', stream: 'stderr', data })) : undefined;
    for (const stream of ['stdout', 'stderr'] as const) {
      // setEncoding keeps incomplete UTF-8 code points between OS pipe chunks.
      child[stream].setEncoding('utf8');
      child[stream].on('data', (data: string) => {
        if (stream === 'stderr' && stderrDecoder) stderrDecoder.write(data);
        else this.notify({ type: 'data', stream, data });
      });
    }
    child.stdin.on('error', () => { /* EPIPE is normal when a command finishes during input. */ });
    child.on('error', (error: NodeJS.ErrnoException) => this.notify({ type: 'error', message: error.code === 'ENOENT'
      ? `برنامه «${executable}» یا پوشه اجرا پیدا نشد. مسیر را بررسی کن؛ برای شل ویندوز از انتخاب شل، auto یا powershell را انتخاب کن.`
      : error.message }));
    child.on('close', (code, signal) => {
      stderrDecoder?.end();
      if (this.escalation) { clearTimeout(this.escalation); this.escalation = undefined; }
      if (this.child === child) { this.child = undefined; }
      this.notify({ type: 'exit', code, signal, stopped: this.stopped });
    });
  }

  input(data: string): void {
    if (!this.child || this.stopped || !this.child.stdin.writable || data.length > 65536) { return; }
    this.child.stdin.write(data, () => {});
  }
  eof(): void { this.child?.stdin.end(); }

  stop(force = false): void {
    const child = this.child;
    if (!child?.pid) { return; }
    this.stopped = true;
    if (this.escalation) { clearTimeout(this.escalation); }
    if (process.platform === 'win32') {
      // Pipes cannot deliver console Ctrl+C. Terminate the process tree explicitly.
      const taskkill = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
      const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => { child.kill(); });
      killer.on('close', (code) => { if (code !== 0 && this.child === child) { child.kill(); } });
    } else {
      const signalGroup = (signal: NodeJS.Signals) => {
        try { process.kill(-child.pid!, signal); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') { child.kill(signal); } }
      };
      signalGroup(force ? 'SIGKILL' : 'SIGINT');
      if (!force) {
        this.escalation = setTimeout(() => signalGroup('SIGKILL'), 800);
        this.escalation.unref();
      }
    }
  }
  dispose(): void { this.stop(true); }
}
