import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'yaml';
import { hash, pipelineHealthy } from '../scripts/lib.mjs';
import { summarizeEditor, editorMetrics, editorSeries, validateEditorConfig } from '../web/editor-model.mjs';
import { renderEditorDashboard, renderEditorReport, editorValue } from '../web/editor-view.mjs';
import { archiveEditor } from '../scripts/editor-archive.mjs';
import { runEditorScenario } from '../scripts/editor-scenario.mjs';
import { build } from '../scripts/build.mjs';
import { saveHistory } from '../scripts/history-git.mjs';
import { dataPresentation } from '../web/model.mjs';
import { messages } from '../web/i18n.mjs';
import { execFileSync } from 'node:child_process';
const config = JSON.parse(await fs.readFile('monitor.config.json','utf8'));
const editorConfig = JSON.parse(await fs.readFile('editor-benchmark.config.json','utf8'));
const metrics = {editorReadyMs:1000,previewReadyMs:500,filmstripReadyMs:800,playResponseMs:30,seekResponseMs:50,trimResponseMs:40,droppedFrameRatio:0,longTaskCount:0,exportRtf:.4};
const runs = () => [1,2,3].map(index=>({index,metrics:{...metrics},failures:[],detail:{source:{width:640,height:360,durationMs:5000,previewPipeline:'native-video'},export:{engine:'webcodecs',bytes:1000,videoPipeline:'source-frames'}}}));
const batch = (overrides={}) => ({schemaVersion:1,kind:'editor-benchmark',id:'100-1-editor-staging',environment:'staging',origin:config.environments.staging.origin,path:editorConfig.path,generatedAt:'2026-11-11T08:00:00Z',runsPerBatch:3,comparisonKey:'same',versions:{chrome:'157',engines:['webcodecs'],renderer:'SwiftShader'},fixture:editorConfig.fixture,targets:editorConfig.targets,critical:editorConfig.critical,runs:runs(),failures:[],summary:summarizeEditor(runs(),3,editorConfig),...overrides});
async function temporary(t) { const dir=await fs.mkdtemp(path.join(os.tmpdir(),'editor-monitor-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir; }

test('fixed fixture is the committed 5-second asset with an immutable raw-byte digest',async()=>{
 validateEditorConfig(editorConfig);
 assert.equal(hash(await fs.readFile(editorConfig.fixture.file)),editorConfig.fixture.sha256);
 assert.equal(editorConfig.fixture.durationMs,5000);
 assert.equal(editorConfig.fixture.width,640);
 for(const key of editorMetrics) assert.ok(messages.zh[key]&&messages.en[key]);
});
test('configuration rejects non-isolated URLs, invalid durations and inverted thresholds',()=>{
 for(const change of [{path:'/zh/editor/'},{path:'https://example.com/zh/editor/?benchmark=1'},{playbackSampleMs:9000},{exportTrimRatio:1},{targets:{...editorConfig.targets,seekResponseMs:-1}}]) assert.throws(()=>validateEditorConfig({...editorConfig,...change}));
});
test('aggregation preserves real zero values and reports per-metric samples and ranges',()=>{
 const source=runs();source[0].metrics.previewReadyMs=300;source[2].metrics.previewReadyMs=700;
 const result=summarizeEditor(source,3,editorConfig);
 assert.equal(result.metrics.previewReadyMs,500);assert.deepEqual(result.ranges.previewReadyMs,{min:300,max:700});
 assert.equal(result.metrics.droppedFrameRatio,0);assert.equal(result.statuses.droppedFrameRatio,'pass');assert.equal(result.successCount,3);assert.equal(result.overall,'pass');
});
test('missing APIs, exhausted stages and invalid frame counts remain incomplete rather than zero',()=>{
 const source=runs();source[1].metrics.droppedFrameRatio=null;source[2].metrics.seekResponseMs=NaN;
 const result=summarizeEditor(source,3,editorConfig);
 assert.equal(result.counts.droppedFrameRatio,2);assert.equal(result.statuses.droppedFrameRatio,'failed');assert.equal(result.successCount,1);assert.equal(result.overall,'failed');
 assert.equal(summarizeEditor([],3,editorConfig).metrics.exportRtf,null);
 const invalid=runs();invalid[0].metrics.droppedFrameRatio=2;assert.equal(summarizeEditor(invalid,3,editorConfig).statuses.droppedFrameRatio,'failed');
});
test('budgets keep strict upper bounds and actual critical reasons',()=>{
 const source=runs();for(const run of source)run.metrics.exportRtf=editorConfig.critical.exportRtf;
 assert.equal(summarizeEditor(source,3,editorConfig).statuses.exportRtf,'warning');
 for(const run of source)run.metrics.exportRtf=3;
 assert.equal(summarizeEditor(source,3,editorConfig).statuses.exportRtf,'critical');
});
test('trend series never mixes environments, hardware/engine keys or repeat counts',()=>{
 const a=batch(), b=batch({id:'101-1-editor-staging',generatedAt:'2026-11-11T09:00:00Z'});
 const other=batch({id:'99-1-editor-production',environment:'production'});
 assert.equal(editorSeries([a,b,other],'staging','exportRtf',0).length,2);
 assert.equal(editorSeries([a,{...b,comparisonKey:'new-engine'}],'staging','exportRtf',0).length,1);
 assert.equal(editorSeries([a,{...b,runsPerBatch:1}],'staging','exportRtf',0).length,1);
 const failed=batch({id:'102-1-editor-staging',generatedAt:'2026-11-11T10:00:00Z',comparisonKey:null,summary:summarizeEditor([],3,editorConfig)});
 assert.equal(editorSeries([a,b,failed],'staging','exportRtf',0).length,2);
});
test('dashboard and report expose real metrics, units, distinct historical reports and escaped failures',()=>{
 const a=batch(),b=batch({id:'101-1-editor-staging',generatedAt:'2026-11-11T09:00:00Z'});
 const html=renderEditorDashboard({history:[a,b],environment:'staging',locale:'zh',days:0});
 assert.match(html,/编辑器实操基准/);assert.match(html,/播放掉帧率/);assert.match(html,/reports\/editor\/100-1-editor-staging.html/);assert.match(html,/reports\/editor\/101-1-editor-staging.html/);
 assert.equal(editorValue('droppedFrameRatio',.0123,'en'),'1.23');
 const report=renderEditorReport(batch({failures:[{message:'<img onerror=x>'}]}),'en');
 assert.match(report,/&lt;img onerror=x&gt;/);assert.doesNotMatch(report,/<img onerror/);assert.match(report,/Individual runs/);
 assert.match(renderEditorDashboard({history:[],environment:'staging',locale:'en'}),/No editor workflow measurements/);
});
test('navigation failure is captured as evidence without uploading media or losing the batch',async()=>{
 const result=await runEditorScenario({goto:async()=>{throw new Error('Navigation timeout');}},{url:'https://example.com/zh/editor/?benchmark=1',fixturePath:'unused',config:editorConfig});
 assert.equal(result.failures[0].stage,'navigation');assert.equal(result.metrics.exportRtf,null);assert.equal(result.detail.stages[0].status,'failed');
});
test('editor archives are independent, immutable and preserve partial-run evidence',async t=>{
 const dir=await temporary(t),incoming=path.join(dir,'incoming'),data=path.join(dir,'data');
 await fs.mkdir(path.join(incoming,'editor-staging'),{recursive:true});
 await fs.writeFile(path.join(incoming,'editor-staging','summary.json'),JSON.stringify(batch()));
 const options={config,editorConfig,dataDirectory:data,incomingDirectory:incoming,artifacts:[{id:1,name:'editor-staging-100-1',expires_at:'2026-12-11T00:00:00Z'}],environments:['staging'],runId:'100',attempt:'1'};
 const first=await archiveEditor(options),second=await archiveEditor(options);
 assert.equal(second.history.length,1);assert.match(first.additions[0].artifact.url,/artifacts\/1$/);
 assert.equal(first.additions[0].runs[0].detail.export.videoPipeline,'source-frames');
 assert.equal(first.additions[0].runs[0].detail.source.previewPipeline,'native-video');
 const missing=await archiveEditor({...options,environments:['production'],expectedRuns:1});
 assert.equal(missing.additions[0].summary.overall,'failed');assert.equal(missing.additions[0].summary.expectedCount,1);
});
test('static build publishes editor history and reports while leaving Lighthouse records available',async t=>{
 const dir=await temporary(t);
 await build({config,history:[],editorHistory:[batch()],editorConfig,webDirectory:'web',outputDirectory:dir});
 const data=JSON.parse(await fs.readFile(path.join(dir,'data.json'),'utf8'));
 assert.equal(data.editorSummaries.length,1);assert.deepEqual(data.summaries,[]);
 assert.match(await fs.readFile(path.join(dir,'reports/editor/100-1-editor-staging.html'),'utf8'),/编辑器实操基准/);
 assert.equal(dataPresentation({loading:false,error:false,data}).hidden,true);
});
test('editor-only history can initialize and update the data branch',async t=>{
 const dir=await temporary(t),remote=path.join(dir,'remote.git'),work=path.join(dir,'work');
 const git=(args,cwd=dir)=>execFileSync('git',args,{cwd,stdio:'pipe'});
 git(['init','--bare',remote]);git(['init',work]);git(['config','user.name','Test'],work);git(['config','user.email','test@example.invalid'],work);git(['commit','--allow-empty','-m','Initial'],work);git(['checkout','--detach'],work);git(['remote','add','origin',remote],work);
 await fs.mkdir(path.join(work,'editor-history'));await fs.writeFile(path.join(work,'editor-history','100-1-editor-staging.json'),JSON.stringify(batch()));
 assert.equal(saveHistory(work,'Archive editor workflow'),true);
});
test('health requires exactly the requested suites and still requires publication',()=>{
 const base={event:'workflow_dispatch',collection:'skipped',editorCollection:'success',suite:'editor',publish:'success',deploy:'success'};
 assert.equal(pipelineHealthy({failed:0},base),true);
 assert.equal(pipelineHealthy({failed:0},{...base,editorCollection:'skipped'}),false);
 assert.equal(pipelineHealthy({failed:0},{...base,suite:'all'}),false);
 assert.equal(pipelineHealthy({failed:1},base),false);
 assert.equal(pipelineHealthy({failed:0},{...base,deploy:'failure'}),false);
});
test('scheduled editor runs are gated and archive evidence before health checks',async()=>{
 const workflow=parse(await fs.readFile('.github/workflows/monitor.yml','utf8'));
 assert.equal(workflow.on.workflow_dispatch.inputs.suite.default,'lighthouse');
 assert.equal(workflow.jobs['editor-collect'].needs,'quality-gate');assert.equal(workflow.jobs['editor-collect'].strategy['fail-fast'],false);
 assert.ok(workflow.jobs.publish.needs.includes('editor-collect'));assert.ok(workflow.jobs.deploy.needs.includes('quality-gate'));
 const upload=workflow.jobs['editor-collect'].steps.find(step=>step.name==='Archive editor workflow evidence');assert.equal(upload.if,'always()');assert.equal(upload.with['retention-days'],30);
});
