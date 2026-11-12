import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { resolveSettings } from 'lighthouse/core/config/config-helpers.js';
import { screenEmulationMetrics, throttling, userAgents } from 'lighthouse/core/config/constants.js';
import { selectPlan, collectionMatrix, validateConfig, runCollection, comparableBaseline } from '../scripts/lib.mjs';
import { archive, latestRoutes } from '../scripts/archive.mjs';
import { build } from '../scripts/build.mjs';
import { latestForRoute, seriesFor } from '../web/model.mjs';
import { summaryDevice, batchId, artifactName } from '../web/devices.mjs';

const config = JSON.parse(await fs.readFile('monitor.config.json', 'utf8'));
const metric = score => ({performance:score,accessibility:100,bestPractices:100,seo:100,lcpMs:1200,cls:0,tbtMs:10});
const route = score => ({...config.routes[0],metrics:metric(score),status:'pass',successCount:3,expectedCount:3,representative:'landing-run-1-attempt-1'});
const summary = (device, runId, score = 99) => ({schemaVersion:1,id:batchId(runId,'1','production',device),environment:'production',device,profile:device==='mobile'?config.mobileProfile:config.profile,generatedAt:`2026-11-12T${runId==='100'?'01':'02'}:17:00Z`,comparisonKey:'deliberately-same-key',runsPerRoute:3,targets:config.targets,critical:config.critical,routes:[route(score)]});
const lhr = url => ({requestedUrl:url,finalDisplayedUrl:url,categories:Object.fromEntries(['performance','accessibility','best-practices','seo'].map(id=>[id,{score:1}])),audits:{'http-status-code':{score:1},'largest-contentful-paint':{numericValue:1200},'cumulative-layout-shift':{numericValue:0},'total-blocking-time':{numericValue:10}}});
async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mobile-lighthouse-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('mobile uses the installed Lighthouse Android, viewport, slow 4G and CPU defaults',()=>{
 const mobile=selectPlan(config,{environment:'staging',device:'mobile'});
 const {id,...flags}=mobile.profile, settings=resolveSettings({},flags);
 assert.equal(id,'mobile-v1-slow4g'); assert.equal(mobile.device,'mobile');
 assert.equal(settings.formFactor,'mobile');assert.equal(settings.emulatedUserAgent,userAgents.mobile);
 assert.match(settings.emulatedUserAgent,/Android.*Mobile/);assert.deepEqual(settings.screenEmulation,screenEmulationMetrics.mobile);
 for(const key of ['rttMs','throughputKbps','cpuSlowdownMultiplier','requestLatencyMs','uploadThroughputKbps'])assert.equal(settings.throttling[key],throttling.mobileSlow4G[key]);
 assert.ok(Math.abs(settings.throttling.downloadThroughputKbps-throttling.mobileSlow4G.downloadThroughputKbps)<1e-8);
 assert.equal(settings.disableStorageReset,false);assert.equal(selectPlan(config).profile,config.profile);
});
test('invalid devices and inconsistent phone profiles are rejected before collection',()=>{
 for(const device of ['tablet','',null])assert.throws(()=>selectPlan(config,{device}));
 for(const mutate of [p=>p.formFactor='desktop',p=>p.emulatedUserAgent=false,p=>p.screenEmulation.mobile=false,p=>p.screenEmulation.width=0,p=>p.screenEmulation.deviceScaleFactor=-1,p=>p.throttling.cpuSlowdownMultiplier=0,p=>p.disableStorageReset=true]){
  const bad=structuredClone(config);mutate(bad.mobileProfile);assert.throws(()=>validateConfig(bad));
 }
});
test('scheduled matrix includes four isolated targets and manual inputs can select one device',()=>{
 const all=collectionMatrix(config);assert.equal(all.include.length,4);
 assert.equal(new Set(all.include.map(x=>x.directory)).size,4);assert.equal(new Set(all.include.map(x=>x.artifactPrefix)).size,4);
 assert.deepEqual(collectionMatrix(config,{environment:'staging',device:'mobile',routes:'subscribe'}).include,[{environment:'staging',device:'mobile',directory:'mobile/staging',artifactPrefix:'lighthouse-mobile-staging'}]);
 assert.equal(collectionMatrix(config,{device:'desktop'}).include.length,2);
 assert.throws(()=>collectionMatrix(config,{device:'mobile',routes:'subscribe'}),/unavailable/);
});
test('phone collection keeps its profile, counts and errors independently',async()=>{
 const plan=selectPlan(config,{environment:'staging',device:'mobile',routes:'subscribe',runs:3});
 const good=await runCollection({config,plan,metadata:{id:'phone'},audit:async url=>({lhr:lhr(url)}),saveReport:async()=>{}});
 assert.equal(good.device,'mobile');assert.deepEqual(good.profile,config.mobileProfile);assert.equal(good.routes[0].successCount,3);
 const bad=await runCollection({config,plan,metadata:{id:'failed'},audit:async()=>{throw new Error('network timeout');},saveReport:async()=>{}});
 assert.equal(bad.routes[0].status,'failed');assert.equal(bad.routes[0].metrics.performance,null);assert.equal(bad.routes[0].errors.length,6);
});
test('legacy desktop latest, trends and regression baselines never absorb newer mobile data',()=>{
 const desk=summary('desktop','100'), phone=summary('mobile','101',40);delete desk.device;
 assert.equal(summaryDevice(desk),'desktop');assert.equal(latestForRoute([desk,phone],'production','landing').summary.id,desk.id);
 assert.equal(latestForRoute([desk,phone],'production','landing','mobile').summary.id,phone.id);
 assert.equal(latestRoutes([desk,phone],'production').get('landing').route.metrics.performance,99);
 assert.equal(seriesFor([desk,phone],'production','landing','performance',0).length,1);
 assert.equal(seriesFor([desk,phone],'production','landing','performance',0,Date.now(),'mobile')[0].value,40);
 assert.equal(comparableBaseline([desk],phone,'landing'),null);
 const failed={...phone,comparisonKey:null,routes:[{...phone.routes[0],status:'failed',metrics:{}}]};
 assert.equal(seriesFor([desk,failed],'production','landing','performance',0,Date.now(),'mobile').length,0);
});
test('archive preserves old bytes and independently identifies both devices and artifacts',async t=>{
 const root=await temporary(t),data=path.join(root,'data'),incoming=path.join(root,'incoming');
 await fs.mkdir(path.join(data,'history'),{recursive:true});const old=summary('desktop','100');delete old.device;
 const oldBytes=JSON.stringify(old);await fs.writeFile(path.join(data,'history',old.id+'.json'),oldBytes);
 for(const [device,folder] of [['desktop','production'],['mobile','mobile/production']]){
  await fs.mkdir(path.join(incoming,folder),{recursive:true});await fs.writeFile(path.join(incoming,folder,'summary.json'),JSON.stringify(summary(device,'201',device==='mobile'?40:98)));
 }
 const artifacts=['desktop','mobile'].map((device,i)=>({id:10+i,name:artifactName('production',device,'201','1'),expires_at:'2026-12-12'}));
 const result=await archive({config,dataDirectory:data,incomingDirectory:incoming,artifactList:artifacts,runId:'201',runAttempt:'1',environments:['production'],devices:['desktop','mobile']});
 assert.equal(result.history.length,3);assert.equal(result.incoming[0].artifact.id,10);assert.equal(result.incoming[1].artifact.id,11);
 assert.equal(await fs.readFile(path.join(data,'history',old.id+'.json'),'utf8'),oldBytes);
 const repeat=await archive({config,dataDirectory:data,incomingDirectory:incoming,artifactList:artifacts,runId:'201',runAttempt:'1',environments:['production'],devices:['desktop','mobile']});assert.equal(repeat.history.length,3);
});
test('missing phone collection stays a phone failure with the requested routes and sample count',async t=>{
 const root=await temporary(t);
 const result=await archive({config,dataDirectory:path.join(root,'data'),incomingDirectory:path.join(root,'missing'),artifactList:[],runId:'500',runAttempt:'1',environments:['production'],devices:['mobile'],expectedRuns:5,routes:'landing'});
 const batch=result.incoming[0];assert.equal(batch.id,'500-1-production-mobile');assert.equal(batch.device,'mobile');assert.deepEqual(batch.profile,config.mobileProfile);
 assert.equal(batch.runsPerRoute,5);assert.equal(batch.routes.length,1);assert.equal(batch.routes[0].expectedCount,5);assert.equal(batch.routes[0].status,'failed');assert.equal(batch.artifact,null);
});
test('archive refuses a desktop payload in the mobile folder',async t=>{
 const root=await temporary(t),incoming=path.join(root,'incoming');await fs.mkdir(path.join(incoming,'mobile/production'),{recursive:true});
 const wrong=summary('desktop','600');wrong.id='600-1-production-mobile';await fs.writeFile(path.join(incoming,'mobile/production/summary.json'),JSON.stringify(wrong));
 await assert.rejects(archive({config,dataDirectory:path.join(root,'data'),incomingDirectory:incoming,artifactList:[],runId:'600',runAttempt:'1',environments:['production'],devices:['mobile']}),/identity/);
});
test('build retains desktop report URLs and emits separate phone reports and summary downloads',async t=>{
 const root=await temporary(t),out=path.join(root,'dist'),history=[summary('desktop','100'),summary('mobile','101',40)];
 for(const device of ['desktop','mobile'])for(const ext of ['html','json'])await fs.writeFile(path.join(root,`${device}.${ext}`),`${device} report`);
 await build({config,history,webDirectory:new URL('../web/',import.meta.url),outputDirectory:out,findReport:async s=>path.join(root,summaryDevice(s))});
 const data=JSON.parse(await fs.readFile(path.join(out,'data.json'),'utf8'));
 assert.deepEqual(data.reports,data.reportsByDevice.desktop);
 assert.equal(data.summaries.length,1);assert.equal(summaryDevice(data.summaries[0]),'desktop');
 assert.equal(data.summariesByDevice.mobile[0].device,'mobile');
 assert.equal(data.reports.production.landing.html,'reports/production/landing.html');
 assert.equal(data.reportsByDevice.mobile.production.landing.html,'reports/production/mobile/landing.html');
 assert.equal(await fs.readFile(path.join(out,'reports/production/landing.html'),'utf8'),'desktop report');
 assert.equal(await fs.readFile(path.join(out,'reports/production/mobile/landing.html'),'utf8'),'mobile report');
 assert.equal(JSON.parse(await fs.readFile(path.join(out,'history/101-1-production-mobile.json'),'utf8')).device,'mobile');
});
test('workflow consumes validated device matrix and archives only the requested device set',async()=>{
 const flow=parse(await fs.readFile('.github/workflows/monitor.yml','utf8'));
 assert.deepEqual(flow.on.workflow_dispatch.inputs.device.options,['all','desktop','mobile']);
 assert.match(flow.jobs.collect.strategy.matrix,/needs.quality-gate.outputs.collect_matrix/);
 assert.match(flow.jobs.collect.steps.find(x=>x.run?.startsWith('pnpm collect ')).run,/--device=/);
 const archive=flow.jobs.publish.steps.find(x=>x.name==='Append immutable metric history');
 assert.equal(archive.env.TARGET_DEVICES,'${{ needs.quality-gate.outputs.lighthouse_devices }}');
 assert.equal(flow.jobs.deploy.needs.includes('quality-gate'),true);
});

