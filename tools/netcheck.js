const puppeteer = require('/tmp/node/node_modules/puppeteer');
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const reqs = [];
  p.on('request', r => { if (r.url().includes('docs.google.com')) reqs.push({ t: Date.now(), url: r.url().replace(/^.*gviz\/tq\?/, ''), type: r.resourceType(), initiator: (r.initiator()||{}).type }); });
  p.on('response', r => { if (r.url().includes('docs.google.com')) reqs.push({ t: Date.now(), url: 'RESP ' + r.url().replace(/^.*gviz\/tq\?/, ''), status: r.status() }); });
  await p.goto(process.argv[2] || 'http://localhost:8080/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => /records/.test(document.getElementById('rowCount').textContent) && !/^0 records/.test(document.getElementById('rowCount').textContent.trim()), { timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));
  const res = await p.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.includes('docs.google.com')).map(r => ({
    url: r.name.replace(/^.*gviz\/tq\?/, ''), start: Math.round(r.startTime), dur: Math.round(r.duration),
    respEnd: Math.round(r.responseEnd), transfer: r.transferSize, decoded: r.decodedBodySize
  })));
  console.log('permintaan (network events):'); reqs.forEach(r => console.log(' ', JSON.stringify(r)));
  console.log('resource timing:'); res.forEach(r => console.log(' ', JSON.stringify(r)));
  await b.close();
})();
