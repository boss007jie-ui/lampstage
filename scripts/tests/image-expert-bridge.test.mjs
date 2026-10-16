import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const bridge = fileURLToPath(new URL('../../workbuddy-expert/lampstage-creative-expert/scripts/lampstage-http.mjs', import.meta.url));
const remoteCatalog = fileURLToPath(new URL('../../apps/web/lib/mcp-tools.ts', import.meta.url));
const remoteReferences = fileURLToPath(new URL('../../apps/web/lib/image-reference-contract.ts', import.meta.url));
const remoteModels = fileURLToPath(new URL('../../apps/web/lib/image-models.ts', import.meta.url));
const fixtureKey = 'fixture-only-image-key';
const roles = ['character', 'product', 'product_detail', 'scene', 'start_state', 'end_state'];
const references = roles.map((role, index) => ({ asset_id: `asset-${index}`, role, label: `Reference ${index}` }));
references[0] = { ...references[0], character_version_id: 'version-1', image_index: 0 };
const multi = refs => ({ reference_assets: refs, custom_prompt: 'Keep the product consistent.', image_count: 2 });

async function fixture(t) {
  const requests = [];
  const state = { status: 201, response: { job_id: 'job-1', status: 'queued' }, raw: null, disconnectAfterBody: false };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    requests.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : null });
    assert.equal(req.headers.authorization, `Bearer ${fixtureKey}`);
    if (state.disconnectAfterBody) { req.socket.destroy(); return; }
    res.statusCode = state.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(state.raw ?? JSON.stringify(state.response));
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
      const end = buffer.indexOf('\n');
      const reply = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const waiter = pending.get(reply.id);
      if (waiter) { pending.delete(reply.id); clearTimeout(waiter.timer); waiter.resolve(reply); }
    }
  });
  const failPending = error => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } pending.clear(); };
  child.on('error', failPending); child.on('exit', code => failPending(new Error(`bridge exit ${code}: ${stderr}`)));
  t.after(async () => { child.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(stderr.includes(fixtureKey), false); });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => { pending.delete(next); reject(new Error(`bridge timeout: ${stderr}`)); }, 5000);
    pending.set(next, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
  });
  return { requests, state, call: args => rpc('tools/call', { name: 'create_image_job', arguments: args }), list: () => rpc('tools/list') };
}

function accepted(reply) { assert.equal(reply.error, undefined); return reply.result.structuredContent; }
function rejected(reply) { assert.ok(reply.error, 'invalid image request must fail locally'); assert.doesNotMatch(reply.error.message, /^Unknown tool:/); }
function post(body) { return { method: 'POST', path: '/api/v1/image-jobs', body }; }

test('image tool schema matches remote catalog for ordered references, bounds and conditional source', async t => {
  const f = await fixture(t);
  const schema = (await f.list()).result.tools.find(tool => tool.name === 'create_image_job')?.inputSchema;
  assert.ok(schema);
  const [catalogSource, referencesSource, modelsSource] = await Promise.all([
    readFile(remoteCatalog, 'utf8'), readFile(remoteReferences, 'utf8'), readFile(remoteModels, 'utf8'),
  ]);
  const catalog = catalogSource.match(/export const MCP_TOOLS = (\[[\s\S]*?\]) as const;/);
  const rolesSource = referencesSource.match(/export const IMAGE_REFERENCE_ROLES = (\[[^\]]+\]) as const;/);
  const defaultSource = modelsSource.match(/export const DEFAULT_IMAGE_MODEL(?::[^=]+)?=\s*("[^"]+")/);
  assert.ok(catalog && rolesSource && defaultSource, 'remote static image catalog and its constants remain readable');
  const remote = vm.runInNewContext(`(${catalog[1]})`, {
    IMAGE_REFERENCE_ROLES: vm.runInNewContext(rolesSource[1]),
    DEFAULT_IMAGE_MODEL: JSON.parse(defaultSource[1]),
  }).find(tool => tool.name === 'create_image_job')?.inputSchema;
  assert.ok(remote);
  assert.deepEqual(schema, JSON.parse(JSON.stringify(remote)));
  assert.deepEqual(schema.required, ['custom_prompt', 'image_count']);
  assert.deepEqual(schema.oneOf, [{ required: ['asset_id'] }, { required: ['reference_assets'] }]);
  assert.equal(schema.properties.reference_assets.type, 'array');
  assert.equal(schema.properties.reference_assets.minItems, 1);
  assert.equal(schema.properties.reference_assets.maxItems, 6);
  const item = schema.properties.reference_assets.items;
  assert.deepEqual(new Set(item.required), new Set(['asset_id', 'role', 'label']));
  assert.deepEqual(new Set(item.properties.role.enum), new Set(roles));
  assert.equal(item.properties.label.minLength, 1);
  assert.equal(item.properties.label.maxLength, 80);
  assert.equal(item.properties.image_index.minimum, 0);
  assert.equal(item.properties.image_index.maximum, 5);
  assert.equal(item.properties.character_version_id.type, 'string');
  assert.equal(schema.properties.custom_prompt.maxLength, 12000);
  assert.equal(schema.properties.image_count.minimum, 1);
  assert.equal(schema.properties.image_count.maximum, 4);
  assert.deepEqual(schema.properties.image_model.enum, ['nano_banana_21', 'image_25']);
  assert.deepEqual(schema.properties.aspect_ratio.enum, ['1_1']);
  assert.deepEqual(f.requests, []);
});

