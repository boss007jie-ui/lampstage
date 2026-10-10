import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHypitRunner, escapeXml, H3_CAPABILITY, H3_ENDPOINT, H3_PROVIDER, readLocalBuildReceipt, runHypitProcess, SubmissionUnknownError, type CliProcess } from '../../apps/web/lib/video/hypit-runner';

async function fixture(processOverride?: CliProcess) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-runner-'));
  const workspace = path.join(root, 'job');
  await mkdir(workspace);
  await mkdir(path.join(root, 'packages', H3_PROVIDER), { recursive: true });
  await writeFile(path.join(root, 'packages', H3_PROVIDER, 'package.json'), '{}');
  const cli = path.join(root, 'hypit.mjs');
  await writeFile(cli, '');
  const runtime = path.join(root, 'runtime.json');
  const profile = { format: 'hypit.runtime-local@1', dataRoot: './state', credentials: { env: { use: '@hypit/credential-store-env' } }, endpoints: { [H3_ENDPOINT]: { use: H3_PROVIDER, config: { baseUrl: 'https://www.runninghub.cn', apiKey: { store: 'env', key: 'RUNNINGHUB_API_KEY_01' } } } }, bindings: { [H3_CAPABILITY]: H3_ENDPOINT } };
  await writeFile(runtime, JSON.stringify(profile));
  await writeFile(`${runtime}.account.json`, JSON.stringify({ account: '01', endpoint: H3_ENDPOINT, credential: { store: 'env', key: 'RUNNINGHUB_API_KEY_01' }, packageRoot: root }));
  const calls: string[][] = [];
  const mock: CliProcess = async (_cli, args) => {
    calls.push(args);
    if (args[0] === 'auth') return { format: 'hypit.cli-auth-status@1', endpoint: H3_ENDPOINT, credentials: [{ endpoint: H3_ENDPOINT, slot: 'apiKey', configured: true }] };
    if (args[0] === 'check') return { format: 'hypit.cli-check@1', ok: true };
    if (args[0] === 'plan') return { format: 'hypit.cli-plan@1', ok: true, requestCount: 1, requestIssueCount: 0, preflight: { ok: true }, providers: [{ endpoint: H3_ENDPOINT, use: H3_PROVIDER, status: 'resolved' }] };
    if (args[0] === 'build') return { format: 'hypit.cli-build@1', build: { id: 'build-test-001' } };
    if (args[0] === 'inspect') return { format: 'hypit.cli-inspect@1', build: { id: 'build-test-001', outcome: 'complete', outputs: [{ name: 'result.video', kind: 'resource', mediaType: 'video/mp4' }] } };
    if (args[0] === 'get') {
      await writeFile(args[args.indexOf('--to') + 1], Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]));
      return { format: 'hypit.cli-get@1', kind: 'resource', output: 'result.video' };
    }
    return {};
  };
  const files = ['source.mp4', 'product.png', 'opening.png', 'ending.png'].map(file => path.join(workspace, file));
  await Promise.all(files.map(file => writeFile(file, 'test')));
  const runner = createHypitRunner({ env: { VIDEO_HYPIT_RUNTIME: runtime, VIDEO_HYPIT_CLI: cli }, process: processOverride ?? mock });
  const input = { workspace, sourcePath: files[0], productPath: files[1], openingPath: files[2], endingPath: files[3], duration: 4 as const, prompt: 'A & B <camera> "focus"', onBuildId: async (_id: string) => {} };
  return { root, runtime, workspace, profile, runner, input, calls, mock };
}

