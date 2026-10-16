import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const bridge = fileURLToPath(new URL('../../workbuddy-expert/lampstage-creative-expert/scripts/lampstage-http.mjs', import.meta.url));
const testKey = 'fixture-only-lifecycle-credential';
const usage = {
  observed_at: '2026-10-15T09:00:00.000Z',
  active: { count: 10, limit: 10, remaining: 0, counted_statuses: ['queued', 'review', 'attention'], includes_unknown_statuses: true },
  drafts: { count: 3, limit: 10, remaining: 7, ttl_seconds: 86400 },
  terminal_statuses: ['completed', 'failed', 'cancelled'],
};
const summary = {
  id: 'draft-1', title: 'Reviewed project', status: 'draft', stage: '等待准备参考素材', revision: 0,
  created_at: '2026-10-15T08:00:00.000Z', updated_at: '2026-10-15T08:00:00.000Z', progress_updated_at: null,
  counts_toward_limit: false, quota_bucket: 'draft', can_cancel: true, cancel_blocked_reason: null,
  draft_expires_at: '2026-10-16T08:00:00.000Z', cancelled_at: null, cancellation_reason: null,
};
const createArgs = {
  source_asset_id: 'motion', generation_mode: 'six_references',
  reference_assets: [{ asset_id: 'opening', role: 'start_state', label: 'Reviewed opening' }, { asset_id: 'person', role: 'character', label: 'Person' }],
  segment_plan: [{ start: 0, source_duration: 5, duration: 5, instructions: 'Raise one hand.', before_state: 'Hand lowered.', after_state: 'Hand raised.' }],
};

async function fixture(t) {
  const requests = [];
  const state = { status: 200, body: { ok: true }, disconnectCreate: false, jobs: new Map() };
  const server = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const raw = Buffer.concat(parts).toString();
    requests.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : null });
    assert.equal(req.headers.authorization, 'Bearer ' + testKey);
    if (state.disconnectCreate && req.method === 'POST' && req.url === '/api/v1/video-jobs') { req.socket.destroy(); return; }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/capabilities') {
      res.end(JSON.stringify({ capabilities: [{ id: 'video.replicate', status: 'available', modes: { six_references: true } }] }));
    } else if (req.method === 'GET' && state.jobs.has(req.url)) {
      res.end(JSON.stringify(state.jobs.get(req.url)));
    } else {
      res.statusCode = state.status;
      res.end(typeof state.body === 'string' ? state.body : JSON.stringify(state.body));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [bridge], {
    env: { ...process.env, LAMPSTAGE_API_BASE_URL: 'http://127.0.0.1:' + server.address().port + '/api/v1', LAMPSTAGE_API_KEY: testKey },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let buffer = ''; let id = 0; let stderr = ''; const pending = new Map();
  child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      const reply = JSON.parse(line); const waiter = pending.get(reply.id);
      if (waiter) { pending.delete(reply.id); clearTimeout(waiter.timeout); waiter.resolve(reply); }
    }
  });
  child.on('error', error => { for (const waiter of pending.values()) { clearTimeout(waiter.timeout); waiter.reject(error); } pending.clear(); });
  child.on('exit', code => { for (const waiter of pending.values()) { clearTimeout(waiter.timeout); waiter.reject(new Error('bridge exited ' + code)); } pending.clear(); });
  t.after(async () => { child.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(stderr.includes(testKey), false); });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const next = ++id;
    const timeout = setTimeout(() => { pending.delete(next); reject(new Error('bridge timeout')); }, 5000);
    pending.set(next, { resolve, reject, timeout });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
  });
  return { requests, state, rpc, call: (name, args = {}) => rpc('tools/call', { name, arguments: args }) };
}

