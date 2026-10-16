import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const bridge = fileURLToPath(new URL('../../workbuddy-expert/lampstage-creative-expert/scripts/lampstage-http.mjs', import.meta.url));
const fixtureKey = 'fixture-only-production-key';
const sample = {
  source_asset_id: 'motion-1', generation_mode: 'six_references', title: 'Reviewed plan',
  instructions: 'Preserve the reviewed appearance.',
  reference_assets: [{ asset_id: 'image-1', role: 'start_state', label: 'Reviewed starting pose' }],
  segment_plan: [{ start: 0, source_duration: 5, duration: 5, instructions: 'Put the hand through the sleeve.', before_state: 'Sleeve empty.', after_state: 'Hand visible at the cuff.' }],
};

async function fixture(t) {
  const requests = [];
  const state = { job: { id: 'job-1', status: 'generating' }, apiStatus: 200, errorBody: null };
  const server = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const text = Buffer.concat(parts).toString();
    requests.push({ method: req.method, path: req.url, body: text ? JSON.parse(text) : null });
    assert.equal(req.headers.authorization, 'Bearer ' + fixtureKey);
    res.setHeader('Content-Type', 'application/json');
    if (req.url !== '/api/v1/capabilities' && state.apiStatus !== 200) {
      res.statusCode = state.apiStatus; res.end(JSON.stringify(state.errorBody)); return;
    }
    res.end(JSON.stringify(req.url === '/api/v1/capabilities'
      ? { capabilities: [{ id: 'video.replicate', status: 'available', modes: { six_references: true } }] }
      : req.method === 'POST' ? { id: 'job-1', status: 'draft' } : state.job));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [bridge], {
    env: { SystemRoot: process.env.SystemRoot ?? '', LAMPSTAGE_API_BASE_URL: `http://127.0.0.1:${server.address().port}/api/v1`, LAMPSTAGE_API_KEY: fixtureKey },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let id = 0, buffer = '', stderr = ''; const pending = new Map();
  child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { stderr += text; });
  child.stdout.setEncoding('utf8'); child.stdout.on('data', text => {
    buffer += text;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'); const reply = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const waiter = pending.get(reply.id);
      if (waiter) { pending.delete(reply.id); clearTimeout(waiter.timer); waiter.resolve(reply); }
    }
  });
  child.on('error', error => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } pending.clear(); });
  child.on('exit', code => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(`bridge exit ${code}`)); } pending.clear(); });
  t.after(async () => { child.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(stderr.includes(fixtureKey), false); });
  const call = (name, args) => new Promise((resolve, reject) => {
    const next = ++id; const timer = setTimeout(() => { pending.delete(next); reject(new Error('fixture timeout')); }, 5000);
    pending.set(next, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  });
  return { call, requests, state };
}

for (const [field, limit] of [['instructions', 1600], ['before_state', 400], ['after_state', 400]]) {
  test(`six-reference ${field} rejects oversized or control-character content before any request`, async t => {
    const f = await fixture(t);
    for (const value of ['x'.repeat(limit + 1), 'visible\nnext', 'visible\tfield', 'visible\u007fend', 'visible\u0000end']) {
      const args = structuredClone(sample); args.segment_plan[0][field] = value;
      const reply = await f.call('create_video_job', args);
      assert.ok(reply.error, `${field} must reject invalid content`);
      assert.match(reply.error.message, new RegExp(`segment_plan\\[0\\]\\.${field}`));
    }
    assert.deepEqual(f.requests, []);
  });
}

test('six-reference labels and asset identifiers reject malformed values without capability or create calls', async t => {
  const f = await fixture(t);
  for (const override of [{ label: 'x'.repeat(81) }, { label: 'pose\nidentity' }, { label: 'pose\u0000identity' }, { asset_id: 'image with spaces' }, { asset_id: 'x'.repeat(129) }]) {
    const args = structuredClone(sample); Object.assign(args.reference_assets[0], override);
    assert.ok((await f.call('create_video_job', args)).error);
  }
  const args = structuredClone(sample); args.segment_plan[0].reference_assets = [{ ...args.reference_assets[0], label: 'bad\tlabel' }];
  assert.ok((await f.call('create_video_job', args)).error);
  assert.deepEqual(f.requests, []);
});

test('preflight refuses fields the API would silently truncate instead of editing the approved text', async t => {
  const f = await fixture(t);
  for (const override of [{ instructions: 'x'.repeat(2001) }, { title: 'x'.repeat(81) }]) {
    assert.ok((await f.call('create_video_job', { ...sample, ...override })).error);
  }
  assert.deepEqual(f.requests, []);
});

