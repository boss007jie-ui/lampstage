import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const bridge = fileURLToPath(new URL('../../workbuddy-expert/lampstage-creative-expert/scripts/lampstage-http.mjs', import.meta.url));
const directArgs = {
  source_asset_id: 'source-video', product_asset_id: 'product', generation_mode: 'direct_references',
  reference_assets: [
    { asset_id: 'baby', role: 'character', label: 'Baby' },
    { asset_id: 'mother', role: 'character', label: 'Mother' },
  ],
};

async function fixture(t) {
  const requests = [];
  const state = {
    catalog: { capabilities: [
      { id: 'video.unrelated', status: 'available', modes: { direct_references: true } },
      { id: 'video.replicate', status: 'available', modes: { direct_references: true } },
    ] },
    jobs: new Map(),
  };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({ method: request.method, path: request.url, body: body ? JSON.parse(body) : null, authorization: request.headers.authorization });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/v1/capabilities') response.end(JSON.stringify(state.catalog));
    else if (request.method === 'GET' && request.url.startsWith('/api/v1/jobs/')) response.end(JSON.stringify(state.jobs.get(decodeURIComponent(request.url.slice('/api/v1/jobs/'.length))) ?? {}));
    else response.end(JSON.stringify({ ok: true, ...(body ? { request: JSON.parse(body) } : {}) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const child = spawn(process.execPath, [bridge], {
    env: { ...process.env, LAMPSTAGE_API_BASE_URL: `http://127.0.0.1:${address.port}/api/v1`, LAMPSTAGE_API_KEY: 'fake-test-token' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const pending = new Map();
  let nextId = 0;
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf('\n');
      if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      const reply = JSON.parse(line);
      const waiter = pending.get(reply.id);
      if (waiter) { pending.delete(reply.id); clearTimeout(waiter.timeout); waiter.resolve(reply); }
    }
  });
  child.on('error', error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); });
  child.on('exit', code => { for (const waiter of pending.values()) waiter.reject(new Error(`Bridge exited: ${code}`)); pending.clear(); });
  t.after(async () => {
    child.kill();
    await new Promise(resolve => server.close(resolve));
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Bridge did not answer ${method}`)); }, 5000);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const call = (name, args = {}) => rpc('tools/call', { name, arguments: args });
  return { requests, state, rpc, call };
}

test('direct create reads the video.replicate catalog entry and preserves product, baby, mother order', async t => {
  const f = await fixture(t);
  const reply = await f.call('create_video_job', directArgs);
  assert.equal(reply.error, undefined);
  assert.deepEqual(f.requests.map(({ method, path }) => `${method} ${path}`), ['GET /api/v1/capabilities', 'POST /api/v1/video-jobs']);
  assert.deepEqual(f.requests[1].body, directArgs);
  assert.equal(f.requests[1].authorization, 'Bearer fake-test-token');
});

test('direct create stops when the catalog mode is missing or video.replicate is in maintenance', async t => {
  const f = await fixture(t);
  for (const entry of [
    { id: 'video.replicate', status: 'available', modes: {} },
    { id: 'video.replicate', status: 'maintenance', modes: { direct_references: true } },
  ]) {
    f.state.catalog.capabilities[1] = entry;
    const reply = await f.call('create_video_job', directArgs);
    assert.match(reply.error?.message ?? '', /direct_references/);
  }
  assert.deepEqual(f.requests.map(({ method, path }) => `${method} ${path}`), ['GET /api/v1/capabilities', 'GET /api/v1/capabilities']);
});

test('direct create rejects wrong count, duplicate and invalid references before any API write', async t => {
  const f = await fixture(t);
  const invalid = [
    { ...directArgs, reference_assets: [directArgs.reference_assets[0]] },
    { ...directArgs, reference_assets: [...directArgs.reference_assets, { asset_id: 'scene', role: 'scene', label: 'Scene' }] },
    { ...directArgs, reference_assets: [{ ...directArgs.reference_assets[0], asset_id: 'product' }, directArgs.reference_assets[1]] },
    { ...directArgs, reference_assets: [directArgs.reference_assets[0], { ...directArgs.reference_assets[1], asset_id: 'baby' }] },
    { ...directArgs, reference_assets: [{ ...directArgs.reference_assets[0], role: 'person' }, directArgs.reference_assets[1]] },
    { ...directArgs, reference_assets: [{ ...directArgs.reference_assets[0], label: ' ' }, directArgs.reference_assets[1]] },
    { ...directArgs, reference_assets: [{ ...directArgs.reference_assets[0], extra: true }, directArgs.reference_assets[1]] },
  ];
  for (const args of invalid) assert.ok((await f.call('create_video_job', args)).error);
  assert.deepEqual(f.requests, []);
});

test('reference assets require an explicit direct mode while old create requests remain legacy', async t => {
  const f = await fixture(t);
  const { generation_mode: _mode, reference_assets: _references, ...legacy } = directArgs;
  assert.ok((await f.call('create_video_job', { ...legacy, reference_assets: directArgs.reference_assets })).error);
  assert.deepEqual(f.requests, []);
  const reply = await f.call('create_video_job', legacy);
  assert.equal(reply.error, undefined);
  assert.deepEqual(f.requests.map(({ method, path }) => `${method} ${path}`), ['POST /api/v1/video-jobs']);
  assert.deepEqual(f.requests[0].body, legacy);
});

test('direct prepare reads job, checks capability, then posts; old jobs keep their original prepare path', async t => {
  const f = await fixture(t);
  f.state.jobs.set('direct-job', { generation_mode: 'direct_references' });
  f.state.jobs.set('old-job', { generation_mode: 'legacy_frames' });
  assert.equal((await f.call('prepare_video_job', { job_id: 'direct-job' })).error, undefined);
  assert.deepEqual(f.requests.map(({ method, path }) => `${method} ${path}`), [
    'GET /api/v1/jobs/direct-job', 'GET /api/v1/capabilities', 'POST /api/v1/video-jobs/direct-job/prepare',
  ]);
  f.requests.length = 0;
  assert.equal((await f.call('prepare_video_job', { job_id: 'old-job' })).error, undefined);
  assert.deepEqual(f.requests.map(({ method, path }) => `${method} ${path}`), [
    'GET /api/v1/jobs/old-job', 'POST /api/v1/video-jobs/old-job/prepare',
  ]);
});

test('direct prepare stops after GET and capability check when video.replicate is unavailable', async t => {
  const f = await fixture(t);
  f.state.jobs.set('direct-job', { generation_mode: 'direct_references' });
  f.state.catalog.capabilities[1].status = 'maintenance';
  const reply = await f.call('prepare_video_job', { job_id: 'direct-job' });
  assert.match(reply.error?.message ?? '', /direct_references/);
  assert.deepEqual(f.requests.map(({ method, path }) => `${method} ${path}`), [
    'GET /api/v1/jobs/direct-job', 'GET /api/v1/capabilities',
  ]);
});