test('one, four and six references forward in exact order with optional binding and independent output count', async t => {
  const f = await fixture(t);
  for (const length of [1, 4, 6]) {
    const args = { ...multi(references.slice(0, length)), image_count: length === 6 ? 1 : 4, image_model: length === 4 ? 'image_25' : 'nano_banana_21', aspect_ratio: '1_1' };
    assert.deepEqual(accepted(await f.call(args)), f.state.response);
    assert.deepEqual(f.requests.at(-1), post(args));
  }
  assert.equal(f.requests.length, 3);
  assert.deepEqual(f.requests[2].body.reference_assets.map(ref => ref.asset_id), references.map(ref => ref.asset_id));
  assert.deepEqual(f.requests[2].body.reference_assets[0], references[0]);
  assert.equal('uploaded_asset_id' in f.requests[2].body, false);
});

test('single-asset requests with explicit prompt and output count retain the uploaded_asset_id alias', async t => {
  const f = await fixture(t);
  const single = { asset_id: 'legacy-asset', custom_prompt: 'A clean catalog photograph.', image_count: 1 };
  accepted(await f.call(single));
  assert.deepEqual(f.requests.at(-1), post({ ...single, uploaded_asset_id: single.asset_id }));
  const custom = { ...single, image_count: 4, platform_style: 'domestic_ecommerce', aspect_ratio: '1_1' };
  accepted(await f.call(custom));
  assert.deepEqual(f.requests.at(-1), post({ ...custom, uploaded_asset_id: custom.asset_id }));
  assert.equal(f.requests.length, 2);
});

test('invalid reference bounds, fields, bindings and single-asset conflicts fail before network', async t => {
  const f = await fixture(t);
  const first = references[0];
  const invalid = [
    { ...multi([]) }, { ...multi([first]), reference_assets: null },
    { ...multi([first]), reference_assets: 'asset-1' },
    multi([...references, { asset_id: 'asset-7', role: 'scene', label: 'Extra' }]),
    multi([first, { ...references[1], asset_id: first.asset_id }]),
    multi([{ ...first, asset_id: '' }]), multi([{ ...first, asset_id: 17 }]),
    multi([{ ...first, asset_id: 'bad/id' }]),
    multi([{ ...first, role: 'unknown' }]), multi([{ ...first, label: '' }]),
    multi([{ ...first, label: 7 }]), multi([{ ...first, label: 'bad\nlabel' }]),
    multi([{ ...first, label: 'x'.repeat(81) }]),
    multi([{ ...first, surprise: true }]), multi([null]),
    multi([{ asset_id: 'asset-x', role: 'character', label: 'X', character_version_id: 'version-1' }]),
    multi([{ asset_id: 'asset-x', role: 'character', label: 'X', image_index: 0 }]),
    multi([{ ...first, character_version_id: null }]), multi([{ ...first, image_index: -1 }]),
    multi([{ ...first, character_version_id: 7 }]),
    multi([{ ...first, character_version_id: 'bad/id' }]),
    multi([{ ...first, image_index: 6 }]), multi([{ ...first, image_index: 0.5 }]),
    multi([{ ...first, image_index: '0' }]), multi([{ ...first, role: 'product' }]),
    { ...multi([first]), asset_id: 'legacy' }, { ...multi([first]), uploaded_asset_id: 'legacy' },
    { reference_assets: [first], image_count: 1 }, { ...multi([first]), custom_prompt: '' },
    { ...multi([first]), custom_prompt: 7 },
    { ...multi([first]), custom_prompt: 'x'.repeat(12001) },
    { ...multi([first]), image_count: undefined }, { ...multi([first]), image_count: 0 },
    { ...multi([first]), image_count: 5 }, { ...multi([first]), image_count: 1.5 },
    { ...multi([first]), image_count: '2' },
    { ...multi([first]), scene_kind: 'custom' }, { ...multi([first]), scene_kind: 'portrait' },
    { ...multi([first]), template_id: 'template-1' },
    { ...multi([first]), recommended_prompt_en: 'Use template' },
    { ...multi([first]), image_model: 'unsupported' }, { ...multi([first]), aspect_ratio: '16_9' },
    { custom_prompt: 'No source asset', image_count: 1 },
    { asset_id: 'legacy-asset' }, { asset_id: 'legacy-asset', image_count: 1 },
    { asset_id: 'legacy-asset', custom_prompt: 'A catalog photo.' },
  ];
  for (const [index, args] of invalid.entries()) {
    const reply = await f.call(args);
    try { rejected(reply); } catch (error) { error.message = `case ${index}: ${error.message}`; throw error; }
  }
  assert.deepEqual(f.requests, []);
});

