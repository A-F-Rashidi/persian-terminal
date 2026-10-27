const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {until}=require('./host.cjs');
function fixture(integration=true) {
 const handlers={end:[],close:[]},events=[],writes=[],commands=[];
 let queue=[],wake,done=false,reads=0,first=true;
 const execution={read(){reads++;return {[Symbol.asyncIterator](){return {async next(){
  while(!queue.length&&!done) await new Promise(r=>wake=r);
  return queue.length?{value:queue.shift(),done:false}:{done:true};
 }}}}}};
 const terminal={shellIntegration:integration?{cwd:{fsPath:'/updated'},executeCommand(c){commands.push(c);return execution;}}:undefined,
 sendText(t,n){writes.push([t,n]);},show(){terminal.shown=true;},dispose(){terminal.disposed=true;}};
 const on=(name,fn)=>{handlers[name].push(fn);return {dispose(){handlers[name]=handlers[name].filter(x=>x!==fn);}}};
 const mock={window:{createTerminal(options){terminal.options=options;return terminal;},onDidEndTerminalShellExecution:fn=>on('end',fn),onDidCloseTerminal:fn=>on('close',fn)}};
 const original=Module._load;
 Module._load=function(name,...args){return name==='vscode'?mock:original.call(this,name,...args);};
 let Session;try{delete require.cache[require.resolve('../out/native-session')];Session=require('../out/native-session').NativeSession;}finally{Module._load=original;}
 const session=new Session({kind:'bash',executable:'/bin/bash'},'/project',e=>events.push(e));
 return {session,terminal,events,writes,commands,get reads(){return reads;},
 data(value){ if(first){value='__PT_BEGIN_'+commands[0].match(/[a-f0-9]{32}__/)[0]+value;first=false;} queue.push(value);wake?.();},drain(){done=true;wake?.();},
 end(code=0){handlers.end.forEach(fn=>fn({terminal,execution,exitCode:code}));}};
}
test('PTY routes all command languages and Persian input through native terminal; drains output before exit',async()=>{
 for(const command of ['python app.py','node app.js','go run .','./app']){
 const f=fixture();try{
 await f.session.ready();f.session.execute(command);
 assert.equal(f.reads,1);assert.ok(f.commands[0].endsWith(command));
 f.data('شهر؟');await until(()=>f.events.some(e=>e.type==='data'));
 assert.equal(f.session.input('تبریز\n'),true);
 f.data('تبریز\r\nرنگ؟');f.session.input('سبز\n');
 assert.deepEqual(f.writes,[['تبریز\r',false],['سبز\r',false]]);
 f.end();assert.equal(f.session.input('late\n'),false);
 assert.equal(f.events.some(e=>e.type==='exit'),false);
 f.data('نتیجه\r\n');f.drain();await until(()=>!f.session.busy);
 assert.equal(f.events.at(-1).type,'exit');assert.equal(f.session.cwd,'/updated');
 assert.equal(f.terminal.disposed,undefined);
 }finally{f.session.dispose();}
 }
});
test('PTY Ctrl+C interrupts program without destroying its shell',async()=>{
 const f=fixture();try{await f.session.ready();f.session.execute('long-process');f.session.stop();
 assert.deepEqual(f.writes,[['\x03',false]]);assert.equal(f.terminal.disposed,undefined);
 f.end();f.drain();await until(()=>!f.session.busy);assert.equal(f.events.at(-1).stopped,true);
 }finally{f.session.dispose();}
});
test('missing shell integration fails visibly without sending a command to an untracked shell',async()=>{
 const f=fixture(false);try{await assert.rejects(f.session.ready(1),/Shell Integration/);
 assert.equal(f.terminal.shown,true);assert.deepEqual(f.commands,[]);assert.deepEqual(f.writes,[]);
 }finally{f.session.dispose();}
});
test('disposing a pending PTY prevents later command execution',async()=>{
 const f=fixture(false);const waiting=f.session.ready();f.session.dispose();
 await assert.rejects(waiting,/بسته/);assert.equal(f.terminal.disposed,true);
 assert.throws(()=>f.session.execute('anything'),/آماده/);
});

test('file run keeps requested directory instead of stale integration cwd',async()=>{
 const f=fixture();try{
 await f.session.ready();f.session.execute('python file.py','C:\\Users\\lenovo\\Desktop');
 f.data('done');f.end();f.drain();await until(()=>!f.session.busy);
 assert.equal(f.session.cwd,'C:\\Users\\lenovo\\Desktop');
 }finally{f.session.dispose();}
});
