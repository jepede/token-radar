/** Development-only: uses the preinstalled Puppeteer, never a project/runtime dependency.
 * CHROME_BIN=/allowed/path/to/chrome node scripts/screenshots.mjs
 * or CHROME_CACHE=/allowed/puppeteer/cache node scripts/screenshots.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const require=createRequire(process.env.PPTR_PACKAGE || '/home/hatch/tools/pptr/package.json');
const puppeteer=require('puppeteer-core');
function findChrome(dir,depth=0) {
 if(!dir||!existsSync(dir)||depth>6)return null;
 for(const e of readdirSync(dir,{withFileTypes:true})) {
  const p=join(dir,e.name);
  if(e.isFile()&&['chrome','chrome-headless-shell','chromium'].includes(e.name))return p;
  if(e.isDirectory()){const found=findChrome(p,depth+1);if(found)return found;}
 }
 return null;
}
const executablePath=process.env.CHROME_BIN||findChrome(process.env.CHROME_CACHE||'/home/hatch/tools/pptr');
if(!executablePath)throw new Error('Bundled Chrome not found in allowed tool directory. Set CHROME_BIN or CHROME_CACHE to an authorized browser location.');
const profile=join(repo,'.browser-profile');
const browser=await puppeteer.launch({executablePath,headless:true,userDataDir:profile,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run']});
const errors=[],network=[];
try {
 const page=await browser.newPage();
 await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.setRequestInterception(true);
 page.on('request',r=>{if(/^https?:/.test(r.url())){network.push(r.url());r.abort();}else r.continue();});
 const base=pathToFileURL(join(repo,'out/dashboard/index.html')).href;
 const go=async(hash='radar')=>{await page.goto(base+'#'+hash,{waitUntil:'load'});await page.waitForFunction(()=>document.querySelector('#app')?.getAttribute('aria-busy')==='false');};
 const shot=async(name)=>{
  const path=join(repo,'screenshots',name);await page.screenshot({path,type:'png',fullPage:false,optimizeForSpeed:false});
  if(statSync(path).size>=524288){await page.setViewport({width:1440,height:900,deviceScaleFactor:.85});await page.screenshot({path,type:'png',fullPage:false});await page.setViewport({width:1440,height:900,deviceScaleFactor:1});}
  assert.ok(statSync(path).size<524288,name+' exceeds cap');console.log(`${name}: ${statSync(path).size} bytes`);
 };
 mkdirSync(join(repo,'screenshots'),{recursive:true});
 await go();
 assert.ok(await page.evaluate(()=>Object.values(window.SIGNAL_CHECKS).every(Boolean)),'browser scoring checks');
 assert.equal(await page.$$eval('table.board tbody tr',r=>r.length),20);
 const initialSlugs=await page.$$eval('tr[data-slug]',r=>r.map(x=>x.dataset.slug));
 await shot('1-board.png');
 await page.select('#category','Risk Curators');await page.select('#chain','Ethereum');await page.select('#verdict','FARM');await page.select('#sort','hourly');
 const filtered=await page.evaluate(()=>({text:document.querySelector('#results').textContent,slugs:[...document.querySelectorAll('tr[data-slug]')].map(x=>x.dataset.slug),hash:location.hash,data:window.RADAR.protocols}));
 assert.ok(filtered.slugs.length>0);
 const fs=filtered.slugs.map(s=>filtered.data.find(p=>p.slug===s));
 assert.ok(fs.every(p=>p.category==='Risk Curators'&&p.chains.includes('Ethereum')&&p.farm.verdict==='FARM'));
 assert.ok(fs.every((p,i)=>!i||fs[i-1].farm.hourly>=p.farm.hourly));
 await shot('3-filtered.png');
 const savedFilter=filtered.hash;
 await page.click('.protocol-name');await page.waitForSelector('.detail-value');
 assert.equal(await page.$$eval('.raw-fields dt',e=>e.length),10);
 await page.click('.breadcrumb a');await page.waitForSelector('#results');
 assert.equal(await page.evaluate(()=>location.hash),savedFilter,'detail back preserves filters');
 await go('protocol/veda');await page.waitForSelector('.detail-value');
 assert.equal(await page.$eval('h1',e=>e.textContent),'Veda');
 assert.equal(await page.$$eval('.steps li',r=>r.length),5);
 assert.equal(await page.$$eval('.raw-fields dt',r=>r.length),10);
 assert.ok(await page.$('.decomp'));
 await shot('2-detail.png');
 // Exercise a detail from every populated lane, including live tokens and rejected products.
 const samples=await page.evaluate(()=>window.RADAR.lanes.filter(l=>l.count).map(l=>window.RADAR.protocols.find(p=>p.lane===l.id).slug));
 for(const slug of samples){await go('protocol/'+encodeURIComponent(slug));assert.equal(await page.$$eval('.raw-fields dt',r=>r.length),10);assert.ok(await page.$('.steps'));}
 await go('universe');assert.ok((await page.$eval('#results',e=>e.textContent)).startsWith('758 of 758'));
 await page.select('#lane','bridge');assert.ok((await page.$eval('#results',e=>e.textContent)).startsWith('43 of 758'));
 await go('radar');await page.select('#sort','expected');
 const eSlugs=await page.$$eval('tr[data-slug]',e=>e.map(x=>x.dataset.slug));
 assert.notDeepEqual(eSlugs,initialSlugs);
 assert.ok(await page.evaluate(()=>{const ps=[...document.querySelectorAll('tr[data-slug]')].map(e=>window.RADAR.protocols.find(p=>p.slug===e.dataset.slug));return ps.every((p,i)=>!i||ps[i-1].farm.expected>=p.farm.expected);}));
 await page.type('#search','NO_MATCH_FOR_TEST');assert.ok(await page.$('.empty'));await page.click('#reset');
 await page.waitForSelector('table.board');await page.click('#next');assert.ok((await page.$eval('#page-count',e=>e.textContent)).startsWith('2 /'));
 await go('method');assert.ok(await page.$('#engine-source'));
 assert.ok((await page.$eval('#engine-source',e=>e.textContent)).includes('const ols'));
 // Narrow viewport: the body must fit; the data table may scroll inside its container.
 await page.setViewport({width:390,height:844,deviceScaleFactor:1});
 await go('radar');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile body must not overflow');
 await go('protocol/veda');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile detail must not overflow');
 assert.deepEqual(errors,[],'browser errors');assert.deepEqual(network,[],'external network attempts');
 const result={status:'PASS',checks:await page.evaluate(()=>window.SIGNAL_CHECKS),external_requests:network.length,browser_errors:errors.length,sampled_detail_lanes:samples.length,viewport:'1440×900',screenshots:readdirSync(join(repo,'screenshots')).sort().map(name=>({name,bytes:statSync(join(repo,'screenshots',name)).size}))};
 writeFileSync(join(repo,'out/browser-verification.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
} finally {await browser.close();rmSync(profile,{recursive:true,force:true});}
