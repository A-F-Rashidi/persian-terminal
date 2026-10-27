"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellSession = void 0;
exports.shellQuote = shellQuote;
exports.invocation = invocation;
const node_crypto_1 = require("node:crypto");
const runner_1 = require("./runner");
function shellQuote(text, shell) {
    return "'" + text.replaceAll("'", shell.kind === 'powershell' || shell.kind === 'pwsh' ? "''" : "'\\''") + "'";
}
function invocation(executable, args, shell) {
    if (process.platform === 'win32' && shell.kind !== 'powershell' && shell.kind !== 'pwsh') {
        const normalize = (value) => /^[a-z]:\\/i.test(value) ? value.replaceAll('\\', '/') : value;
        executable = normalize(executable);
        args = args.map(normalize);
    }
    return (shell.kind === 'powershell' || shell.kind === 'pwsh' ? '& ' : '') + [executable, ...args].map(s => shellQuote(s, shell)).join(' ');
}
// Small random, per-command control frames, removed before output reaches the UI.
class Frames {
    prefix;
    emit;
    frame;
    pending = '';
    constructor(prefix, emit, frame) {
        this.prefix = prefix;
        this.emit = emit;
        this.frame = frame;
    }
    write(text) {
        this.pending += text;
        while (this.pending) {
            const at = this.pending.indexOf(this.prefix);
            if (at >= 0) {
                if (at)
                    this.emit(this.pending.slice(0, at));
                this.pending = this.pending.slice(at);
                const end = this.pending.indexOf('\x1f', this.prefix.length);
                if (end < 0 && this.pending.length < 65536)
                    return;
                if (end < 0) {
                    this.end();
                    return;
                }
                const payload = this.pending.slice(this.prefix.length, end);
                this.pending = this.pending.slice(end + 1);
                this.frame(payload);
            }
            else {
                let keep = Math.min(this.pending.length, this.prefix.length - 1);
                while (keep && !this.prefix.startsWith(this.pending.slice(-keep)))
                    keep--;
                const out = this.pending.slice(0, this.pending.length - keep);
                if (out)
                    this.emit(out);
                this.pending = keep ? this.pending.slice(-keep) : '';
                return;
            }
        }
    }
    end() { if (this.pending)
        this.emit(this.pending); this.pending = ''; }
}
class ShellSession {
    shell;
    cwd;
    notify;
    process;
    direct;
    preparingProgram = false;
    cancelProgram = false;
    active = false;
    stopping = false;
    disposed = false;
    out;
    err;
    result;
    errDone = false;
    constructor(shell, cwd, notify) {
        this.shell = shell;
        this.cwd = cwd;
        this.notify = notify;
        this.process = new runner_1.CommandRunner(event => {
            if (this.disposed)
                return;
            if (event.type === 'data') {
                const parser = event.stream === 'stdout' ? this.out : this.err;
                if (parser)
                    parser.write(event.data);
                else
                    this.notify(event);
            }
            else if (event.type === 'exit') {
                this.out?.end();
                this.err?.end();
                if (this.active) {
                    this.active = false;
                    this.notify({ ...event, stopped: this.stopping || event.stopped });
                }
                this.notify({ type: 'closed' });
            }
            else
                this.notify(event);
        });
    }
    get busy() { return !!this.direct?.busy || this.preparingProgram || this.active || (this.stopping && this.process.busy); }
    get alive() { return this.process.busy; }
    execute(command) {
        if (this.disposed || this.busy)
            throw new Error('نشست آماده نیست.');
        if (!command.trim() || command.length > 65536 || command.includes('\0'))
            throw new Error('دستور معتبر نیست.');
        const ps = this.shell.kind === 'powershell' || this.shell.kind === 'pwsh';
        this.active = true;
        this.stopping = false;
        this.result = undefined;
        this.errDone = false;
        const token = (0, node_crypto_1.randomBytes)(20).toString('hex'), prefix = '\x1e' + token + ':';
        const send = (stream) => (data) => this.notify({ type: 'data', stream, data });
        this.out = new Frames(prefix, send('stdout'), payload => {
            const at = payload.indexOf(':');
            if (at < 0 || !/^-?\d+$/.test(payload.slice(0, at)))
                return;
            let cwd = ps ? Buffer.from(payload.slice(at + 1), 'base64').toString('utf8') : payload.slice(at + 1);
            if (process.platform === 'win32' && !ps)
                cwd = cwd.replace(/^\/([a-z])\//i, (_, drive) => drive.toUpperCase() + ':/');
            this.result = { code: Number(payload.slice(0, at)), cwd };
            this.complete();
        });
        this.err = new Frames(prefix, send('stderr'), payload => { if (payload === 'END') {
            this.errDone = true;
            this.complete();
        } });
        if (!this.process.busy) {
            const args = ps ? ['-NoLogo', '-NoProfile', '-InputFormat', 'Text', '-OutputFormat', 'Text', '-Command', '-']
                : this.shell.kind === 'bash' ? ['--noprofile', '--norc'] : this.shell.kind === 'zsh' ? ['-f'] : [];
            this.process.startProcess(this.shell.executable, args, this.cwd);
            if (ps)
                this.process.input("$ProgressPreference='SilentlyContinue'; $OutputEncoding=[System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=$OutputEncoding; [Console]::InputEncoding=$OutputEncoding\n");
        }
        let wrapper;
        if (ps) {
            const encoded = Buffer.from(command, 'utf8').toString('base64');
            wrapper = `$global:LASTEXITCODE=0; $__pt_errors=$Error.Count; try { . ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))) | Out-Default; $__pt_ok=$?; $__pt_code=0; if (-not $__pt_ok -or $Error.Count -gt $__pt_errors) { $__pt_code=1 }; if ($LASTEXITCODE) { $__pt_code=$LASTEXITCODE } } catch { [Console]::Error.WriteLine($_.ToString()); $__pt_code=1 }; $__pt_cwd=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path)); [Console]::Out.Write(([char]30)+'${token}:'+$__pt_code+':'+$__pt_cwd+([char]31)); [Console]::Error.Write(([char]30)+'${token}:END'+([char]31))\n`;
        }
        else {
            wrapper = `eval ${shellQuote(command, this.shell)}; __pt_code=$?; printf '\\036${token}:%s:%s\\037' "$__pt_code" "$PWD"; printf '\\036${token}:END\\037' >&2\n`;
        }
        if (wrapper.length > 65536) {
            this.active = false;
            throw new Error('دستور برای ارسال به نشست بیش از حد طولانی است.');
        }
        this.process.input(wrapper);
    }
    complete() {
        if (!this.active || !this.result || !this.errDone)
            return;
        this.active = false;
        this.cwd = this.result.cwd || this.cwd;
        this.notify({ type: 'cwd', cwd: this.cwd });
        this.notify({ type: 'exit', code: this.result.code, signal: null, stopped: false });
    }
    executeProgram(executable, args, cwd) {
        if (this.busy || this.disposed)
            throw new Error('این تب در حال اجراست.');
        const original = this.notify;
        const ps = this.shell.kind === 'powershell' || this.shell.kind === 'pwsh';
        let captured = '', failure = '';
        this.cancelProgram = false;
        this.notify = event => {
            if (event.type === 'data') {
                if (event.stream === 'stdout' && captured.length + event.data.length <= 1000000)
                    captured += event.data;
                else
                    failure = 'دریافت محیط اجرا کامل نشد.';
            }
            else if (event.type === 'error')
                failure = event.message;
            else if (event.type === 'exit') {
                this.notify = original;
                this.preparingProgram = false;
                if (this.cancelProgram || event.stopped || event.code !== 0 || failure) {
                    if (failure)
                        original({ type: 'error', message: failure });
                    original({ ...event, code: event.code || 1, stopped: this.cancelProgram || event.stopped });
                    return;
                }
                try {
                    const environment = Object.create(null);
                    if (ps) {
                        const parsed = JSON.parse(captured.trim());
                        for (const [key, value] of Object.entries(parsed))
                            if (typeof value === 'string')
                                environment[key] = value;
                    }
                    else {
                        for (const field of captured.split('\0')) {
                            const at = field.indexOf('=');
                            if (at > 0)
                                environment[field.slice(0, at)] = field.slice(at + 1);
                        }
                    }
                    this.cwd = cwd;
                    original({ type: 'cwd', cwd });
                    this.direct = new runner_1.CommandRunner(next => {
                        if (this.disposed)
                            return;
                        if (next.type === 'exit')
                            this.direct = undefined;
                        original(next);
                    });
                    this.direct.startProcess(executable, args, cwd, false, environment);
                }
                catch {
                    original({ type: 'error', message: 'محیط اجرای پایتون آماده نشد؛ دوباره اجرا کن.' });
                    original({ type: 'exit', code: 1, signal: null, stopped: false });
                }
            }
        };
        const change = ps ? 'Set-Location -LiteralPath ' + shellQuote(cwd, this.shell) + ' -ErrorAction Stop; '
            : 'cd -- ' + shellQuote(cwd, this.shell) + ' && ';
        try {
            this.execute(change + (ps
                ? '$__pt_env=@{}; Get-ChildItem Env: | ForEach-Object { $__pt_env[$_.Name]=$_.Value }; [Console]::Out.Write(($__pt_env | ConvertTo-Json -Compress))'
                : 'env -0'));
            this.preparingProgram = true;
        }
        catch (error) {
            this.notify = original;
            this.preparingProgram = false;
            throw error;
        }
    }
    input(text) {
        if (this.preparingProgram || this.stopping || this.disposed)
            return false;
        if (this.direct?.busy) {
            this.direct.input(text);
            return true;
        }
        if (this.active) {
            this.process.input(text);
            return true;
        }
        return false;
    }
    eof() {
        if (this.direct) {
            this.direct.eof();
            return;
        }
        if (this.active) {
            this.stopping = true;
            this.process.eof();
        }
    }
    stop() {
        this.cancelProgram = true;
        if (this.direct) {
            this.direct.stop(true);
            return;
        }
        this.stopping = true;
        this.process.stop(true);
    }
    dispose() { this.disposed = true; this.direct?.dispose(); this.process.dispose(); }
}
exports.ShellSession = ShellSession;
//# sourceMappingURL=session.js.map