test('valid boundary lengths preserve exact approved text and reference order', async t => {
  const f = await fixture(t);
  const args = structuredClone(sample);
  args.title = 't'.repeat(80); args.instructions = 'g'.repeat(2000);
  args.reference_assets[0].label = 'r'.repeat(80);
  args.segment_plan[0].instructions = 'a'.repeat(1600);
  args.segment_plan[0].before_state = 'b'.repeat(400); args.segment_plan[0].after_state = 'c'.repeat(400);
  assert.equal((await f.call('create_video_job', args)).error, undefined);
  assert.deepEqual(f.requests, [
    { method: 'GET', path: '/api/v1/capabilities', body: null },
    { method: 'POST', path: '/api/v1/video-jobs', body: args },
  ]);
});

test('get_job preserves signed media URLs byte for byte and never accepts or submits candidates', async t => {
  const f = await fixture(t);
  const signed = 'https://media.example.invalid/video%2Fpart.mp4?q-sign-time=1%3B2&q-signature=fake+value%2B&response-content-disposition=attachment%3Bfilename%3Dpart%2520one.mp4';
  f.state.job = { id: 'job-1', status: 'review', segments: [{ index: 0, candidate_url: signed, accepted: false }], ready_segment_indices: [] };
  const reply = await f.call('get_job', { job_id: 'job-1' });
  assert.deepEqual(reply.result.structuredContent, f.state.job);
  assert.deepEqual(f.requests, [{ method: 'GET', path: '/api/v1/jobs/job-1', body: null }]);
});

test('download_output resolves fresh complete-output links by job ID without rewriting signed URLs or regenerating', async t => {
  const f = await fixture(t);
  for (const suffix of ['old%2Bsignature+value', 'fresh%2Fsignature+value']) {
    const url = `https://media.example.invalid/final.mp4?q-signature=${suffix}&response-content-disposition=attachment%3Bfilename%3Done.mp4`;
    f.state.job = { id: 'job-1', status: 'completed', output_url: url };
    assert.deepEqual((await f.call('download_output', { job_id: 'job-1' })).result.structuredContent, { job_id: 'job-1', output_urls: [url] });
  }
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(request => request.method === 'GET' && request.path === '/api/v1/jobs/job-1'));
});

test('an assembly failure remains visible and does not manufacture an official final output from candidate links', async t => {
  const f = await fixture(t);
  f.state.job = { id: 'job-1', status: 'review', phase: 'assemble', error: 'Final output validation failed.', output_url: null, segments: [{ index: 0, candidate_url: 'https://media.example.invalid/part.mp4', accepted: true }] };
  assert.deepEqual((await f.call('get_job', { job_id: 'job-1' })).result.structuredContent, f.state.job);
  assert.deepEqual((await f.call('download_output', { job_id: 'job-1' })).result.structuredContent, { job_id: 'job-1', output_urls: [] });
  assert.ok(f.requests.every(request => request.method === 'GET'));
});

test('candidate timing in get_job remains structured and does not trigger a write', async t => {
  const f = await fixture(t);
  const timing = { status: 'incompatible', reason: 'duration_out_of_range', source_duration: 3.711, requested_duration: 4,
    actual_duration: 107 / 24, trim_start: 0, kept_duration: 107 / 24, delivery_duration: 107 / 24,
    retime_ratio: (107 / 24) / 3.711, max_retime_ratio: 1.15,
    allowed_kept_duration: { min: 3.711 / 1.15, max: 3.711 * 1.15 }, visual_review_required: true };
  f.state.job = { id: 'job-1', status: 'review', segments: [{ index: 0, candidate_timing: timing }] };
  const reply = await f.call('get_job', { job_id: 'job-1' });
  assert.deepEqual(reply.result.structuredContent.segments[0].candidate_timing, timing);
  assert.deepEqual(f.requests.map(request => request.method), ['GET']);
});