test('the workflow planning step emits the exact scheduled matrix and rejects mobile editor requests',async t=>{
 const {execFileSync}=await import('node:child_process');
 const workflow=parse(await fs.readFile('.github/workflows/monitor.yml','utf8'));
 const script=workflow.jobs['quality-gate'].steps.find(step=>step.id==='plan').run;
 const dir=await temporary(t);
 for(const [device,suite,count,expected] of [['all','all',4,'desktop,mobile'],['mobile','lighthouse',2,'mobile'],['all','editor',2,'desktop']]){
  const output=path.join(dir,`${device}-${suite}.txt`);
  execFileSync('bash',['-c',script],{env:{...process.env,TARGET:'all',DEVICE:device,SUITE:suite,ROUTES:'',RUNS:'3',GITHUB_OUTPUT:output},stdio:'pipe'});
  const lines=Object.fromEntries((await fs.readFile(output,'utf8')).trim().split('\n').map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
  assert.equal(JSON.parse(lines.collect_matrix).include.length,count);assert.equal(lines.lighthouse_devices,expected);
 }
 assert.throws(()=>execFileSync('bash',['-c',script],{env:{...process.env,TARGET:'all',DEVICE:'mobile',SUITE:'editor',ROUTES:'',RUNS:'3',GITHUB_OUTPUT:path.join(dir,'invalid.txt')},stdio:'pipe'}),/desktop-only/);
});
test('unavailable mobile reports do not reuse an existing desktop download',async t=>{
 const root=await temporary(t),out=path.join(root,'out');
 for(const ext of ['html','json'])await fs.writeFile(path.join(root,`desktop.${ext}`),'desktop');
 await build({config,history:[summary('desktop','100'),summary('mobile','101')],webDirectory:new URL('../web/',import.meta.url),outputDirectory:out,findReport:async record=>summaryDevice(record)==='desktop'?path.join(root,'desktop'):null});
 const data=JSON.parse(await fs.readFile(path.join(out,'data.json'),'utf8'));
 assert.ok(data.reports.production.landing);assert.equal(data.reportsByDevice.mobile.production.landing,undefined);
});
