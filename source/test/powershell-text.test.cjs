const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PowerShellTextDecoder } = require('../out/powershell-text');
const fixture = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">touch : The term &apos;touch&apos; is not recognized._x000D__x000A_</S><S S="Error">+ touch samples/access.log_x000D__x000A_</S><S S="Error">خطا: &lt;فایل&gt; &amp; _x005F_x0041_</S></Objs>';
const expected = "touch : The term 'touch' is not recognized.\r\n+ touch samples/access.log\r\nخطا: <فایل> & _x0041_";
function decode(chunks) { const output=[]; const d=new PowerShellTextDecoder(s=>output.push(s)); chunks.forEach(s=>d.write(s)); d.end(); return output.join(''); }
test('user touch error CLIXML becomes readable text across every chunk boundary', () => {
  for (let i=0; i<=fixture.length; i++) assert.equal(decode([fixture.slice(0,i),fixture.slice(i)]),expected);
  assert.equal(decode([...fixture]),expected);
});
test('plain stderr, unmarked XML, unknown objects and incomplete transport are preserved', () => {
  for (const text of ['normal error\n', '<Objs><S>literal xml</S></Objs>', '#< CLIXML\n<Objs><Obj RefId="0"/></Objs>', '#< CLIXML\n<Objs><S S="Error">incomplete']) assert.equal(decode([text]),text);
});
test('multiple documents decode; oversized or invalid transport falls back without data loss', () => {
  assert.equal(decode([fixture + '\n' + fixture]),expected+'\n'+expected);
  const huge = '#< CLIXML\n' + 'x'.repeat(270000); assert.equal(decode([huge]),huge);
  const malformed = '#< CLIXML\n<Objs><S>&unknown;</S></Objs>'; assert.equal(decode([malformed]),malformed);
});
test('runner decodes marked PowerShell stderr before exit and leaves stdout untouched', async () => {
  const { CommandRunner } = require('../out/runner');
  const events=[];
  await new Promise((resolve,reject) => {
    const runner=new CommandRunner(e=>{ events.push(e);if(e.type==='exit'){clearTimeout(timer);resolve();} });
    const timer=setTimeout(()=>{runner.dispose();reject(new Error('timeout'));},5000);
    runner.startProcess(process.execPath,['-e',`process.stdout.write('<Objs>literal</Objs>');process.stderr.write(${JSON.stringify(fixture)});process.exitCode=1;`],process.cwd(),true);
  });
  assert.equal(events.filter(e=>e.type==='data'&&e.stream==='stderr').map(e=>e.data).join(''),expected);
  assert.equal(events.filter(e=>e.type==='data'&&e.stream==='stdout').map(e=>e.data).join(''),'<Objs>literal</Objs>');
  assert.equal(events.at(-1).type,'exit'); assert.equal(events.at(-1).code,1);
});