test('escaping keeps prompt text out of markup', () => {
  assert.equal(escapeXml('<x a="b"> &'), '&lt;x a=&quot;b&quot;&gt; &amp;');
  assert.throws(() => escapeXml('bad\0'));
});
test('preflight, one detached build, and durable receipt before callback', async () => {
  const f = await fixture();
  let callback = false;
  const result = await f.runner.submitH3({ ...f.input, onBuildId: async id => { assert.equal((await readLocalBuildReceipt(f.workspace))?.buildId, id); callback = true; } });
  assert.deepEqual(result, { buildId: 'build-test-001' });
  assert.ok(callback);
  assert.deepEqual(f.calls.map(x => x[0]), ['auth', 'check', 'plan', 'build']);
  const build = f.calls[3];
  assert.ok(!build.includes('--follow'));
  assert.equal(build[build.indexOf('--workspace') + 1], f.workspace);
  assert.equal(build[build.indexOf('--runtime') + 1], path.join(f.workspace, 'hypit.runtime.json'));
  const source = await readFile(path.join(f.workspace, 'video.svml'), 'utf8');
  assert.match(source, /A &amp; B &lt;camera&gt; &quot;focus&quot;/);
  assert.equal((source.match(/h3:Reference image=/g) || []).length, 3);
  await assert.rejects(f.runner.submitH3(f.input));
  assert.equal(f.calls.filter(x => x[0] === 'build').length, 1);
});
test('account02 and face swap profiles fail closed without invoking CLI', async () => {
  const f = await fixture();
  f.profile.endpoints[H3_ENDPOINT].config.apiKey.key = 'runninghub.api_key_02';
  await writeFile(f.runtime, JSON.stringify(f.profile));
  assert.equal((await f.runner.runnerReadiness()).ready, false);
  assert.equal(f.calls.length, 0);
  f.profile.endpoints[H3_ENDPOINT].config.apiKey.key = 'RUNNINGHUB_API_KEY_01';
  f.profile.endpoints[H3_ENDPOINT].use = 'hypit-provider-runninghub';
  await writeFile(f.runtime, JSON.stringify(f.profile));
  assert.equal((await f.runner.runnerReadiness()).ready, false);
});
test('ambiguous submission produces reconciliation error and never retries', async () => {
  const f = await fixture();
  const g = await fixture(async (cli, args, cwd, timeout) => {
    if (args[0] === 'build') throw new Error('secret-provider-body');
    return f.mock(cli, args, cwd, timeout);
  });
  await assert.rejects(g.runner.submitH3(g.input), error => error instanceof SubmissionUnknownError && !error.message.includes('secret-provider-body'));
  assert.ok(await readFile(path.join(g.workspace, 'hypit-submission-intent.json')));
});
test('callback failure retains receipt and build ID for reconciliation', async () => {
  const f = await fixture();
  await assert.rejects(f.runner.submitH3({ ...f.input, onBuildId: async () => { throw new Error('database unavailable'); } }), error => error instanceof SubmissionUnknownError && error.buildId === 'build-test-001');
  assert.equal((await readLocalBuildReceipt(f.workspace))?.buildId, 'build-test-001');
});
test('missing credentials and unresolved preflight never submit', async () => {
  const f = await fixture(async () => ({ format: 'hypit.cli-auth-status@1', endpoint: H3_ENDPOINT, credentials: [{ slot: 'apiKey', configured: false }] }));
  assert.equal((await f.runner.runnerReadiness()).ready, false);
  await assert.rejects(f.runner.submitH3(f.input));
});
test('collection exports resource output and safely reuses the same completed copy', async () => {
  const f = await fixture();
  const to = path.join(f.root, 'finished.mp4');
  await f.runner.collectH3({ workspace: f.workspace, buildId: 'build-test-001', to });
  assert.equal((await readFile(to)).toString('ascii', 4, 8), 'ftyp');
  assert.equal(f.calls[1][f.calls[1].indexOf('--output') + 1], 'result.video');
  await f.runner.collectH3({ workspace: f.workspace, buildId: 'build-test-001', to });
  assert.equal(f.calls.filter(args => args[0] === 'get').length, 1);
  await writeFile(to, 'unrelated output');
  await assert.rejects(f.runner.collectH3({ workspace: f.workspace, buildId: 'build-test-001', to }));
  assert.equal(await readFile(to, 'utf8'), 'unrelated output');
});
test('recovery reads isolated active/result ledgers and persists only an unambiguous ID', async () => {
  const f = await fixture(async (_cli, args) => {
    if (args[0] === 'activity') return { format: 'hypit.cli-activity@1', builds: [{ id: 'build-test-001' }] };
    if (args[0] === 'builds') return { format: 'hypit.cli-builds@1', builds: [] };
    if (args[0] === 'status') return { format: 'hypit.cli-status@1', build: { id: 'build-test-001', targets: ['result.video'] } };
    throw new Error('Unexpected mutation');
  });
  await writeFile(path.join(f.workspace, 'hypit-submission-intent.json'), JSON.stringify({ account: '01', output: 'result.video' }));
  assert.deepEqual(await f.runner.recoverH3Submission(f.workspace), { buildId: 'build-test-001' });
  assert.deepEqual(await readLocalBuildReceipt(f.workspace), { buildId: 'build-test-001' });
});
test('multiple builds remain unknown and recovery never chooses arbitrarily', async () => {
  const f = await fixture(async (_cli, args) => args[0] === 'activity'
    ? { format: 'hypit.cli-activity@1', builds: [{ id: 'one' }, { id: 'two' }] }
    : { format: 'hypit.cli-builds@1', builds: [] });
  await writeFile(path.join(f.workspace, 'hypit-submission-intent.json'), JSON.stringify({ account: '01', output: 'result.video' }));
  assert.equal(await f.runner.recoverH3Submission(f.workspace), null);
});
test('unknown status stays unknown and private provider text is not returned', async () => {
  const f = await fixture(async () => { throw new Error('sensitive-response'); });
  const state = await f.runner.inspectH3({ workspace: f.workspace, buildId: 'build-test-001' });
  assert.equal(state.state, 'unknown');
  assert.ok(!JSON.stringify(state).includes('sensitive-response'));
});
test('process boundary preserves arguments without shell evaluation and hides malformed output', async () => {
  const f = await fixture();
  const script = path.join(f.root, 'fake-cli.mjs');
  await writeFile(script, 'process.stdout.write(JSON.stringify({args:process.argv.slice(2)}));');
  const response = await runHypitProcess(script, ['literal;$(not-a-command)', 'path with spaces'], f.root, 1000);
  assert.deepEqual(response.args, ['literal;$(not-a-command)', 'path with spaces', '--json', '--color', 'never']);
  await writeFile(script, 'console.log("private-test-payload");');
  await assert.rejects(runHypitProcess(script, [], f.root, 1000), error => error instanceof Error && !error.message.includes('private-test-payload'));
});
test('plan resolving another endpoint cannot cross the paid boundary', async () => {
  const f = await fixture();
  let submitted = false;
  const g = await fixture(async (cli, args, cwd, timeout) => {
    if (args[0] === 'build') submitted = true;
    const result = await f.mock(cli, args, cwd, timeout);
    if (args[0] === 'plan') result.providers[0].endpoint = 'runninghub.account02';
    return result;
  });
  await assert.rejects(g.runner.submitH3(g.input), /preflight/);
  assert.equal(submitted, false);
});
test('completed status exposes only the provider receipt and asks for verbose CLI data', async () => {
  const f = await fixture(async (_cli, args) => {
    assert.ok(args.includes('--verbose'));
    return { format: 'hypit.cli-status@1', build: { id: 'build-test-001', result: { state: 'complete' }, work: { state: 'done', outcome: 'complete' }, operations: [{ endpoint: H3_ENDPOINT, receipt: { id: 'task-001' } }] } };
  });
  assert.deepEqual(await f.runner.inspectH3({ workspace: f.workspace, buildId: 'build-test-001' }), { state: 'completed', taskId: 'task-001' });
});

