const puppeteer=require('/tmp/node/node_modules/puppeteer');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function run(label, url){
  const b=await puppeteer.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  const p=await b.newPage();
  await p.setViewport({width:1440,height:900});
  // CPU throttle 4x untuk mensimulasikan device kelas menengah
  const client = await p.target().createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate',{rate:4});
  await client.send('Performance.enable');

  const t0=Date.now();
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
  const tDom=Date.now()-t0;
  await p.waitForFunction(()=>{const g=document.querySelector('#kpiGrid'); return g && g.children.length>0 && document.querySelector('#loadingOverlay').style.display==='none';},{timeout:120000}).catch(()=>null);
  const tReady=Date.now()-t0;

  // metrik CDP
  const m = await client.send('Performance.getMetrics');
  const map=Object.fromEntries(m.metrics.map(x=>[x.name,x.value]));

  // latensi ketik di search tabel (8 karakter)
  await p.evaluate(()=>{const b=document.querySelector('.tab-btn[data-tab="data"]'); b&&b.click();});
  await sleep(800);
  const tType0=Date.now();
  await p.click('#tableSearch');
  await p.type('#tableSearch','SPC0099',{delay:10});
  await sleep(400);
  const tType=Date.now()-tType0;

  // waktu ganti tab
  const tabs=[];
  for (const t of ['wilayah','biaya','utilisasi','overview']){
    const s=Date.now();
    await p.evaluate(t=>document.querySelector(`.tab-btn[data-tab="${t}"]`).click(), t);
    await p.waitForFunction(()=>true);
    await sleep(50);
    tabs.push(Date.now()-s);
  }

  // mengubah filter bulan (berat: re-render semua)
  const s2=Date.now();
  await p.evaluate(()=>{const el=document.querySelector('.month-btn'); el&&el.click();});
  await sleep(600);
  const tMonth=Date.now()-s2;

  console.log(JSON.stringify({
    label, tDom, tReady, typeLatency:tType,
    tabSwitchAvg: Math.round(tabs.reduce((a,b)=>a+b,0)/tabs.length),
    monthFilter:tMonth,
    scriptDurationMs: Math.round((map.ScriptDuration||0)*1000),
    taskDurationMs: Math.round((map.TaskDuration||0)*1000),
    layoutDurationMs: Math.round((map.LayoutDuration||0)*1000),
    recalcStyleMs: Math.round((map.RecalcStyleDuration||0)*1000),
    jsHeapMB: +((map.JSHeapUsedSize||0)/1048576).toFixed(1),
    nodes: map.Nodes, listeners: map.JSEventListeners
  }));
  await b.close();
}
const url = process.argv[2]||'http://localhost:8080/index.html';
const label = process.argv[3]||'baseline';
run(label,url).catch(e=>{console.error('ERR',e.message);process.exit(1)});
