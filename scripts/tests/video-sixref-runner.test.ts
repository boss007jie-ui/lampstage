import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHypitRunner, H3_CAPABILITY, H3_ENDPOINT, SIXREF_PROVIDER, type CliProcess } from '../../apps/web/lib/video/hypit-runner';

async function fixture(statusBuild?: Record<string, unknown>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-sixref-'));
  const workspace = path.join(root, 'job');
  await mkdir(workspace);
  await mkdir(path.join(root, 'packages', SIXREF_PROVIDER), { recursive: true });
  await writeFile(path.join(root, 'packages', SIXREF_PROVIDER, 'package.json'), '{}');
  const cli = path.join(root, 'hypit.mjs');
  await writeFile(cli, '');
  const runtime = path.join(root, 'sixref-runtime.json');
  const profile = { format: 'hypit.runtime-local@1', credentials: { env: { use: '@hypit/credential-store-env' } },
    endpoints: { [H3_ENDPOINT]: { use: SIXREF_PROVIDER, config: { baseUrl: 'https://www.runninghub.cn', apiKey: { store: 'env', key: 'RUNNINGHUB_API_KEY_01' } } } },
    bindings: { [H3_CAPABILITY]: H3_ENDPOINT } };
  await writeFile(runtime, JSON.stringify(profile));
  await writeFile(`${runtime}.account.json`, JSON.stringify({ account: '01', endpoint: H3_ENDPOINT, credential: { store: 'env', key: 'RUNNINGHUB_API_KEY_01' }, packageRoot: root }));
  const calls: string[][] = [];
  const mock: CliProcess = async (_cli, args) => {
    calls.push(args);
    if (args[0] === 'auth') return { format: 'hypit.cli-auth-status@1', endpoint: H3_ENDPOINT, credentials: [{ endpoint: H3_ENDPOINT, slot: 'apiKey', configured: true }] };
    if (args[0] === 'check') return { format: 'hypit.cli-check@1', ok: true };
    if (args[0] === 'plan') return { format: 'hypit.cli-plan@1', ok: true, requestCount: 1, requestIssueCount: 0, preflight: { ok: true }, providers: [{ endpoint: H3_ENDPOINT, use: SIXREF_PROVIDER, status: 'resolved' }] };
    if (args[0] === 'build') return { format: 'hypit.cli-build@1', build: { id: 'sixref-build-001' } };
    if (args[0] === 'status') return { format: 'hypit.cli-status@1', build: statusBuild ?? { id: 'sixref-build-001', result: { state: 'complete' }, work: { outcome: 'complete' } } };
    throw new Error('unexpected CLI action');
  };
  const env = { VIDEO_SIXREF_HYPIT_RUNTIME: runtime, VIDEO_HYPIT_CLI: cli, VIDEO_PAID_GENERATION_ENABLED: 'true' };
  const runner = createHypitRunner({ env, process: mock, route: 'sixref-v1' });
  const sourcePath = path.join(workspace, 'motion.mp4');
  const referencePaths = Array.from({ length: 5 }, (_, i) => path.join(workspace, `image${i}.png`));
  await Promise.all([sourcePath, ...referencePaths].map(file => writeFile(file, 'fixture')));
  return { root, workspace, runtime, profile, runner, calls, sourcePath, referencePaths };
}

test('sixref route authors five ordered images, source video, and pinned runtime', async () => {
  const f = await fixture();
  await f.runner.submitH3({ workspace: f.workspace, sourcePath: f.sourcePath, referencePaths: f.referencePaths, prompt: 'Move together', duration: 8, onBuildId: async () => {} });
  assert.deepEqual(f.calls.map(args => args[0]), ['auth', 'check', 'plan', 'build']);
  const source = await readFile(path.join(f.workspace, 'video.svml'), 'utf8');
  assert.equal((source.match(/<asset:Image/g) ?? []).length, 5);
  assert.equal((source.match(/<h3:Reference image=/g) ?? []).length, 5);
  assert.match(source, /<asset:Video id="motion" src="\.\/motion\.mp4"\/>/);
  assert.match(source, /duration="8"/);
  const runtime = JSON.parse(await readFile(path.join(f.workspace, 'hypit.runtime.json'), 'utf8'));
  assert.equal(runtime.endpoints[H3_ENDPOINT].use, SIXREF_PROVIDER);
  assert.equal(runtime.endpoints[H3_ENDPOINT].config.instanceType, 'default');
  assert.equal(runtime.endpoints[H3_ENDPOINT].config.firstPassMegapixels, 0.4096);
  assert.equal(runtime.endpoints[H3_ENDPOINT].config.upscaleFactor, 1.5);
  const receipt = JSON.parse(await readFile(path.join(f.workspace, 'hypit-build-receipt.json'), 'utf8'));
  assert.equal(receipt.route, 'sixref-v1');
  assert.equal(receipt.provider, SIXREF_PROVIDER);
  assert.deepEqual(await f.runner.recoverH3Submission(f.workspace), { buildId: 'sixref-build-001' });
  assert.equal((await f.runner.inspectH3({ workspace: f.workspace, buildId: 'sixref-build-001' })).state, 'completed');
});

