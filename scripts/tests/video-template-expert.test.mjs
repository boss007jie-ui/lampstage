import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const bridge = fileURLToPath(new URL('../../workbuddy-expert/lampstage-creative-expert/scripts/lampstage-http.mjs', import.meta.url));
const remoteCatalog = fileURLToPath(new URL('../../apps/web/lib/mcp-tools.ts', import.meta.url));
const fixtureKey = 'fixture-only-template-key';
const sha = 'a'.repeat(64);
const signed = suffix => `https://media.example.invalid/${suffix}%2Ffilm.mp4?q-signature=fake+value%2B&response-content-disposition=attachment%3Bfilename%3Dpart%2520one.mp4`;
const newNames = ['get_video_delivery', 'submit_video_feedback', 'list_video_templates', 'get_video_template', 'update_video_template'];

async function fixture(t) {
  const requests = [];
  const state = { response: {} };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    requests.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : null });
    assert.equal(req.headers.authorization, `Bearer ${fixtureKey}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/api/v1/capabilities'
      ? { capabilities: [{ id: 'video.replicate', status: 'available', modes: { six_references: true } }] }
      : state.response));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [bridge], {
    env: { SystemRoot: process.env.SystemRoot ?? '', LAMPSTAGE_API_BASE_URL: `http://127.0.0.1:${server.address().port}/api/v1`, LAMPSTAGE_API_KEY: fixtureKey },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let id = 0, buffer = '', stderr = '';
  const pending = new Map();
  child.stderr.setEncoding('utf8'); child.stderr.on('data', value => { stderr += value; });
  child.stdout.setEncoding('utf8'); child.stdout.on('data', value => {
    buffer += value;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'); const reply = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const waiter = pending.get(reply.id);
      if (waiter) { pending.delete(reply.id); clearTimeout(waiter.timer); waiter.resolve(reply); }
    }
  });
  const failPending = error => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } pending.clear(); };
  child.on('error', failPending); child.on('exit', code => failPending(new Error(`bridge exit ${code}: ${stderr}`)));
  t.after(async () => { child.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(stderr.includes(fixtureKey), false); });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const next = ++id; const timer = setTimeout(() => { pending.delete(next); reject(new Error(`bridge timeout: ${stderr}`)); }, 5000);
    pending.set(next, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
  });
  return { requests, state, call: (name, args) => rpc('tools/call', { name, arguments: args }), list: () => rpc('tools/list') };
}

function request(method, path, body = null) { return { method, path, body }; }
function result(reply) { assert.equal(reply.error, undefined); return reply.result.structuredContent; }
function rejected(reply) { assert.ok(reply.error, 'invalid input must be rejected by bridge'); assert.doesNotMatch(reply.error.message, /^Unknown tool:/); }

test('28 local tools preserve all five template schemas matching the static remote catalog', async t => {
  const f = await fixture(t);
  const source = await readFile(remoteCatalog, 'utf8');
  const match = source.match(/export const MCP_TOOLS = (\[[\s\S]*?\]) as const;/);
  assert.ok(match, 'static MCP catalog declaration is readable without importing server routes');
  const remote = vm.runInNewContext(`(${match[1]})`, { IMAGE_REFERENCE_ROLES: ['character', 'product', 'product_detail', 'scene', 'start_state', 'end_state'], DEFAULT_IMAGE_MODEL: 'nano_banana_21' }, { timeout: 1000 });
  const catalogReply = await f.list();
  assert.equal(catalogReply.error, undefined);
  const local = catalogReply.result.tools;
  assert.equal(local.length, 28);
  assert.equal(new Set(local.map(tool => tool.name)).size, 28);
  for (const name of newNames) {
    const a = local.find(tool => tool.name === name);
    const b = remote.find(tool => tool.name === name);
    assert.ok(a && b, `${name} must exist in both catalogs`);
    assert.deepEqual(JSON.parse(JSON.stringify(a.inputSchema)), JSON.parse(JSON.stringify(b.inputSchema)), name);
  }
  const create = local.find(tool => tool.name === 'create_video_job');
  const remoteCreate = remote.find(tool => tool.name === 'create_video_job');
  assert.deepEqual(create.inputSchema.properties.template_version_id, JSON.parse(JSON.stringify(remoteCreate.inputSchema.properties.template_version_id)));
  const localSegment = create.inputSchema.properties.segment_plan.items.properties;
  const remoteSegment = remoteCreate.inputSchema.properties.segment_plan.items.properties;
  for (const field of ['instructions', 'before_state', 'after_state']) {
    assert.deepEqual(localSegment[field], JSON.parse(JSON.stringify(remoteSegment[field])), `segment_plan.${field}`);
  }
  assert.equal(localSegment.instructions.maxLength, 1600);
  assert.equal(localSegment.before_state.maxLength, 400);
  assert.equal(localSegment.after_state.maxLength, 400);
  assert.deepEqual(f.requests, []);
});

