import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const bridge = fileURLToPath(new URL('../../workbuddy-expert/lampstage-creative-expert/scripts/lampstage-http.mjs', import.meta.url));
const ref = (asset_id, role) => ({ asset_id, role, label: asset_id });
const sample = {
  source_asset_id: 'motion', generation_mode: 'six_references',
  reference_assets: [ref('opening', 'start_state'), ref('baby', 'character'), ref('garment', 'product')],
  instructions: 'Keep baby, garment structure and bed stable.',
  segment_plan: [
    { start: 0, source_duration: 5, duration: 5, instructions: 'Put both arms through sleeves.', before_state: 'Both sleeves empty.', after_state: 'Both arms through sleeves.' },
    { start: 5, source_duration: 5, duration: 5, instructions: 'Align and fasten the wrap.', before_state: 'Wrap open.', after_state: 'Wrap fastened.', start_from_segment: 0 },
  ],
};

async function fixture(t) {
  const requests = [];
  const state = { capabilities: [{ id: 'video.replicate', status: 'available', modes: { six_references: true } }], jobs: new Map() };
  const server = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const raw = Buffer.concat(parts).toString();
    requests.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : null });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/capabilities') res.end(JSON.stringify({ capabilities: state.capabilities }));
    else if (req.method === 'GET' && req.url.startsWith('/api/v1/jobs/')) res.end(JSON.stringify(state.jobs.get(req.url.split('/').at(-1)) ?? {}));
    else res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [bridge], { env: { ...process.env, LAMPSTAGE_API_BASE_URL: `http://127.0.0.1:${server.address().port}/api/v1`, LAMPSTAGE_API_KEY: 'test-only' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  t.after(async () => { child.kill(); await new Promise(resolve => server.close(resolve)); });
  let buffer = ''; let id = 0; const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      const result = JSON.parse(line); const waiter = pending.get(result.id);
      if (waiter) { pending.delete(result.id); clearTimeout(waiter.timeout); waiter.resolve(result); }
    }
  });
  child.on('exit', code => { for (const waiter of pending.values()) waiter.reject(new Error(`bridge exited ${code}`)); pending.clear(); });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const next = ++id;
    const timeout = setTimeout(() => { pending.delete(next); reject(new Error('bridge timeout')); }, 5000);
    pending.set(next, { resolve, reject, timeout });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: next, method, params })}\n`);
  });
  return { requests, state, rpc, call: (name, args = {}) => rpc('tools/call', { name, arguments: args }) };
}

test('six-reference schema exposes ordered refs, semantic plan and candidate endpoints', async t => {
  const f = await fixture(t);
  const list = (await f.rpc('tools/list', {})).result.tools;
  const create = list.find(tool => tool.name === 'create_video_job').inputSchema;
  assert.equal(create.properties.reference_assets.maxItems, 6);
  assert.equal(create.properties.segment_plan.maxItems, 8);
  assert.ok(create.properties.reference_assets.items.properties.role.enum.includes('start_state'));
  assert.ok(list.some(tool => tool.name === 'review_video_segments'));
  assert.ok(list.some(tool => tool.name === 'assemble_video_job'));
  assert.ok(list.some(tool => tool.name === 'reconcile_video_job'));
});

test('six-reference create forwards exact order without requiring product_asset_id', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('create_video_job', sample)).error, undefined);
  assert.deepEqual(f.requests.map(x => x.path), ['/api/v1/capabilities', '/api/v1/video-jobs']);
  assert.deepEqual(f.requests[1].body, sample);
});

test('invalid six-reference plans are rejected before any write or capability fetch', async t => {
  const f = await fixture(t);
  const bad = [
    { ...sample, reference_assets: JSON.stringify(sample.reference_assets) },
    { ...sample, reference_assets: [] },
    { ...sample, reference_assets: [ref('x', 'character'), ref('x', 'scene')] },
    { ...sample, segment_plan: [] },
    { ...sample, segment_plan: [{ ...sample.segment_plan[0], source_duration: 4, duration: 8 }] },
    { ...sample, segment_plan: [{ ...sample.segment_plan[0], start: 1 }] },
    { ...sample, segment_plan: [sample.segment_plan[0], { ...sample.segment_plan[1], start: 6 }] },
    { ...sample, segment_plan: [sample.segment_plan[0], { ...sample.segment_plan[1], start_from_segment: 1 }] },
    { ...sample, reference_assets: [ref('baby', 'character')], segment_plan: sample.segment_plan },
    { ...sample, reference_assets: [ref('baby', 'character'), ref('opening', 'start_state')] },
    { ...sample, reference_assets: [ref('opening', 'start_state'), ref('other', 'start_state')] },
    { ...sample, segment_plan: [{ ...sample.segment_plan[0], reference_assets: [ref('garment', 'product'), ref('opening', 'start_state')] }, sample.segment_plan[1]] },
    { ...sample, segment_plan: [{ ...sample.segment_plan[0], reference_assets: [ref('garment', 'product')] }, sample.segment_plan[1]] },
  ];
  for (const value of bad) assert.ok((await f.call('create_video_job', value)).error);
  assert.deepEqual(f.requests, []);
});

test('bridge retime boundary matches API source-duration ratio', async t => {
  const f = await fixture(t);
  const atLimit = { ...sample, segment_plan: [{ ...sample.segment_plan[0], source_duration: 5.75, duration: 5 }, { ...sample.segment_plan[1], start: 5.75 }] };
  assert.equal((await f.call('create_video_job', atLimit)).error, undefined);
  const overLimit = { ...atLimit, segment_plan: [{ ...atLimit.segment_plan[0], source_duration: 5.76 }, { ...atLimit.segment_plan[1], start: 5.76 }] };
  assert.ok((await f.call('create_video_job', overLimit)).error);
  const tooShort = { ...sample, segment_plan: [{ ...sample.segment_plan[0], source_duration: 5.1, duration: 6 }, { ...sample.segment_plan[1], start: 5.1 }] };
  assert.ok((await f.call('create_video_job', tooShort)).error);
  assert.deepEqual(f.requests.map(x => x.path), ['/api/v1/capabilities', '/api/v1/video-jobs']);
});

test('capability absence stops six-reference create and prepare', async t => {
  const f = await fixture(t);
  f.state.capabilities[0].modes.six_references = false;
  assert.match((await f.call('create_video_job', sample)).error?.message, /six_references/);
  f.state.jobs.set('j', { generation_mode: 'six_references' });
  assert.match((await f.call('prepare_video_job', { job_id: 'j' })).error?.message, /six_references/);
  assert.deepEqual(f.requests.map(x => x.path), ['/api/v1/capabilities', '/api/v1/jobs/j', '/api/v1/capabilities']);
});

test('review and assembly forward candidate token and exact decisions', async t => {
  const f = await fixture(t);
  const token = 'a'.repeat(64); const hash = 'b'.repeat(64);
  const decisions = [{ segment_index: 1, candidate_sha256: hash, action: 'accept', trim_start: 0.5 }];
  assert.equal((await f.call('review_video_segments', { job_id: 'j', candidate_review_token: token, decisions })).error, undefined);
  assert.equal((await f.call('assemble_video_job', { job_id: 'j', candidate_review_token: token })).error, undefined);
  assert.deepEqual(f.requests.map(x => [x.method, x.path, x.body]), [
    ['POST', '/api/v1/video-jobs/j/review', { candidate_review_token: token, decisions }],
    ['POST', '/api/v1/video-jobs/j/assemble', { candidate_review_token: token }],
  ]);
});

test('candidate writes reject stale-shaped tokens, hashes and duplicate decisions before API calls', async t => {
  const f = await fixture(t);
  const valid = { job_id: 'j', candidate_review_token: 'a'.repeat(64), decisions: [{ segment_index: 0, candidate_sha256: 'b'.repeat(64), action: 'accept' }] };
  assert.ok((await f.call('review_video_segments', { ...valid, candidate_review_token: 'x' })).error);
  assert.ok((await f.call('review_video_segments', { ...valid, decisions: [{ ...valid.decisions[0], candidate_sha256: 'x' }] })).error);
  assert.ok((await f.call('review_video_segments', { ...valid, decisions: [...valid.decisions, { ...valid.decisions[0], action: 'retry' }] })).error);
  assert.ok((await f.call('review_video_segments', { ...valid, decisions: [{ ...valid.decisions[0], action: 'retry', reason: 'Bad action.', trim_start: 0.5 }] })).error);
  assert.ok((await f.call('assemble_video_job', { job_id: 'j', candidate_review_token: 'x' })).error);
  assert.deepEqual(f.requests, []);
});

test('failed segment retry and reconcile forward their exact recovery requests', async t => {
  const f = await fixture(t);
  const retry = { job_id: 'j', candidate_review_token: 'a'.repeat(64), decisions: [{ segment_index: 0, candidate_sha256: 'failed', action: 'retry', reason: 'Provider returned a terminal failure.' }] };
  assert.equal((await f.call('review_video_segments', retry)).error, undefined);
  assert.equal((await f.call('reconcile_video_job', { job_id: 'j' })).error, undefined);
  assert.deepEqual(f.requests.map(x => [x.method, x.path, x.body]), [
    ['POST', '/api/v1/video-jobs/j/review', { candidate_review_token: retry.candidate_review_token, decisions: retry.decisions }],
    ['POST', '/api/v1/video-jobs/j/reconcile', {}],
  ]);
});
