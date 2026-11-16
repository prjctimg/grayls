import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const samplePath = path.join(root, 'main.gray');
const sampleText = fs.readFileSync(samplePath, 'utf8');
const sampleUri = 'file://' + samplePath;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function readProcStat(pid){
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').trim();
    const m = stat.match(/^(\d+) \((.*)\) ([RSDZTW]) (.*)$/);
    if(!m) return null;
    const rest = m[4].split(' ').map(x=>Number(x));
    const utime = rest[9]; const stime = rest[10];
    return { utime, stime };
  } catch { return null; }
}
function readProcStatus(pid){
  try {
    const s = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss = Number((s.match(/^VmRSS:\s*(\d+)\s*kB/m)||[])[1]||0);
    const hwm = Number((s.match(/^VmHWM:\s*(\d+)\s*kB/m)||[])[1]||0);
    return { rss, hwm };
  } catch { return null; }
}
const clkTck = 100;

class LspClient {
  constructor(cmd, args, opts={}){
    this.cmd=cmd; this.args=args; this.name=opts.name||cmd;
    this.proc=null; this.buf=Buffer.alloc(0); this.nextId=1; this.pending=new Map();
    this.notifications=[]; this.samples=[]; this.sampler=null; this.peakRss=0; this.cpuStart=null; this.cpuEnd=null;
  }
  start(){
    this.proc = spawn(this.cmd, this.args, { cwd: root, stdio: ['pipe','pipe','pipe'] });
    this.proc.stdout.on('data', d=>this._onData(d));
    this.proc.stderr.on('data', ()=>{});
    this.cpuStart = readProcStat(this.proc.pid);
    this.sampler = setInterval(()=>{
      const st = readProcStatus(this.proc.pid);
      const cs = readProcStat(this.proc.pid);
      if(st){ this.samples.push(st.rss); if(st.rss>this.peakRss) this.peakRss=st.rss; }
      if(cs) this.cpuEnd = cs;
    }, 20);
  }
  _onData(chunk){
    this.buf = Buffer.concat([this.buf, chunk]);
    while(true){
      const headerEnd = this.buf.indexOf('\r\n\r\n');
      if(headerEnd===-1) break;
      const header = this.buf.slice(0, headerEnd).toString('ascii');
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if(!m) { this.buf = this.buf.slice(headerEnd+4); continue; }
      const len = Number(m[1]);
      const total = headerEnd + 4 + len;
      if(this.buf.length < total) break;
      const body = this.buf.slice(headerEnd+4, total).toString('utf8');
      this.buf = this.buf.slice(total);
      let msg; try{ msg=JSON.parse(body); }catch{ continue; }
      if(msg.id!=null && this.pending.has(msg.id)){
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        p.resolve({msg, ms: performance.now()-p.t0});
      } else {
        this.notifications.push(msg);
      }
    }
  }
  send(msg){
    const json = JSON.stringify(msg);
    const pkt = `Content-Length: ${Buffer.byteLength(json,'utf8')}\r\n\r\n${json}`;
    this.proc.stdin.write(pkt);
  }
  request(method, params){
    const id = this.nextId++;
    const t0 = performance.now();
    return new Promise((resolve,reject)=>{
      const timer = setTimeout(()=>{ this.pending.delete(id); reject(new Error(`timeout ${method}`)); }, 20000);
      this.pending.set(id,{resolve:(v)=>{clearTimeout(timer); resolve(v);}, t0});
      this.send({jsonrpc:'2.0', id, method, params});
    });
  }
  notify(method, params){ this.send({jsonrpc:'2.0', method, params}); }
  async stop(){
    if(this.sampler) clearInterval(this.sampler);
    try { await this.request('shutdown', null); } catch {}
    try { this.notify('exit', null); } catch {}
    await new Promise(r=>{ const t=setTimeout(()=>{try{this.proc.kill('SIGKILL');}catch{} r();},800); this.proc.on('exit',()=>{clearTimeout(t); r();}); });
    this.cpuEnd = this.cpuEnd || readProcStat(this.proc.pid);
  }
  metrics(){
    const avgRss = this.samples.length ? this.samples.reduce((a,b)=>a+b,0)/this.samples.length : 0;
    let cpuSec = 0;
    if(this.cpuStart && this.cpuEnd){ cpuSec = ((this.cpuEnd.utime+this.cpuEnd.stime)-(this.cpuStart.utime+this.cpuStart.stime))/clkTck; }
    return { peakRssKb: this.peakRss, avgRssKb: avgRss, cpuSec };
  }
}

