const {test}=require('node:test');const assert=require('node:assert/strict');
const {ShellSession,invocation}=require('../out/session');
const {until}=require('./host.cjs');
const unix={skip:process.platform==='win32'};
function session(){const events=[];const s=new ShellSession({kind:'bash',executable:'/bin/bash'},process.cwd(),e=>events.push(e));return {s,events,async run(c){const before=events.length;s.execute(c);await until(()=>events.slice(before).some(e=>e.type==='exit'));return events.slice(before);}};}
test('persistent shell retains variables, functions, exported env and working directory',unix,async()=>{const t=session();try{
await t.run("export PT_TEST='سلام'; pt_hi(){ printf '%s' \"$PT_TEST\"; }; cd /tmp");
const data=await t.run('pt_hi; printf "|%s|%s" "$PWD" "$$"');
assert.equal(data.filter(e=>e.type==='data').map(e=>e.data).join('').split('|').slice(0,2).join('|'),'سلام|/tmp');
assert.equal(t.s.cwd,'/tmp');assert.equal(t.s.alive,true);
const next=await t.run('false');assert.equal(next.find(e=>e.type==='exit').code,1);
assert.equal((await t.run('true')).find(e=>e.type==='exit').code,0);
}finally{t.s.dispose();}});
test('persistent stdin goes to running program without consuming completion commands',unix,async()=>{const t=session();try{
t.s.execute(invocation(process.execPath,['-e',"process.stdout.write('ready');process.stdin.once('data',x=>{process.stdout.write(x);process.exit(0)})"],t.s.shell));
await until(()=>t.events.some(e=>e.type==='data'&&e.data==='ready'));t.s.input('سلام\n');await until(()=>t.events.some(e=>e.type==='exit'));assert.ok(t.events.filter(e=>e.type==='data').map(e=>e.data).join('').includes('سلام'));
assert.equal((await t.run('printf next')).find(e=>e.type==='data').data,'next');
}finally{t.s.dispose();}});
test('two sessions isolate state and stop closes only its own process',unix,async()=>{const a=session(),b=session();try{
await a.run('export PT_TAB=first');await b.run('export PT_TAB=second');
a.s.execute('sleep 30');a.s.stop();await until(()=>!a.s.alive);assert.equal(a.events.at(-1).type,'closed');
assert.equal((await b.run('printf "$PT_TAB"')).find(e=>e.type==='data').data,'second');
}finally{a.s.dispose();b.s.dispose();}});
test('persistent invocation preserves special arguments and environment for child programs',unix,async()=>{
 const t=session();try{
 await t.run('export PT_ENV=shared');
 const value="مسیر با فاصله ' $HOME $(printf injected)";
 const events=await t.run(invocation(process.execPath,['-e',"process.stdout.write(JSON.stringify([process.argv[1],process.env.PT_ENV]))",value],t.s.shell));
 assert.deepEqual(JSON.parse(events.filter(e=>e.type==='data'&&e.stream==='stdout').map(e=>e.data).join('')),[value,'shared']);
 }finally{t.s.dispose();}
});
test('exit closes session and the next command starts a usable fresh shell',unix,async()=>{
 const t=session();try{
 const ended=await t.run('export PT_BEFORE_EXIT=yes; exit 3');assert.equal(ended.find(e=>e.type==='exit').code,3);
 await until(()=>!t.s.alive);
 const next=await t.run('printf "${PT_BEFORE_EXIT-unset}"');assert.equal(next.find(e=>e.type==='data').data,'unset');
 }finally{t.s.dispose();}
});
test('Windows PowerShell keeps variables and formats table output before completion', {skip:process.platform!=='win32'}, async()=>{
 const {resolveShell}=require('../out/runner'); const events=[];
 const s=new ShellSession(resolveShell('powershell'),process.cwd(),e=>events.push(e));
 async function run(command){const from=events.length;s.execute(command);await until(()=>events.slice(from).some(e=>e.type==='exit'),15000);return events.slice(from);}
 try {
  assert.equal((await run("$pt_saved='سلام'; $env:PT_SESSION='kept'")).find(e=>e.type==='exit').code,0);
  const output=await run("Write-Output $pt_saved; [pscustomobject]@{Name=$env:PT_SESSION;Code=7}");
  const text=output.filter(e=>e.type==='data'&&e.stream==='stdout').map(e=>e.data).join('');
  assert.ok(text.includes('سلام'));assert.ok(text.includes('kept'));assert.ok(!text.includes('CLIXML'));
  const error=await run('Get-CommandThatCannotExistForPersianTerminal');assert.notEqual(error.find(e=>e.type==='exit').code,0);
  assert.equal((await run('Write-Output recovered')).find(e=>e.type==='exit').code,0);
 }finally{s.dispose();}
});

test('direct Python receives two Persian replies and inherits shell environment without closing shell', unix, async () => {
 const t=session(); try {
  await t.run("export PT_INPUT_TEST='محیط مشترک'");
  t.events.length=0;
  t.s.executeProgram('python3',['-u','-c',"import os; a=input('شهر؟'); b=input('رنگ؟'); print(a+'|'+b+'|'+os.environ['PT_INPUT_TEST'])"],process.cwd());
  const output=()=>t.events.filter(e=>e.type==='data').map(e=>e.data).join('');
  await until(()=>output().includes('شهر؟'));
  assert.equal(t.s.input('تبریز\n'),true);
  await until(()=>output().includes('رنگ؟'));
  assert.equal(t.s.input('سبز\n'),true);
  await until(()=>t.events.some(e=>e.type==='exit'));
  assert.ok(output().includes('تبریز|سبز|محیط مشترک'));
  assert.equal(t.s.input('نباید اجرا شود\n'),false);
  assert.equal(t.events.find(e=>e.type==='exit').code,0);
  assert.equal(t.s.alive,true);
  assert.equal((await t.run('printf "$PT_INPUT_TEST"')).find(e=>e.type==='data').data,'محیط مشترک');
 } finally {t.s.dispose();}
});
test('cancel during direct program preparation does not launch program', unix, async () => {
 const t=session(); try {
  t.s.executeProgram(process.execPath,['-e',"process.stdout.write('SHOULD_NOT_RUN')"],process.cwd());
  assert.equal(t.s.input('early\n'),false);
  t.s.stop();
  await until(()=>!t.s.busy);
  assert.ok(!t.events.some(e=>e.type==='data'&&e.data.includes('SHOULD_NOT_RUN')));
 } finally {t.s.dispose();}
});