test('lifecycle bridge advertises the frozen schemas without inventing idempotency or edit tools', async t => {
  const f = await fixture(t);
  const tools = (await f.rpc('tools/list', {})).result.tools;
  const schema = name => tools.find(tool => tool.name === name)?.inputSchema;
  assert.deepEqual(schema('get_account_usage'), { type: 'object', properties: {}, additionalProperties: false });
  assert.deepEqual(schema('list_video_jobs'), {
    type: 'object', properties: { status: { type: 'string', enum: ['all', 'draft', 'active', 'history'] }, limit: { type: 'integer', minimum: 1, maximum: 50 }, cursor: { type: 'string' } }, additionalProperties: false,
  });
  assert.deepEqual(schema('cancel_video_job'), { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'], additionalProperties: false });
  assert.deepEqual(schema('close_video_job'), { type: 'object', properties: { job_id: { type: 'string', minLength: 1 }, expected_revision: { type: 'integer', minimum: 0 } }, required: ['job_id', 'expected_revision'], additionalProperties: false });
  assert.equal(tools.some(tool => /edit_video|idempotency/.test(tool.name)), false);
  assert.deepEqual(f.requests, []);
});

test('stdio lifecycle input schemas match the remote MCP schemas', async t => {
  const f = await fixture(t);
  const local = (await f.rpc('tools/list', {})).result.tools;
  const source = await readFile(new URL('../../apps/web/lib/mcp-tools.ts', import.meta.url), 'utf8');
  const literal = source.match(/export const MCP_TOOLS = (\[[\s\S]*?\]) as const;/)?.[1];
  assert.ok(literal, 'Remote tool catalog must remain inspectable without loading server routes');
  const remote = JSON.parse(JSON.stringify(runInNewContext('(' + literal + ')', { IMAGE_REFERENCE_ROLES: ['character', 'product', 'product_detail', 'scene', 'start_state', 'end_state'], DEFAULT_IMAGE_MODEL: 'nano_banana_21' }, { timeout: 1000 })));
  for (const name of ['get_account_usage', 'list_video_jobs', 'cancel_video_job', 'close_video_job']) {
    assert.deepEqual(local.find(tool => tool.name === name)?.inputSchema, remote.find(tool => tool.name === name)?.inputSchema, name);
  }
  assert.deepEqual(f.requests, []);
});

test('usage and paginated list preserve top-level usage and use only owner-authenticated GETs', async t => {
  const f = await fixture(t);
  f.state.body = { usage };
  assert.deepEqual((await f.call('get_account_usage')).result.structuredContent, { usage });
  f.state.body = { jobs: [summary], next_cursor: 'opaque/+=&next', usage };
  assert.deepEqual((await f.call('list_video_jobs', { status: 'draft', limit: 50, cursor: 'opaque/+=&next' })).result.structuredContent, f.state.body);
  await f.call('list_video_jobs');
  assert.deepEqual(f.requests, [
    { method: 'GET', path: '/api/v1/account/usage', body: null },
    { method: 'GET', path: '/api/v1/video-jobs?status=draft&limit=50&cursor=opaque%2F%2B%3D%26next', body: null },
    { method: 'GET', path: '/api/v1/video-jobs', body: null },
  ]);
});

test('invalid lifecycle parameters make zero network requests', async t => {
  const f = await fixture(t);
  for (const args of [{ status: 'queued' }, { status: null }, { limit: 0 }, { limit: 51 }, { limit: 1.5 }, { limit: '10' }, { cursor: '' }, { cursor: null }, { owner_id: 'someone' }]) {
    assert.ok((await f.call('list_video_jobs', args)).error);
  }
  for (const args of [{}, { job_id: '' }, { job_id: '   ' }, { job_id: 3 }, { job_id: 'draft-1', force: true }]) assert.ok((await f.call('cancel_video_job', args)).error);
  for (const args of [{}, { job_id: 'job-1' }, { job_id: '', expected_revision: 0 }, { job_id: 'job-1', expected_revision: -1 }, { job_id: 'job-1', expected_revision: 1.5 }, { job_id: 'job-1', expected_revision: 0, force: true }]) assert.ok((await f.call('close_video_job', args)).error);
  assert.ok((await f.call('get_account_usage', { owner_id: 'someone' })).error);
  assert.deepEqual(f.requests, []);
});

test('cancel forwards only the explicitly chosen ID once and preserves the frozen response', async t => {
  const f = await fixture(t);
  const job = { ...summary, status: 'cancelled', revision: 1, quota_bucket: null, can_cancel: false, cancelled_at: '2026-10-15T09:00:00.000Z', cancellation_reason: 'user_cancelled' };
  f.state.body = { id: job.id, status: 'cancelled', revision: 1, job, usage };
  assert.deepEqual((await f.call('cancel_video_job', { job_id: 'chosen/id' })).result.structuredContent, f.state.body);
  assert.deepEqual(f.requests, [{ method: 'POST', path: '/api/v1/video-jobs/chosen%2Fid/cancel', body: null }]);
});

test('close sends the chosen ID and observed revision once', async t => {
  const f = await fixture(t);
  const job = { ...summary, id: 'stopped-1', status: 'cancelled', revision: 8, quota_bucket: null, can_cancel: false, can_close: false, close_blocked_reason: 'already_closed', cancelled_at: '2026-10-15T09:00:00.000Z', cancellation_reason: 'user_closed' };
  f.state.body = { id: job.id, status: 'cancelled', revision: 8, job, usage };
  assert.deepEqual((await f.call('close_video_job', { job_id: 'chosen/id', expected_revision: 7 })).result.structuredContent, f.state.body);
  assert.deepEqual(f.requests, [{ method: 'POST', path: '/api/v1/video-jobs/chosen%2Fid/close', body: { expected_revision: 7 } }]);
});

for (const bucket of ['draft', 'active']) test(bucket + ' quota preserves actionable fields without retrying create', async t => {
  const f = await fixture(t);
  const error = bucket === 'draft' ? 'video_draft_limit_reached' : 'video_job_limit_reached';
  const actions = bucket === 'draft' ? ['list_video_jobs', 'cancel_video_job', 'continue_existing_job'] : ['list_video_jobs', 'continue_existing_job', 'close_video_job'];
  f.state.status = 429;
  f.state.body = { error, scope: 'account', quota_bucket: bucket, count: 10, limit: 10, remaining: 0, retryable: false, message: bucket + ' capacity is full.', usage, actions };
  const reply = await f.call('create_video_job', createArgs);
  assert.deepEqual(reply.error.data, { status: 429, ...f.state.body });
  assert.match(reply.error.message, new RegExp(error));
  assert.deepEqual(f.requests.map(req => [req.method, req.path]), [['GET', '/api/v1/capabilities'], ['POST', '/api/v1/video-jobs']]);
  f.state.status = 200; f.state.body = { jobs: [summary], next_cursor: null, usage };
  assert.equal((await f.call('list_video_jobs')).error, undefined);
  assert.equal(f.requests.filter(req => req.method === 'POST').length, 1);
});

test('unsafe cancellation keeps bounded safe summary/reason and strips diagnostics and credentials', async t => {
  const f = await fixture(t);
  f.state.status = 409;
  const job = { ...summary, status: 'attention', can_cancel: false, cancel_blocked_reason: 'provider_receipt_present' };
  f.state.body = {
    error: 'video_job_not_cancellable', reason: 'provider_receipt_present', message: 'A receipt exists. Bearer ' + testKey,
    job: { ...job, provider_receipt: 'private-provider-token', authorization: 'Bearer second-private-token' },
    usage: { ...usage, token: testKey, active: { ...usage.active, secret: 'private-provider-token' } },
    authorization: 'Bearer ' + testKey, raw: { password: 'never-forward-this', diagnostic: 'private-provider-token' },
  };
  const reply = await f.call('cancel_video_job', { job_id: 'draft-1' });
  assert.equal(reply.error.data.reason, 'provider_receipt_present');
  assert.deepEqual(reply.error.data.job, job);
  assert.deepEqual(reply.error.data.usage, usage);
  const serialized = JSON.stringify(reply);
  for (const forbidden of [testKey, 'second-private-token', 'private-provider-token', 'never-forward-this', 'authorization', 'provider_receipt"']) assert.equal(serialized.includes(forbidden), false);
  assert.equal(f.requests.length, 1);
});

test('unsafe close exposes only bounded public fields and never retries', async t => {
  const f = await fixture(t);
  const job = { ...summary, status: 'attention', can_close: false, close_blocked_reason: 'provider_receipt_present' };
  f.state.status = 409;
  f.state.body = { error: 'video_job_not_closable', reason: 'provider_receipt_present', message: 'Still running', job: { ...job, provider_receipt: testKey }, diagnostic: testKey };
  const reply = await f.call('close_video_job', { job_id: 'stopped-1', expected_revision: 3 });
  assert.equal(reply.error.data.reason, 'provider_receipt_present');
  assert.deepEqual(reply.error.data.job, job);
  assert.equal(JSON.stringify(reply).includes(testKey), false);
  assert.deepEqual(f.requests, [{ method: 'POST', path: '/api/v1/video-jobs/stopped-1/close', body: { expected_revision: 3 } }]);
});

test('unknown HTTP errors and non-JSON diagnostics cannot leak their bodies', async t => {
  const f = await fixture(t);
  for (const body of [
    { error: 'oops ' + testKey, message: 'raw-diagnostic-secret', raw: { token: testKey } },
    '<html>Authorization: Bearer ' + testKey + '</html>',
  ]) {
    f.state.status = 503; f.state.body = body;
    const reply = await f.call('get_account_usage');
    assert.equal(reply.error.data.status, 503);
    assert.equal(JSON.stringify(reply).includes(testKey), false);
    assert.equal(JSON.stringify(reply).includes('raw-diagnostic-secret'), false);
  }
  assert.equal(f.requests.length, 2);
});

test('oversized or malformed lifecycle error fields are bounded rather than copied wholesale', async t => {
  const f = await fixture(t);
  f.state.status = 429;
  f.state.body = {
    error: 'video_job_limit_reached', scope: 'account', quota_bucket: 'active', retryable: false,
    count: 'credential-in-count', limit: 10, remaining: -1,
    message: 'x'.repeat(20000), usage: { ...usage, active: { ...usage.active, counted_statuses: Array(1000).fill('attention') } },
    actions: ['list_video_jobs', 'cancel_video_job', 'delete_everything'],
  };
  const reply = await f.call('create_video_job', createArgs);
  assert.ok(reply.error.data.message.length <= 512);
  assert.ok(reply.error.data.usage.active.counted_statuses.length <= 32);
  assert.equal(reply.error.data.count, undefined);
  assert.equal(reply.error.data.remaining, undefined);
  assert.deepEqual(reply.error.data.actions, ['list_video_jobs']);
});

test('uncertain create outcome never triggers a second POST and allows subsequent list recovery', async t => {
  const f = await fixture(t);
  f.state.disconnectCreate = true;
  const reply = await f.call('create_video_job', createArgs);
  assert.equal(reply.error.data.error, 'api_request_outcome_unknown');
  assert.equal(reply.error.data.retryable, false);
  assert.equal(f.requests.filter(req => req.method === 'POST').length, 1);
  f.state.disconnectCreate = false; f.state.body = { jobs: [summary], next_cursor: null, usage };
  assert.equal((await f.call('list_video_jobs')).error, undefined);
  assert.equal(f.requests.filter(req => req.method === 'POST').length, 1);
});

test('existing create then prepare reuses the returned task ID without extra creation', async t => {
  const f = await fixture(t);
  f.state.body = { id: 'created-once', status: 'draft', generation_mode: 'six_references' };
  const created = (await f.call('create_video_job', createArgs)).result.structuredContent;
  f.state.jobs.set('/api/v1/jobs/' + created.id, created);
  f.state.body = { id: created.id, status: 'queued' };
  assert.equal((await f.call('prepare_video_job', { job_id: created.id })).error, undefined);
  assert.deepEqual(f.requests.map(req => [req.method, req.path]), [
    ['GET', '/api/v1/capabilities'], ['POST', '/api/v1/video-jobs'],
    ['GET', '/api/v1/jobs/created-once'], ['GET', '/api/v1/capabilities'], ['POST', '/api/v1/video-jobs/created-once/prepare'],
  ]);
});

test('active admission denial and cancelled prepare preserve the same ID and never create a replacement', async t => {
  const f = await fixture(t);
  f.state.jobs.set('/api/v1/jobs/existing', { id: 'existing', generation_mode: 'legacy_frames', status: 'draft' });
  f.state.status = 429;
  f.state.body = { error: 'video_job_limit_reached', scope: 'account', quota_bucket: 'active', count: 10, limit: 10, remaining: 0, retryable: false, message: 'Active capacity is full.', usage, actions: ['list_video_jobs', 'continue_existing_job'] };
  assert.equal((await f.call('prepare_video_job', { job_id: 'existing' })).error.data.error, 'video_job_limit_reached');
  f.state.status = 409; f.state.body = { error: 'video_job_cancelled', message: 'This task is cancelled and cannot be prepared.' };
  assert.deepEqual((await f.call('prepare_video_job', { job_id: 'existing' })).error.data, { status: 409, ...f.state.body });
  assert.deepEqual(f.requests.filter(req => req.method === 'POST').map(req => req.path), ['/api/v1/video-jobs/existing/prepare', '/api/v1/video-jobs/existing/prepare']);
});

test('401 and old-server 404 return errors without probing create, cancel or a different route', async t => {
  const f = await fixture(t);
  f.state.status = 401; f.state.body = { error: 'invalid_api_key', message: 'Authorization: Bearer ' + testKey };
  const auth = await f.call('get_account_usage');
  assert.equal(auth.error.data.status, 401);
  assert.equal(auth.error.data.error, 'invalid_api_key');
  f.state.status = 404; f.state.body = '<html>old service</html>';
  assert.equal((await f.call('list_video_jobs')).error.data.status, 404);
  assert.equal(JSON.stringify(auth).includes(testKey), false);
  assert.deepEqual(f.requests.map(req => [req.method, req.path]), [['GET', '/api/v1/account/usage'], ['GET', '/api/v1/video-jobs']]);
});

test('malformed successful create response is uncertain and never returned as raw output', async t => {
  const f = await fixture(t);
  f.state.body = '<html>private-diagnostic ' + testKey + '</html>';
  const reply = await f.call('create_video_job', createArgs);
  assert.equal(reply.error.data.error, 'api_request_outcome_unknown');
  assert.equal(reply.error.data.retryable, false);
  assert.equal(JSON.stringify(reply).includes('private-diagnostic'), false);
  assert.equal(JSON.stringify(reply).includes(testKey), false);
  assert.equal(f.requests.filter(req => req.method === 'POST').length, 1);
});