function posFor(text, needle, occ=1){
  let idx=-1, from=0;
  for(let i=0;i<occ;i++){ idx=text.indexOf(needle, from); if(idx<0) return {line:0,character:0}; from=idx+needle.length; }
  const before = text.slice(0,idx); const lines = before.split('\n');
  return { line: lines.length-1, character: lines[lines.length-1].length };
}

async function runScenario(target){
  const c = new LspClient(target.cmd, target.args, {name: target.name});
  c.start();
  await sleep(40);
  const timings = {};
  const measure = async (label, fn)=>{ const r = await fn(); timings[label]=r.ms; return r; };

  await measure('initialize', ()=>c.request('initialize', {
    processId: process.pid,
    rootUri: 'file://' + root,
    capabilities: {},
    workspaceFolders: [{uri:'file://'+root, name:'grayls'}]
  }));
  c.notify('initialized', {});
  c.notify('textDocument/didOpen', { textDocument: { uri: sampleUri, languageId: 'gray', version: 1, text: sampleText } });
  await sleep(150);

  await measure('hover', ()=>c.request('textDocument/hover', { textDocument:{uri:sampleUri}, position: posFor(sampleText,'APP_NAME') }));
  await measure('completion', ()=>c.request('textDocument/completion', { textDocument:{uri:sampleUri}, position: posFor(sampleText,'strings.') }));
  const dotPos = posFor(sampleText,'strings.'); dotPos.character += 'strings.'.length;
  timings['completion.member'] = (await c.request('textDocument/completion', { textDocument:{uri:sampleUri}, position: dotPos })).ms;
  await measure('definition', ()=>c.request('textDocument/definition', { textDocument:{uri:sampleUri}, position: posFor(sampleText,'Point',2) }));
  await measure('documentSymbol', ()=>c.request('textDocument/documentSymbol', { textDocument:{uri:sampleUri} }));
  await measure('references', ()=>c.request('textDocument/references', { textDocument:{uri:sampleUri}, position: posFor(sampleText,'APP_NAME'), context:{includeDeclaration:true} }));
  try { await measure('inlayHint', ()=>c.request('textDocument/inlayHint', { textDocument:{uri:sampleUri}, range:{ start:{line:0,character:0}, end:{line: Math.min(150, sampleText.split('\n').length-1), character:0 } } })); }
  catch(e){ timings['inlayHint'] = NaN; }
  try { await measure('formatting', ()=>c.request('textDocument/formatting', { textDocument:{uri:sampleUri}, options:{tabSize:2, insertSpaces:true} })); }
  catch(e){ timings['formatting'] = NaN; }

  const burstStart = performance.now();
  for(let i=0;i<10;i++){
    c.notify('textDocument/didChange', { textDocument:{uri:sampleUri, version:2+i}, contentChanges:[{text: sampleText + `\n// bench ${i}\n`}] });
    await c.request('textDocument/hover', { textDocument:{uri:sampleUri}, position: posFor(sampleText,'APP_NAME') });
  }
  timings['editBurst.10x.hover'] = performance.now()-burstStart;

  await c.stop();
  return { timings, metrics: c.metrics() };
}

function stats(arr){
  const a=[...arr].sort((x,y)=>x-y);
  const sum=a.reduce((s,v)=>s+v,0);
  const mean=sum/a.length;
  const med=a[Math.floor(a.length/2)];
  return {mean, med, min:a[0], max:a[a.length-1]};
}

async function benchTarget(target, runs=3){
  const all=[];
  for(let i=0;i<runs;i++) all.push(await runScenario(target));
  const keys = Object.keys(all[0].timings);
  const timings={};
  for(const k of keys){
    const vals = all.map(r=>r.timings[k]).filter(Number.isFinite);
    timings[k]= vals.length? stats(vals): null;
  }
  const peakRss = Math.max(...all.map(r=>r.metrics.peakRssKb));
  const avgRss = stats(all.map(r=>r.metrics.avgRssKb)).mean;
  const cpu = stats(all.map(r=>r.metrics.cpuSec)).mean;
  return { name: target.name, runs, timings, peakRss, avgRss, cpu };
}

const targets = [
  { name: 'server.js (Node)', cmd: process.execPath, args: [path.join(root,'out/server.js'), '--stdio'] },
  { name: 'native (scriptc)', cmd: path.join(root,'out/grayls'), args: ['--stdio'] },
];

const results=[];
for(const t of targets){
  console.error('Benchmarking', t.name);
  results.push(await benchTarget(t, 3));
}
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), sample: path.relative(root,samplePath), results }, null, 2));
