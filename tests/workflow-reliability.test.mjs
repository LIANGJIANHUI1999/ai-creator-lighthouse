import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parse } from 'yaml';

const workflow = parse(await fs.readFile('.github/workflows/monitor.yml','utf8'));
for (const [job, id] of [['collect','archive-reports'],['editor-collect','archive-editor']]) {
  test(`${job}: retries a failed upload without masking a second failure`, () => {
    const steps = workflow.jobs[job].steps;
    const initial = steps.find(step => step.id === id);
    const retry = steps[steps.indexOf(initial) + 1];
    assert.equal(initial['continue-on-error'],true);
    assert.equal(retry.uses,'actions/upload-artifact@v4');
    assert.match(retry.if,new RegExp(`steps\\.${id}\\.outcome == 'failure'`));
    assert.match(retry.if,/!cancelled\(\)/);
    assert.notEqual(retry['continue-on-error'],true);
    assert.equal(retry.with.overwrite,true);
    for (const key of ['name','path','retention-days','if-no-files-found']) assert.equal(retry.with[key],initial.with[key]);
    const measurement = steps.find(step => step.run?.includes('pnpm collect'));
    assert.notEqual(measurement['continue-on-error'],true);
  });
}
test('scheduled measurements retain both environments and the gated publication path', () => {
  assert.equal(workflow.on.schedule[0].cron,'17 1,13 * * *');
  assert.deepEqual(workflow.jobs.publish.needs,['quality-gate','collect','editor-collect']);
  assert.match(workflow.jobs.publish.if,/needs.quality-gate.result == 'success'/);
});