test('delivery returns complete output and every segment with signed URLs untouched; read never posts', async t => {
  const f = await fixture(t);
  f.state.response = { job_id: 'job-1', title: 'Reviewed film', status: 'completed', output_sha256: sha,
    output: { url: signed('full'), download_url: signed('full-download'), sha256: sha, media: { duration: 10, width: 1080, height: 1920 } },
    source: { url: signed('source'), sha256: sha, duration: 10 },
    segments: [{ index: 0, accepted: true, url: signed('part-1'), download_url: signed('part-1-download'), sha256: sha, media: { duration: 5, width: 1080, height: 1920 } },
      { index: 1, accepted: true, url: signed('part-2'), download_url: signed('part-2-download'), sha256: sha, media: { duration: 5, width: 1080, height: 1920 } }],
    feedback: null, can_feedback: true, template_save_supported: true };
  assert.deepEqual(result(await f.call('get_video_delivery', { job_id: 'job-1' })), f.state.response);
  assert.deepEqual(f.requests, [request('GET', '/api/v1/video-jobs/job-1/delivery')]);
  f.state.response = { ...f.state.response, status: 'review', output_sha256: null, output: null, can_feedback: false };
  assert.deepEqual(result(await f.call('get_video_delivery', { job_id: 'job-1' })), f.state.response);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(entry => entry.method === 'GET' && entry.path === '/api/v1/video-jobs/job-1/delivery'));
});

test('three feedback decisions preserve exact hash and body; only explicit save requests a template', async t => {
  const f = await fixture(t);
  for (const decision of ['needs_changes', 'satisfied', 'satisfied_save_template']) {
    const args = { job_id: 'job-1', decision, output_sha256: sha, notes: 'Reviewed full film\npart one\tand part two.' };
    if (decision === 'satisfied_save_template') Object.assign(args, { name: 'Sleeve demo', category: 'Apparel', template_id: 'tpl-1' });
    f.state.response = { feedback: { decision, output_sha256: sha }, template: decision === 'satisfied_save_template' ? { id: 'tpl-1' } : null, version_id: decision === 'satisfied_save_template' ? 'ver-2' : null };
    assert.deepEqual(result(await f.call('submit_video_feedback', args)), f.state.response);
    assert.deepEqual(f.requests.at(-1), request('POST', '/api/v1/video-jobs/job-1/feedback', Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'job_id'))));
  }
  assert.equal(f.requests.length, 3);
});

test('template list forwards filters and base64url cursor with stable pagination encoding', async t => {
  const f = await fixture(t);
  const args = { status: 'archived', source_asset_id: 'source-1', source_sha256: sha, limit: 50, cursor: 'YWJjXzEyMy0' };
  f.state.response = { templates: [{ id: 'tpl-1', code: 'T001' }], next_cursor: 'bmV4dF8xLQ' };
  assert.deepEqual(result(await f.call('list_video_templates', args)), f.state.response);
  const last = f.requests.at(-1);
  assert.equal(last.method, 'GET');
  const url = new URL(last.path, 'http://localhost');
  assert.equal(url.pathname, '/api/v1/video-templates');
  assert.deepEqual(Object.fromEntries(url.searchParams), { status: 'archived', source_asset_id: 'source-1', source_sha256: sha, limit: '50', cursor: args.cursor });
  assert.equal(last.body, null);
});

