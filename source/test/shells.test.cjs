const {test}=require('node:test');const assert=require('node:assert/strict');
const {probeShell,discoverShells}=require('../out/shells');
test('shell discovery excludes missing programs and verifies commands actually run',{skip:process.platform==='win32'},async()=>{
 assert.equal(await probeShell({kind:'bash',executable:'/not-installed/zsh'}),undefined);
 const found=await discoverShells({kind:'sh',executable:'/bin/sh'});
 assert.ok(found.some(s=>s.kind==='sh'));assert.ok(found.every(s=>s.executable.startsWith('/')));
 assert.equal(new Set(found.map(s=>s.executable)).size,found.length);
});
test('repeated and concurrent shell probes share a result, changed executable is rechecked',{skip:process.platform==='win32'},async()=>{
 const fs=require('node:fs/promises'),path=require('node:path');
 const dir=await fs.mkdtemp(path.join(process.cwd(),'probe-cache-'));
 try {
  const executable=path.join(dir,'shell'),counter=path.join(dir,'calls');
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  const script=`#!/bin/sh\nprintf x >> ${quote(counter)}\nprintf PERSIAN_TERMINAL_PROBE_OK\n`;
  await fs.writeFile(executable,script,{mode:0o700});const spec={kind:'sh',executable};
  await Promise.all([probeShell(spec),probeShell(spec),probeShell(spec)]);await probeShell(spec);
  assert.equal(await fs.readFile(counter,'utf8'),'x');
  await fs.writeFile(executable,script+'\n# changed\n');await probeShell(spec);
  assert.equal(await fs.readFile(counter,'utf8'),'xx');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
