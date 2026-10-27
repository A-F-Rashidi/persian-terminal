"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeShell = probeShell;
exports.discoverShells = discoverShells;
exports.shellLabel = shellLabel;
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_child_process_1 = require("node:child_process");
const runner_1 = require("./runner");
async function locate(executable) {
    const names = process.platform === 'win32' && !executable.toLowerCase().endsWith('.exe') ? [executable + '.exe', executable] : [executable];
    const dirs = (0, node_path_1.isAbsolute)(executable) ? [''] : (process.env.PATH || '').split(node_path_1.delimiter).filter(Boolean);
    for (const dir of dirs)
        for (const name of names) {
            const path = dir ? (0, node_path_1.join)(dir, name) : name;
            // The legacy Windows bash launcher is a WSL bridge, not a host shell.
            if (process.platform === 'win32' && /[\\/]windows[\\/]system32[\\/]bash\.exe$/i.test(path))
                continue;
            try {
                await (0, promises_1.access)(path, process.platform === 'win32' ? node_fs_1.constants.F_OK : node_fs_1.constants.X_OK);
                return path;
            }
            catch { /* try next */ }
        }
    return undefined;
}
const probeCache = new Map();
async function probeShell(spec) {
    const executable = await locate(spec.executable);
    if (!executable)
        return undefined;
    const info = await (0, promises_1.stat)(executable).catch(() => undefined);
    if (!info?.isFile())
        return undefined;
    const key = `${spec.kind}\0${executable}\0${info.mtimeMs}\0${info.size}`;
    const now = Date.now(), cached = probeCache.get(key);
    if (cached && cached.expires > now)
        return cached.result;
    for (const [id, entry] of probeCache)
        if (entry.expires <= now)
            probeCache.delete(id);
    if (probeCache.size >= 64)
        probeCache.delete(probeCache.keys().next().value);
    const resolved = { ...spec, executable };
    const token = 'PERSIAN_TERMINAL_PROBE_OK';
    const command = spec.kind === 'powershell' || spec.kind === 'pwsh' ? `Write-Output '${token}'` : `printf '${token}'`;
    const result = new Promise(resolve => (0, node_child_process_1.execFile)(executable, (0, runner_1.shellArgs)(resolved, command), { timeout: 3000, windowsHide: true, maxBuffer: 32768 }, (error, stdout) => resolve(!error && stdout.includes(token) ? resolved : undefined)));
    probeCache.set(key, { expires: now + 60_000, result });
    void result.then(value => { if (!value && probeCache.get(key)?.result === result)
        probeCache.delete(key); });
    return result;
}
async function discoverShells(custom) {
    const candidates = (process.platform === 'win32' ? ['powershell', 'pwsh', 'bash'] : ['bash', 'sh', 'zsh', 'pwsh']).map(kind => (0, runner_1.resolveShell)(kind));
    if (process.platform === 'win32') {
        for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && (0, node_path_1.join)(process.env.LOCALAPPDATA, 'Programs')]) {
            if (base)
                candidates.push({ kind: 'bash', executable: (0, node_path_1.join)(base, 'Git', 'bin', 'bash.exe') });
        }
    }
    if (custom)
        candidates.unshift(custom);
    const tested = await Promise.all(candidates.map(probeShell));
    const unique = new Map();
    for (const spec of tested)
        if (spec)
            unique.set(process.platform === 'win32' ? spec.executable.toLowerCase() : spec.executable, spec);
    return [...unique.values()];
}
function shellLabel(shell) { return `${shell.kind} — ${(0, node_path_1.basename)(shell.executable)}`; }
//# sourceMappingURL=shells.js.map