async function resumeFixture(options: { receipt?: boolean; workerRunning?: boolean; extraBuild?: boolean } = {}) {
  const f = await fixture();
  await f.runner.submitH3(f.input);
  await mkdir(path.join(f.workspace, '.hypit/execution'), { recursive: true });
  const calls: string[][] = [];
  const resumeRunner = createHypitRunner({ env: { VIDEO_HYPIT_RUNTIME: f.runtime, VIDEO_HYPIT_CLI: path.join(f.root, 'hypit.mjs') }, process: async (_cli, args) => {
    calls.push(args);
    if (args[0] === 'status') return { format: 'hypit.cli-status@1', build: {
      id: 'build-test-001', targets: ['result.video'], work: { state: 'working' }, result: { state: 'open' },
      operations: [{ endpoint: H3_ENDPOINT, state: 'pending', ...(options.receipt === false ? {} : { receipt: { id: 'existing-upstream-task' } }) }],
    } };
    if (args[0] === 'activity') return { format: 'hypit.cli-activity@1', builds: [{ id: 'build-test-001' }, ...(options.extraBuild ? [{ id: 'other-build' }] : [])] };
    if (args[0] === 'runtime' && args[1] === 'status') return { format: 'hypit.cli-runtime-status@1', worker: { state: options.workerRunning ? 'running' : 'stopped' } };
    if (args[0] === 'runtime' && args[1] === 'up') return { format: 'hypit.cli-runtime-up@1', ready: true, worker: 'running' };
    throw new Error('Unexpected paid build or unrelated command');
  } });
  return { ...f, resumeRunner, resumeCalls: calls };
}
test('stopped worker resumes only the established build with a durable upstream receipt', async () => {
  const f = await resumeFixture();
  assert.deepEqual(await f.resumeRunner.resumeH3Worker({ workspace: f.workspace, buildId: 'build-test-001' }), { ready: true, taskId: 'existing-upstream-task' });
  assert.deepEqual(f.resumeCalls.map(args => args.slice(0, args[0] === 'runtime' ? 2 : 1).join(' ')), ['status', 'activity', 'runtime status', 'runtime up']);
  const up = f.resumeCalls[3];
  assert.equal(up[up.indexOf('--runtime') + 1], path.join(f.workspace, 'hypit.runtime.json'));
  assert.equal(up[up.indexOf('--workspace') + 1], f.root);
  assert.ok(!f.resumeCalls.some(args => args[0] === 'build'));
});
test('missing upstream receipt never restarts a worker or repeats submission', async () => {
  const f = await resumeFixture({ receipt: false });
  const resumed = await f.resumeRunner.resumeH3Worker({ workspace: f.workspace, buildId: 'build-test-001' });
  assert.equal(resumed.ready, false);
  assert.match(resumed.reason ?? '', /Manual reconciliation/);
  assert.deepEqual(f.resumeCalls.map(args => args[0]), ['status']);
});
test('worker already running requires no launch and another requested build ID is refused', async () => {
  const f = await resumeFixture({ workerRunning: true });
  assert.equal((await f.resumeRunner.resumeH3Worker({ workspace: f.workspace, buildId: 'build-test-001' })).ready, true);
  assert.ok(!f.resumeCalls.some(args => args[0] === 'runtime' && args[1] === 'up'));
  f.resumeCalls.length = 0;
  assert.equal((await f.resumeRunner.resumeH3Worker({ workspace: f.workspace, buildId: 'unrelated-build' })).ready, false);
  assert.equal(f.resumeCalls.length, 0);
});
test('multiple active builds prevent runtime restart', async () => {
  const f = await resumeFixture({ extraBuild: true });
  assert.equal((await f.resumeRunner.resumeH3Worker({ workspace: f.workspace, buildId: 'build-test-001' })).ready, false);
  assert.ok(!f.resumeCalls.some(args => args[0] === 'runtime'));
});
