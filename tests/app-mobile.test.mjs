import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const config=JSON.parse(await fs.readFile('monitor.config.json','utf8'));
function batch(device,score,id){return {schemaVersion:1,id,environment:'production',device,profile:device==='mobile'?config.mobileProfile:config.profile,generatedAt:new Date(Date.now()-(device==='mobile'?0:60000)).toISOString(),comparisonKey:'same-on-purpose',runsPerRoute:3,targets:config.targets,critical:config.critical,routes:[{...config.routes[0],metrics:{performance:score,accessibility:100,bestPractices:100,seo:100,lcpMs:1000,cls:0,tbtMs:10},status:'pass',successCount:3,expectedCount:3}]};}
async function harness(t,payload,search,tag){
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,setAttribute(){},removeAttribute(){}});return elements.get(id);};
 const saved=Object.fromEntries(['document','location','history','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 t.after(()=>{for(const[key,descriptor]of Object.entries(saved))descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
 let click,url;
 globalThis.document={documentElement:{},getElementById:element,querySelectorAll:()=>[],addEventListener:(event,fn)=>{if(event==='click')click=fn;}};
 globalThis.location={search,hash:''};globalThis.history={replaceState(_a,_b,value){url=value;}};
 globalThis.fetch=async()=>({ok:true,json:async()=>payload});
 await import(`../web/app.mjs?mobile-test=${tag}`);await new Promise(resolve=>setImmediate(resolve));
 return{element,press:dataset=>click({target:{closest:()=>({dataset})}}),url:()=>url};
}
test('device switching isolates latest scores, freshness, charts, history and report links',async t=>{
 const desk=batch('desktop',99,'desktop-old'),phone=batch('mobile',42,'mobile-new');delete desk.device;
 const reports={production:{landing:{summaryId:desk.id,html:'reports/production/landing.html',json:'reports/production/landing.json'}}};
 const mobileReports={production:{landing:{summaryId:phone.id,html:'reports/production/mobile/landing.html',json:'reports/production/mobile/landing.json'}}};
 const h=await harness(t,{schemaVersion:1,config,summaries:[desk],summariesByDevice:{desktop:[desk],mobile:[phone]},reports,reportsByDevice:{desktop:reports,mobile:mobileReports}},'?env=production','switch');
 assert.match(h.element('metrics').innerHTML,/>99<small>/);assert.doesNotMatch(h.element('history-list').innerHTML,/mobile-new/);
 assert.match(h.element('report-links').innerHTML,/reports\/production\/landing.html/);
 h.press({device:'mobile'});
 assert.match(h.element('devices').innerHTML,/data-device="mobile" aria-pressed="true"/);
 assert.match(h.element('metrics').innerHTML,/>42<small>/);assert.match(h.element('device-profile').textContent,/手机端.*412 × 823.*1.75/);
 assert.match(h.element('device-throttling').textContent,/150 ms.*1638.4 Kbps.*×4/);
 assert.equal(h.element('device-note').hidden,false);
 assert.match(h.element('report-links').innerHTML,/reports\/production\/mobile\/landing.html/);
 assert.doesNotMatch(h.element('history-list').innerHTML,/desktop-old/);assert.match(h.element('history-list').innerHTML,/mobile-new/);
 assert.match(h.url(),/device=mobile/);assert.match(h.element('sample-data').innerHTML,/>42<\/td>/);
 h.press({device:'desktop'});assert.match(h.element('metrics').innerHTML,/>99<small>/);assert.equal(h.element('device-note').hidden,true);
});
test('mobile deep links never fall back to desktop scores or desktop report downloads',async t=>{
 const desk=batch('desktop',99,'desk-only');delete desk.device;
 const h=await harness(t,{schemaVersion:1,config,summaries:[desk],reports:{production:{landing:{summaryId:desk.id,html:'desktop.html'}}}},'?env=production&device=mobile&lang=en','empty');
 assert.match(h.element('device-profile').textContent,/Mobile.*412/);assert.doesNotMatch(h.element('metrics').innerHTML,/>99/);
 assert.doesNotMatch(h.element('report-links').innerHTML,/desktop.html/);assert.match(h.element('report-links').innerHTML,/No valid page report/);
 assert.match(h.element('chart').innerHTML,/No complete comparable samples/);assert.equal(h.element('history-list').innerHTML.includes('desk-only'),false);
 assert.match(h.url(),/device=mobile/);
 h.press({view:'editor'});assert.equal(h.element('lighthouse-view').hidden,true);assert.equal(h.element('editor-view').hidden,false);
});

test('a dashboard with only mobile measurements remains visible and uses its shared URL device',async t=>{
 const phone=batch('mobile',65,'only-mobile');
 const h=await harness(t,{schemaVersion:1,config,summaries:[],summariesByDevice:{desktop:[],mobile:[phone]},reports:{},reportsByDevice:{desktop:{},mobile:{}}},'?env=production&device=mobile','mobile-only');
 assert.equal(h.element('dashboard').hidden,false);assert.equal(h.element('load-status').hidden,true);
 assert.match(h.element('metrics').innerHTML,/>65<small>/);assert.match(h.element('device-profile').textContent,/手机端/);
});

for (const locale of ['zh', 'en']) test(`signed-out account coverage is explicit across devices and environment switches (${locale})`, async t => {
 const records = ['desktop', 'mobile'].map(device => {
  const summary = batch(device, 98, `account-${device}`); summary.environment = 'staging';
  summary.routes = ['orders-login', 'credits-login'].map(id => ({ ...summary.routes[0], ...config.routes.find(route => route.id === id) }));
  return summary;
 });
 const h = await harness(t, { schemaVersion: 1, config, summaries: [records[0]], summariesByDevice: { desktop: [records[0]], mobile: [records[1]] }, reports: {} }, `?env=staging&page=orders-login&lang=${locale}`, `account-${locale}`);
 const note = locale === 'zh' ? /仅测量未登录.*不代表登录后的订单/ : /signed-out sign-in entry only.*not authenticated orders/;
 assert.equal(h.element('selected-scope').hidden, false); assert.match(h.element('selected-scope').textContent, note);
 assert.match(h.element('selected-page').textContent, locale === 'zh' ? /订单.*未登录/ : /Orders.*signed out/);
 assert.equal(h.element('site-link').href, 'https://vidmaeditor-ios.web.app/en/account/orders/');
 assert.match(h.element('overview').innerHTML, locale === 'zh' ? /积分记录（未登录入口）/ : /Credits \(signed out\)/);
 h.press({ device: 'mobile' }); assert.equal(h.element('selected-scope').hidden, false); assert.match(h.element('selected-scope').textContent, note);
 h.press({ route: 'credits-login' }); assert.equal(h.element('selected-scope').hidden, false); assert.equal(h.element('site-link').href, 'https://vidmaeditor-ios.web.app/en/account/credits/');
 h.press({ route: 'asset' }); assert.equal(h.element('selected-scope').hidden, true); assert.equal(h.element('selected-scope').textContent, '');
 h.press({ env: 'production' });
 for (const id of ['orders-login', 'credits-login', 'asset', 'ai-sprite', 'image-edit', 'subtitle-translation']) assert.doesNotMatch(h.element('routes').innerHTML, new RegExp(`data-route="${id}"`));
 assert.equal(h.element('selected-scope').hidden, true); assert.equal(h.element('site-link').href, 'https://vidma.ai/');
});