test('local failed build is unknown unless its operation proves a terminal RunningHub result', async () => {
  const base = { id: 'sixref-build-001', result: { state: 'failed' }, work: { outcome: 'failed' },
    operations: [{ endpoint: H3_ENDPOINT, state: 'failed', receipt: { id: 'task-001' }, failure: { code: 'RUNNINGHUB_OUTCOME_UNKNOWN', message: 'redacted' } }] };
  const f = await fixture(base);
  await f.runner.submitH3({ workspace: f.workspace, sourcePath: f.sourcePath, referencePaths: f.referencePaths, prompt: 'Move', duration: 4, onBuildId: async () => {} });
  assert.equal((await f.runner.inspectH3({ workspace: f.workspace, buildId: 'sixref-build-001' })).state, 'unknown');
  const proven = await fixture({ ...base, operations: [{ endpoint: H3_ENDPOINT, state: 'failed', receipt: { id: 'task-001' }, failure: { code: 'RUNNINGHUB_TERMINAL_FAILURE', message: 'redacted' } }] });
  await proven.runner.submitH3({ workspace: proven.workspace, sourcePath: proven.sourcePath, referencePaths: proven.referencePaths, prompt: 'Move', duration: 4, onBuildId: async () => {} });
  const state = await proven.runner.inspectH3({ workspace: proven.workspace, buildId: 'sixref-build-001' });
  assert.equal(state.state, 'failed');
  assert.equal(state.taskId, 'task-001');
});

test('terminal code without one matching durable operation is still unknown', async () => {
  for (const operations of [
    [{ endpoint: H3_ENDPOINT, state: 'failed', failure: { code: 'RUNNINGHUB_TERMINAL_FAILURE' } }],
    [{ endpoint: 'runninghub.other', state: 'failed', receipt: { id: 'task-001' }, failure: { code: 'RUNNINGHUB_TERMINAL_FAILURE' } }],
    [{ endpoint: H3_ENDPOINT, state: 'failed', receipt: { id: 'task-001' }, failure: { code: 'RUNNINGHUB_TERMINAL_FAILURE' } },
      { endpoint: H3_ENDPOINT, state: 'pending', receipt: { id: 'task-002' } }],
  ]) {
    const f = await fixture({ id: 'sixref-build-001', result: { state: 'failed' }, work: { outcome: 'failed' }, operations });
    await f.runner.submitH3({ workspace: f.workspace, sourcePath: f.sourcePath, referencePaths: f.referencePaths, prompt: 'Move', duration: 4, onBuildId: async () => {} });
    assert.equal((await f.runner.inspectH3({ workspace: f.workspace, buildId: 'sixref-build-001' })).state, 'unknown');
  }
});

test('sixref route rejects invalid image counts and durations before CLI work', async () => {
  const f = await fixture();
  const base = { workspace: f.workspace, sourcePath: f.sourcePath, prompt: 'Move', onBuildId: async () => {} };
  for (const referencePaths of [[], Array.from({ length: 7 }, () => f.referencePaths[0])]) {
    await assert.rejects(f.runner.submitH3({ ...base, referencePaths, duration: 4 }));
  }
  await assert.rejects(f.runner.submitH3({ ...base, referencePaths: f.referencePaths, duration: 7 as 4 }));
  assert.equal(f.calls.length, 0);
});

test('sixref route rejects account02 and legacy receipt without querying a task', async () => {
  const f = await fixture();
  f.profile.endpoints[H3_ENDPOINT].config.apiKey.key = 'RUNNINGHUB_API_KEY_02';
  await writeFile(f.runtime, JSON.stringify(f.profile));
  assert.equal((await f.runner.runnerReadiness()).ready, false);
  assert.equal(f.calls.length, 0);
  f.profile.endpoints[H3_ENDPOINT].config.apiKey.key = 'RUNNINGHUB_API_KEY_01';
  await writeFile(f.runtime, JSON.stringify(f.profile));
  await writeFile(path.join(f.workspace, 'hypit-build-receipt.json'), JSON.stringify({ buildId: 'old-build', output: 'result.video' }));
  assert.equal(await f.runner.recoverH3Submission(f.workspace), null);
  assert.equal(f.calls.length, 0);
});