test('template detail keeps selected version recipe and ordered segment plan verbatim without creating', async t => {
  const f = await fixture(t);
  const payload = { source_asset_id: 'source-1', product_asset_id: 'product-1', title: 'Sleeve demo', instructions: 'Keep original motion.', preserve_audio: true, generation_mode: 'six_references',
    reference_assets: [{ asset_id: 'pose-1', role: 'start_state', label: 'pose' }, { asset_id: 'product-1', role: 'product', label: 'shirt' }],
    segment_plan: [{ start: 0, source_duration: 5, duration: 5, instructions: 'Pull sleeve.', before_state: 'Hand outside.', after_state: 'Hand inside.', reference_assets: [{ asset_id: 'pose-1', role: 'start_state', label: 'pose' }] },
      { start: 5, source_duration: 5, duration: 5, instructions: 'Raise arm.', before_state: 'Arm down.', after_state: 'Arm up.', start_from_segment: 0, reference_assets: [{ asset_id: 'pose-1', role: 'start_state', label: 'pose' }] }] };
  f.state.response = { template: { id: 'tpl-1', code: 'T001', name: 'Sleeve demo' }, versions: [{ id: 'ver-2', version: 2, source_job_id: 'job-1', output_sha256: sha }], selected_version: { id: 'ver-2', version: 2, source_asset_id: 'source-1', source_sha256: sha, output_sha256: sha, workflow_profile: 'sixref-v1', recipe_schema_version: 1, create_payload: payload } };
  assert.deepEqual(result(await f.call('get_video_template', { template_id: 'tpl-1', version_id: 'ver-2' })), f.state.response);
  assert.deepEqual(f.requests, [request('GET', '/api/v1/video-templates/tpl-1?version_id=ver-2')]);
});

test('template update forwards rename, category, archive and restore as exact PATCH bodies', async t => {
  const f = await fixture(t);
  for (const patch of [{ name: 'New title' }, { category: 'Outerwear' }, { archived: true }, { archived: false }]) {
    result(await f.call('update_video_template', { template_id: 'tpl-1', ...patch }));
    assert.deepEqual(f.requests.at(-1), request('PATCH', '/api/v1/video-templates/tpl-1', patch));
  }
});

test('invalid template inputs fail before any network request', async t => {
  const f = await fixture(t);
  const invalid = [
    ['get_video_delivery', { job_id: 'job-1', surprise: true }],
    ['get_video_delivery', { job_id: 'x'.repeat(129) }],
    ['get_video_delivery', { job_id: 'bad\nline' }],
    ['submit_video_feedback', { job_id: 'job-1', decision: 'satisfied', output_sha256: sha.toUpperCase() }],
    ['submit_video_feedback', { job_id: 'job-1', decision: 'satisfied', output_sha256: sha, notes: 'n'.repeat(2001) }],
    ['submit_video_feedback', { job_id: 'job-1', decision: 'satisfied', output_sha256: sha, notes: 'bad\u0000note' }],
    ['submit_video_feedback', { job_id: 'job-1', decision: 'satisfied', output_sha256: sha, name: 'bad\nname' }],
    ['submit_video_feedback', { job_id: 'job-1', decision: 'satisfied', output_sha256: sha, template_id: 'tpl-1' }],
    ['submit_video_feedback', { job_id: 'job-1', decision: 'needs_changes', output_sha256: sha, name: 'x'.repeat(81) }],
    ['submit_video_feedback', { job_id: 'job-1', decision: 'satisfied_save_template', output_sha256: sha, category: 'x'.repeat(41) }],
    ['list_video_templates', { limit: 0 }], ['list_video_templates', { limit: 51 }],
    ['list_video_templates', { source_sha256: sha.toUpperCase() }],
    ['list_video_templates', { cursor: 'x'.repeat(513) }], ['list_video_templates', { cursor: 'abc+def=' }],
    ['list_video_templates', { status: 'active', unexpected: true }],
    ['get_video_template', { template_id: 'tpl-1', version_id: 'bad\tversion' }],
    ['update_video_template', { template_id: 'tpl-1' }],
    ['update_video_template', { template_id: 'tpl-1', name: '' }],
    ['update_video_template', { template_id: 'tpl-1', archived: true, hidden: true }],
  ];
  for (const [name, args] of invalid) rejected(await f.call(name, args));
  assert.deepEqual(f.requests, []);
});

