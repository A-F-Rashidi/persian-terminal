import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { resolveShell, ShellSpec, shellArgs } from './runner';
async function locate(executable: string): Promise<string | undefined> {
  const names = process.platform === 'win32' && !executable.toLowerCase().endsWith('.exe') ? [executable + '.exe', executable] : [executable];
  const dirs = isAbsolute(executable) ? [''] : (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const dir of dirs) for (const name of names) {
    const path = dir ? join(dir, name) : name;
    // The legacy Windows bash launcher is a WSL bridge, not a host shell.
    if (process.platform === 'win32' && /[\\/]windows[\\/]system32[\\/]bash\.exe$/i.test(path)) continue;
    try { await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return path; } catch { /* try next */ }
  }
  return undefined;
}
const probeCache = new Map<string, { expires: number; result: Promise<ShellSpec | undefined> }>();
export async function probeShell(spec: ShellSpec): Promise<ShellSpec | undefined> {
  const executable = await locate(spec.executable); if (!executable) return undefined;
  const info = await stat(executable).catch(() => undefined);
  if (!info?.isFile()) return undefined;
  const key = `${spec.kind}\0${executable}\0${info.mtimeMs}\0${info.size}`;
  const now = Date.now(), cached = probeCache.get(key);
  if (cached && cached.expires > now) return cached.result;
  for (const [id, entry] of probeCache) if (entry.expires <= now) probeCache.delete(id);
  if (probeCache.size >= 64) probeCache.delete(probeCache.keys().next().value!);
  const resolved = { ...spec, executable };
  const token = 'PERSIAN_TERMINAL_PROBE_OK';
  const command = spec.kind === 'powershell' || spec.kind === 'pwsh' ? `Write-Output '${token}'` : `printf '${token}'`;
  const result = new Promise<ShellSpec | undefined>(resolve => execFile(executable, shellArgs(resolved, command), { timeout: 3000, windowsHide: true, maxBuffer: 32768 }, (error, stdout) => resolve(!error && stdout.includes(token) ? resolved : undefined)));
  probeCache.set(key, { expires: now + 60_000, result });
  void result.then(value => { if (!value && probeCache.get(key)?.result === result) probeCache.delete(key); });
  return result;
}
export async function discoverShells(custom?: ShellSpec): Promise<ShellSpec[]> {
  const candidates: ShellSpec[] = (process.platform === 'win32' ? ['powershell', 'pwsh', 'bash'] : ['bash', 'sh', 'zsh', 'pwsh']).map(kind => resolveShell(kind));
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')]) {
      if (base) candidates.push({ kind: 'bash', executable: join(base, 'Git', 'bin', 'bash.exe') });
    }
  }
  if (custom) candidates.unshift(custom);
  const tested = await Promise.all(candidates.map(probeShell));
  const unique = new Map<string, ShellSpec>();
  for (const spec of tested) if (spec) unique.set(process.platform === 'win32' ? spec.executable.toLowerCase() : spec.executable, spec);
  return [...unique.values()];
}
export function shellLabel(shell: ShellSpec): string { return `${shell.kind} — ${basename(shell.executable)}`; }