test('review 400 retains only safe reason, index and timing fields', async t => {
  const f = await fixture(t); f.state.apiStatus = 400;
  const timing = { status: 'incompatible', reason: 'duration_out_of_range', source_duration: 3.711, requested_duration: 4,
    actual_duration: 107 / 24, trim_start: null, kept_duration: 107 / 24, delivery_duration: 107 / 24,
    retime_ratio: (107 / 24) / 3.711, max_retime_ratio: 1.15,
    allowed_kept_duration: { min: 3.711 / 1.15, max: 3.711 * 1.15 }, visual_review_required: true };
  f.state.errorBody = { error: 'invalid_candidate_review', reason: 'duration_incompatible', segment_index: 0,
    timing: { ...timing, raw: fixtureKey, url: 'https://example.invalid/private' },
    message: fixtureKey, raw: 'private upstream diagnostic', token: fixtureKey };
  const request = { job_id: 'job-1', candidate_review_token: 'a'.repeat(64),
    decisions: [{ segment_index: 0, candidate_sha256: 'b'.repeat(64), action: 'accept' }] };
  const reply = await f.call('review_video_segments', request);
  assert.deepEqual(reply.error.data, { status: 400, error: 'invalid_candidate_review',
    message: 'Candidate review rejected: duration_incompatible.', reason: 'duration_incompatible', segment_index: 0, timing });
  assert.equal(JSON.stringify(reply).includes(fixtureKey), false);
  assert.equal(JSON.stringify(reply).includes('example.invalid'), false);
  f.state.errorBody = { error: 'invalid_candidate_review', reason: 'invalid_trim', segment_index: 0,
    timing: { ...timing, status: 'incompatible', reason: 'invalid_trim', trim_start: 865, kept_duration: -860.541667 },
    message: 'https://example.invalid/private', unexpected: fixtureKey };
  const negative = await f.call('review_video_segments', request);
  assert.deepEqual(negative.error.data.timing, { ...timing, status: 'incompatible', reason: 'invalid_trim',
    trim_start: 865, kept_duration: -860.541667 });
  assert.equal(JSON.stringify(negative).includes('example.invalid'), false);
  f.state.errorBody = { error: 'invalid_candidate_review', reason: 'https://example.invalid/private',
    segment_index: 0, timing, message: fixtureKey };
  const unknown = await f.call('review_video_segments', request);
  assert.deepEqual(unknown.error.data, { status: 400, error: 'invalid_candidate_review',
    message: 'Candidate review rejected. Inspect the current job before another decision.' });
  assert.equal(JSON.stringify(unknown).includes(fixtureKey), false);
  const missingDuration = { ...timing }; delete missingDuration.source_duration;
  for (const malformed of [
    missingDuration,
    { ...timing, actual_duration: 86401 },
    { ...timing, source_duration: 'https://example.invalid/private' },
    { ...timing, allowed_kept_duration: { min: 0, max: 4 } },
    { ...timing, allowed_kept_duration: { min: 4, max: 86401 } },
    { ...timing, allowed_kept_duration: { min: 5, max: 4 } },
    { ...timing, allowed_kept_duration: { min: 3, max: 4 }, visual_review_required: false },
  ]) {
    f.state.errorBody = { error: 'invalid_candidate_review', reason: 'duration_incompatible', timing: malformed, message: fixtureKey };
    const rejected = await f.call('review_video_segments', request);
    assert.equal(rejected.error.data.timing, undefined);
    assert.equal(JSON.stringify(rejected).includes(fixtureKey), false);
  }
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 10);
});

test('only exact known parser messages cross the bridge for invalid_video_references with HTTP 400', async t => {
  const f = await fixture(t); f.state.apiStatus = 400;
  for (const message of ['本段动作指令缺失或无效。', '动作前状态缺失或无效。', '动作后状态缺失或无效。',
    '每段第一张参考必须是唯一的 start_state 完整起态图；请核对起始人物、衣物、场景和姿态。']) {
    f.state.errorBody = { error: 'invalid_video_references', message, raw: 'private upstream diagnostic', api_key: fixtureKey };
    const reply = await f.call('create_video_job', sample);
    assert.deepEqual(reply.error.data, { status: 400, error: 'invalid_video_references', message });
    assert.equal(JSON.stringify(reply).includes(fixtureKey), false);
    assert.equal(JSON.stringify(reply).includes('private upstream'), false);
  }
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 4);
});

test('parser-message safety rejects appended diagnostics, arbitrary names, URLs and wrong status without retrying', async t => {
  const f = await fixture(t);
  const cases = [
    [400, '本段动作指令缺失或无效。 ' + fixtureKey],
    [400, '任意输入字段缺失或无效。'],
    [400, '本段动作指令缺失或无效。 https://example.invalid/private'],
    [400, '本段动作指令缺失或无效。\n'],
    [500, '本段动作指令缺失或无效。'],
  ];
  for (const [status, message] of cases) {
    f.state.apiStatus = status; f.state.errorBody = { error: 'invalid_video_references', message };
    const reply = await f.call('create_video_job', sample);
    assert.deepEqual(reply.error.data, { status, error: 'invalid_video_references', message: 'Lampstage API request failed.' });
  }
  assert.equal(f.requests.filter(request => request.method === 'POST').length, cases.length);
});