test('blank feedback name is accepted for default naming', async t => {
  const f = await fixture(t);
  const args = { job_id: 'job-1', decision: 'satisfied_save_template', output_sha256: sha, name: '   ' };
  result(await f.call('submit_video_feedback', args));
  assert.deepEqual(f.requests, [request('POST', '/api/v1/video-jobs/job-1/feedback', { decision: args.decision, output_sha256: sha, name: '   ' })]);
});

test('new template job keeps chosen version, source, ordered references and plan; only capabilities GET and one create POST', async t => {
  const f = await fixture(t);
  const args = { source_asset_id: 'source-1', template_version_id: 'ver-2', product_asset_id: 'product-2', title: 'Reviewed reuse', instructions: 'Replace garment only.', preserve_audio: true, generation_mode: 'six_references',
    reference_assets: [{ asset_id: 'pose-2', role: 'start_state', label: 'new pose' }, { asset_id: 'product-2', role: 'product', label: 'new shirt' }],
    segment_plan: [{ start: 0, source_duration: 5, duration: 5, instructions: 'Pull sleeve.', before_state: 'Hand outside.', after_state: 'Hand inside.', reference_assets: [{ asset_id: 'pose-2', role: 'start_state', label: 'new pose' }] }] };
  result(await f.call('create_video_job', args));
  assert.deepEqual(f.requests, [request('GET', '/api/v1/capabilities'), request('POST', '/api/v1/video-jobs', args)]);
});

test('new template job rejects old runtime state and non-six mode without even reading capabilities', async t => {
  const f = await fixture(t);
  const base = { source_asset_id: 'source-1', template_version_id: 'ver-2', generation_mode: 'six_references', reference_assets: [{ asset_id: 'pose-2', role: 'start_state', label: 'pose' }], segment_plan: [{ start: 0, source_duration: 5, duration: 5, instructions: 'Pull sleeve.', before_state: 'Hand outside.', after_state: 'Hand inside.' }] };
  for (const field of ['renderConsent', 'review_token', 'candidate', 'receipt', 'budget']) rejected(await f.call('create_video_job', { ...base, [field]: 'old-state' }));
  for (const generation_mode of ['direct_references', 'legacy_frames']) rejected(await f.call('create_video_job', { ...base, generation_mode }));
  assert.deepEqual(f.requests, []);
});

test('template reuse rejects malformed audio strategy before server defaults or capability requests', async t => {
  const f = await fixture(t);
  const base = { source_asset_id: 'source-1', template_version_id: 'ver-2', generation_mode: 'six_references', reference_assets: [{ asset_id: 'pose-2', role: 'start_state', label: 'pose' }], segment_plan: [{ start: 0, source_duration: 5, duration: 5, instructions: 'Pull sleeve.', before_state: 'Hand outside.', after_state: 'Hand inside.' }] };
  for (const preserve_audio of ['false', 0, null, []]) rejected(await f.call('create_video_job', { ...base, preserve_audio }));
  assert.deepEqual(f.requests, []);
  const args = { ...base, preserve_audio: false };
  result(await f.call('create_video_job', args));
  assert.deepEqual(f.requests, [request('GET', '/api/v1/capabilities'), request('POST', '/api/v1/video-jobs', args)]);
});

test('template reuse rejects explicitly blank titles before server defaulting', async t => {
  const f = await fixture(t);
  const base = { source_asset_id: 'source-1', template_version_id: 'ver-2', generation_mode: 'six_references', reference_assets: [{ asset_id: 'pose-2', role: 'start_state', label: 'pose' }], segment_plan: [{ start: 0, source_duration: 5, duration: 5, instructions: 'Pull sleeve.', before_state: 'Hand outside.', after_state: 'Hand inside.' }] };
  for (const title of ['', '   ']) rejected(await f.call('create_video_job', { ...base, title }));
  assert.deepEqual(f.requests, []);
});