test('API errors and unknown create outcomes make one request and do not leak the fixture key', async t => {
  const f = await fixture(t);
  const args = multi(references.slice(0, 1));
  const privateUrl = 'https://private.example.invalid/output.png?token=do-not-disclose';
  f.state.status = 409;
  f.state.response = { error: 'image_reference_conflict', message: `Bearer ${fixtureKey} ${privateUrl}` };
  const conflict = await f.call(args);
  rejected(conflict);
  assert.match(conflict.error.message, /image_reference_conflict/);
  assert.equal(f.requests.length, 1);
  f.state.status = 200;
  f.state.raw = 'not-json';
  const unknown = await f.call(args);
  rejected(unknown);
  assert.equal(unknown.error.data?.error, 'api_request_outcome_unknown');
  assert.equal(unknown.error.data?.retryable, false);
  assert.match(unknown.error.message, /image job/i);
  assert.match(unknown.error.message, /list_video_jobs/);
  assert.match(unknown.error.message, /cannot|does not/i);
  assert.match(unknown.error.message, /do not automatically|no automatic/i);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(request => request.path === '/api/v1/image-jobs'));
  for (const reply of [conflict, unknown]) {
    assert.equal(JSON.stringify(reply).includes(fixtureKey), false);
    assert.equal(JSON.stringify(reply).includes(privateUrl), false);
  }
});

test('socket disconnect after image POST leaves outcome unknown without resubmission', async t => {
  const f = await fixture(t);
  const args = multi(references.slice(0, 1));
  f.state.disconnectAfterBody = true;
  const reply = await f.call(args);
  rejected(reply);
  assert.deepEqual(f.requests, [post(args)]);
  assert.equal(reply.error.data?.error, 'api_request_outcome_unknown');
  assert.equal(reply.error.data?.retryable, false);
  assert.match(reply.error.message, /image job/i);
  assert.match(reply.error.message, /list_video_jobs.*cannot reconcile image jobs/i);
  assert.match(reply.error.message, /do not automatically resubmit/i);
  assert.equal(JSON.stringify(reply).includes(fixtureKey), false);
});

test('HTTP 500 image create error returns safely after exactly one POST', async t => {
  const f = await fixture(t);
  const args = multi(references.slice(0, 1));
  const privateUrl = 'https://private.example.invalid/output.png?token=do-not-disclose';
  f.state.status = 500;
  f.state.response = { error: 'image_provider_failure', message: `Bearer ${fixtureKey} ${privateUrl}` };
  const reply = await f.call(args);
  rejected(reply);
  assert.deepEqual(f.requests, [post(args)]);
  assert.equal(reply.error.data?.status, 500);
  assert.equal(JSON.stringify(reply).includes(fixtureKey), false);
  assert.equal(JSON.stringify(reply).includes(privateUrl), false);
});
