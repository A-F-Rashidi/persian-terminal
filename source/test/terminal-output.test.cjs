const {test}=require('node:test');const assert=require('node:assert/strict');
const {TerminalOutput}=require('../out/terminal-output');
test('command echo and split startup boundary are removed; actual output remains',()=>{
 const p=new TerminalOutput('__PT_BEGIN_token__');
 assert.equal(p.write("printf '__PT_BEGIN_' 'token__'; echo test\r\n__PT_BE"),'');
 assert.equal(p.write('GIN_token__سوال؟'),'سوال؟');
 assert.equal(p.end(),'');
});
test('split Persian input echo is removed once, preserving result and real newlines',()=>{
 const p=new TerminalOutput('BEGIN');p.write('BEGINسوال');
 p.expectInput('تبریز\n');
 assert.equal(p.write('تب'), '');
 assert.equal(p.write('ریز\r'), '');
 assert.equal(p.write('\nنتیجه\r\n'), 'نتیجه\r\n');
 assert.equal(p.write('تبریز\r\n'),'تبریز\r\n');
});
test('nonmatching output is retained when an application does not echo',()=>{
 const p=new TerminalOutput('BEGIN');p.write('BEGIN');
 p.expectInput('secret\n');assert.equal(p.write('done\n'),'done\n');
});
test('ordinary ConPTY cursor controls do not cause a false unsupported warning',()=>{
 const {OutputModel}=require('../media/ansi');
 const m=new OutputModel();
 m.write('\x1b[?25l\x1b[6 q\x1b[12;1Hسلام\x1b[?25h\r\nنتیجه');
 assert.equal(m.unsupported,false);assert.equal(m.text(),'سلام\nنتیجه');
 m.write('\x1b[1A\x1b[1Gخوب');
 assert.equal(m.text(),'خوبم\nنتیجه');
});

test('ConPTY echo with cursor controls split across chunks is removed, not the following prompt',()=>{
 const p=new TerminalOutput('BEGIN');p.write('BEGIN');
 p.expectInput('تبریز\n');
 assert.equal(p.write('\x1b[?25l\x1b[12;'),'');
 assert.equal(p.write('1Hتب\x1b[0mریز\r'),'');
 assert.equal(p.write('\n\x1b[?25hرنگ؟'),'\x1b[?25hرنگ؟');
 p.expectInput('سبز\n');
 assert.equal(p.write('\x1b[32mسبز\x1b[0m\r\nاز تبریز رنگ سبز رو دوست داره'),'از تبریز رنگ سبز رو دوست داره');
});
