import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Exercise this isolated package without installing or loading the host SDK.
// The SDK seams are replaced with small deterministic transport stubs.
const source = await readFile(new URL("./provider.js", import.meta.url), "utf8");
const moduleSource = source.replace(/^import[\s\S]*?from "@hypit\/hypit\/[^"]+";\r?\n/gmu, "");
const seams = `
const canonicalize = (value) => value;
const defineEndpointPackage = (value) => value;
const wakeAfter = (handle) => ({ status: "waiting", handle });
const generationTypes = { videoSet: {} };
const mappingSupportsRequest = () => true;
const selectWireModelForRequest = () => "candidate";
const sealGeneratedVideoSet = (value) => value;
const compileWireRequest = async (_mapping, authored, upload) => ({ input: {
  prompt: authored.prompt,
  seconds: authored.seconds,
  resolution: authored.resolution,
  aspect_ratio: authored.aspect_ratio,
  reference_image_urls: await Promise.all(authored.images.map(upload)),
  reference_video_urls: await Promise.all(authored.videos.map(upload)),
} });
const createRuntimeEndpointAdapterFacet = (value) => value;
const runtimeConfigCredentialRef = (value) => value;
const runtimeConfigExact = () => {};
const runtimeConfigObject = (value) => value;
const runtimeConfigPositiveInteger = (value) => value;
const runtimeConfigString = (value) => value;
`;
const provider = await import(`data:text/javascript,${encodeURIComponent(seams + moduleSource)}`);

test("maps all six image slots, literal None, and manual four-second settings", () => {
  const nodes = provider.buildNodeInfoList({ prompt: "same scene", seconds: 4, resolution: "768P", aspect_ratio: "9:16" },
    ["one.png", "two.png", "three.png"], ["motion.mp4"]);
  assert.deepEqual(nodes.slice(0, 6), [
    { nodeId: "51", fieldName: "image", fieldValue: "one.png" },
    { nodeId: "366", fieldName: "image", fieldValue: "two.png" },
    { nodeId: "364", fieldName: "image", fieldValue: "three.png" },
    { nodeId: "43", fieldName: "image", fieldValue: "None" },
    { nodeId: "19", fieldName: "image", fieldValue: "None" },
    { nodeId: "23", fieldName: "image", fieldValue: "None" },
  ]);
  assert.deepEqual(nodes.filter((node) => ["381", "376", "259", "283"].includes(node.nodeId)), [
    { nodeId: "381", fieldName: "value", fieldValue: "4" },
    { nodeId: "376", fieldName: "index", fieldValue: "1" },
    { nodeId: "259", fieldName: "value", fieldValue: "4" },
    { nodeId: "283", fieldName: "value", fieldValue: "1.5" },
  ]);
  assert.deepEqual(nodes.find((node) => node.nodeId === "252" && node.fieldName === "megapixels"),
    { nodeId: "252", fieldName: "megapixels", fieldValue: "0.4096" });
  const six = provider.buildNodeInfoList({ prompt: "same scene", seconds: 5, resolution: "768P", aspect_ratio: "9:16" },
    ["1.png", "2.png", "3.png", "4.png", "5.png", "6.png"], ["motion.mp4"]);
  assert.deepEqual(six.slice(0, 6).map((item) => item.fieldValue),
    ["1.png", "2.png", "3.png", "4.png", "5.png", "6.png"]);
});

test("accepts an authored eight-second portrait window and maps both duration controls", () => {
  const input = { prompt: "same scene", seconds: 8, resolution: "768P", aspect_ratio: "9:16" };
  const nodes = provider.buildNodeInfoList(input, ["first-frame.png"], ["motion.mp4"],
    { firstPassMegapixels: 0.4096, upscaleFactor: 1.5 });
  assert.deepEqual(nodes.filter((item) => ["381", "259", "252", "283"].includes(item.nodeId) && item.fieldName !== "aspect_ratio"), [
    { nodeId: "381", fieldName: "value", fieldValue: "8" },
    { nodeId: "252", fieldName: "megapixels", fieldValue: "0.4096" },
    { nodeId: "259", fieldName: "value", fieldValue: "8" },
    { nodeId: "283", fieldName: "value", fieldValue: "1.5" },
  ]);
  const capability = provider.createRunningHubSixRefProvider({
    baseUrl: "https://www.runninghub.cn", fetch: async () => { throw new Error("No network expected"); },
    apiKey: "ref", instance: "test", pool: {},
  }).capabilities[0];
  const request = { ports: {
    duration: [8], resolution: ["768P"], aspectRatio: ["9:16"],
    referenceImage: ["first-frame.png"], referenceVideo: ["motion.mp4"],
  } };
  assert.equal(capability.supports({ constraints: request }).status, "supported");
  assert.equal(capability.supports({ constraints: { ...request, ports: { ...request.ports, duration: [9] } } }).status, "unsupported");
});

test("accepts a six-second portrait window and maps both duration controls", () => {
  const nodes = provider.buildNodeInfoList(
    { prompt: "same scene", seconds: 6, resolution: "768P", aspect_ratio: "9:16" },
    ["first-frame.png"], ["motion.mp4"],
  );
  assert.deepEqual(nodes.filter((item) => ["381", "259"].includes(item.nodeId)), [
    { nodeId: "381", fieldName: "value", fieldValue: "6" },
    { nodeId: "259", fieldName: "value", fieldValue: "6" },
  ]);
  const capability = provider.createRunningHubSixRefProvider({
    baseUrl: "https://www.runninghub.cn", fetch: async () => { throw new Error("No network expected"); },
    apiKey: "ref", instance: "test", pool: {},
  }).capabilities[0];
  const request = { ports: {
    duration: [6], resolution: ["768P"], aspectRatio: ["9:16"],
    referenceImage: ["first-frame.png"], referenceVideo: ["motion.mp4"],
  } };
  assert.equal(capability.supports({ constraints: request }).status, "supported");
});

test("supports only verified durations and rejects separate audio or frame ports", () => {
  const capability = provider.createRunningHubSixRefProvider({ fetch: async () => { throw new Error('No network expected'); }, apiKey: 'ref', instance: 'test', pool: {} }).capabilities[0];
  const ports = { resolution: ['768P'], aspectRatio: ['9:16'], referenceImage: ['first.png'], referenceVideo: ['motion.mp4'] };
  for (const duration of [4, 5, 6, 8]) assert.equal(capability.supports({ constraints: { ports: { ...ports, duration: [duration] } } }).status, 'supported');
  for (const duration of [0, 3, 7, 9]) assert.equal(capability.supports({ constraints: { ports: { ...ports, duration: [duration] } } }).status, 'unsupported');
  for (const extra of ['referenceAudio', 'firstFrame', 'lastFrame']) {
    assert.equal(capability.supports({ constraints: { ports: { ...ports, duration: [4], [extra]: ['extra'] } } }).status, 'unsupported');
  }
});

test("v2 upload uses fileName and submission checkpoints task before promptTips failure", async () => {
  const calls = [];
  const checkpoints = [];
  let uploadNumber = 0;
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/openapi/v2/media/upload/binary")) {
      assert.equal(init.body.has("file"), true);
      assert.equal(init.body.has("apiKey"), false);
      assert.equal(init.body.has("fileType"), false);
      return { ok: true, json: async () => ({ code: 0, data: { fileName: `openapi/file${++uploadNumber}` } }) };
    }
    assert.equal(url.endsWith("/openapi/v2/run/ai-app/2104148114306322433"), true);
    const body = JSON.parse(init.body);
    assert.equal(Object.hasOwn(body, "apiKey"), false);
    assert.equal(Object.hasOwn(body, "workflowId"), false);
    assert.equal(body.instanceType, "default");
    assert.equal(body.nodeInfoList.find((node) => node.nodeId === "27").fieldValue, "openapi/file4");
    return { ok: true, json: async () => ({ taskId: "paid-123", status: "RUNNING", promptTips: JSON.stringify({ result: false, node_errors: { "263": "bad" } }) }) };
  };
  const packageValue = provider.createRunningHubSixRefProvider({ baseUrl: "https://www.runninghub.cn", fetch, apiKey: "ref", instance: "test", pool: {} });
  const authored = {
    ports: { duration: [4], resolution: ["768P"], aspectRatio: ["9:16"], referenceImage: [1, 2, 3], referenceVideo: [1] },
    prompt: "same scene", seconds: 4, resolution: "768P", aspect_ratio: "9:16",
    images: [1, 2, 3].map((n) => ({ resource: `image${n}`, mediaType: "image/png" })),
    videos: [{ resource: "video", mediaType: "video/mp4" }],
  };
  const result = await packageValue.capabilities[0].endpoint.start({
    need: { constraints: authored }, credentials: { apiKey: { secret: "test-key" } },
    resources: { get: async () => new Uint8Array([1, 2, 3]) },
    checkpoint: async (value) => checkpoints.push(value),
  });
  assert.equal(calls.length, 5);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].receipt.id, "paid-123");
  assert.equal(result.status, "failed");
  assert.equal(result.receipt.id, "paid-123");
  assert.equal(result.failure.code, 'RUNNINGHUB_OUTCOME_UNKNOWN');
});

test("query selects only generated node 214 and collect downloads that video", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(url);
    if (url.endsWith('/openapi/v2/query')) return { ok: true, json: async () => ({ status: 'SUCCESS', results: [
      { nodeId: '384', outputType: 'mp4', url: 'https://cdn.example/comparison.mp4' },
      { nodeId: '388', outputType: 'zip', url: 'https://cdn.example/debug.zip' },
      { nodeId: '214', outputType: 'mp4', url: 'https://cdn.example/generated.mp4' },
    ] }) };
    assert.equal(url, 'https://cdn.example/generated.mp4');
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const endpoint = provider.createRunningHubSixRefProvider({ fetch, apiKey: 'ref', instance: 'test', pool: {} }).capabilities[0].endpoint;
  const handle = { contract: 'hypit.runninghub-sixref@1', taskId: 'paid-123', startedAt: Date.now() };
  const ready = await endpoint.poll({ handle, credentials: { apiKey: { secret: 'key' } } });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.handle.resultUrl, 'https://cdn.example/generated.mp4');
  const completed = await endpoint.collect({ handle: ready.handle, resources: { put: async () => 'saved-video' } });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(calls, ['https://www.runninghub.cn/openapi/v2/query', 'https://cdn.example/generated.mp4']);
});

test("query rejects missing or ambiguous generated node 214", async () => {
  for (const results of [
    [{ nodeId: '384', outputType: 'mp4', url: 'https://cdn.example/comparison.mp4' }],
    [{ nodeId: '214', outputType: 'mp4', url: 'https://cdn.example/a.mp4' }, { nodeId: '214', outputType: 'mp4', url: 'https://cdn.example/b.mp4' }],
  ]) {
    const endpoint = provider.createRunningHubSixRefProvider({ fetch: async () => ({ ok: true, json: async () => ({ status: 'SUCCESS', results }) }), apiKey: 'ref', instance: 'test', pool: {} }).capabilities[0].endpoint;
    const result = await endpoint.poll({ handle: { contract: 'hypit.runninghub-sixref@1', taskId: 'paid-123', startedAt: Date.now() }, credentials: { apiKey: { secret: 'key' } } });
    assert.equal(result.status, 'failed');
    assert.equal(result.receipt.id, 'paid-123');
  }
});

test("transient query failure retries original task without another submit", async () => {
  const paths = [];
  let count = 0;
  const fetch = async (url) => { paths.push(url); if (++count === 1) return { ok: false, status: 503, json: async () => ({}) }; return { ok: true, json: async () => ({ status: 'RUNNING' }) }; };
  const endpoint = provider.createRunningHubSixRefProvider({ fetch, apiKey: 'ref', instance: 'test', pool: {} }).capabilities[0].endpoint;
  const handle = { contract: 'hypit.runninghub-sixref@1', taskId: 'paid-123', startedAt: Date.now() };
  const retry = await endpoint.poll({ handle, credentials: { apiKey: { secret: 'key' } } });
  assert.equal(retry.status, 'waiting');
  assert.equal(retry.handle.taskId, 'paid-123');
  await endpoint.poll({ handle: retry.handle, credentials: { apiKey: { secret: 'key' } } });
  assert.deepEqual(paths, ['/openapi/v2/query', '/openapi/v2/query'].map((path) => `https://www.runninghub.cn${path}`));
});

test("missing durable checkpoint blocks paid submission", async () => {
  let calls = 0;
  const endpoint = provider.createRunningHubSixRefProvider({ fetch: async () => { calls++; throw new Error('unexpected network'); }, apiKey: 'ref', instance: 'test', pool: {} }).capabilities[0].endpoint;
  const result = await endpoint.start({ need: { constraints: { ports: { duration: [4], resolution: ['768P'], aspectRatio: ['9:16'], referenceImage: [1], referenceVideo: [1] } } }, credentials: { apiKey: { secret: 'key' } } });
  assert.equal(result.status, 'failed');
  assert.equal(calls, 0);
});

test("query failure does not expose server body or credential", async () => {
  const endpoint = provider.createRunningHubSixRefProvider({ fetch: async () => ({ ok: true, json: async () => ({ status: 'FAILED', errorMessage: 'Bearer super-secret apiKey=super-secret' }) }), apiKey: 'ref', instance: 'test', pool: {} }).capabilities[0].endpoint;
  const result = await endpoint.poll({ handle: { contract: 'hypit.runninghub-sixref@1', taskId: 'paid-123', startedAt: Date.now() }, credentials: { apiKey: { secret: 'super-secret' } } });
  assert.equal(result.status, 'failed');
  assert.equal(result.receipt.id, 'paid-123');
  assert.equal(result.failure.code, 'RUNNINGHUB_TERMINAL_FAILURE');
  assert.ok(!JSON.stringify(result).includes('super-secret'));
  assert.ok(result.failure.message.length <= 300);
});

test("query timeout and output ambiguity are unknown outcomes, not proven terminal failures", async () => {
  const credentials = { apiKey: { secret: 'secret' } };
  const handle = { contract: 'hypit.runninghub-sixref@1', taskId: 'paid-123', startedAt: Date.now() };
  const timeout = provider.createRunningHubSixRefProvider({ fetch: async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); }, apiKey: 'ref', instance: 'test', pool: {} }).capabilities[0].endpoint;
  let current = handle;
  for (let i = 0; i < 5; i++) current = (await timeout.poll({ handle: current, credentials })).handle;
  const exhausted = await timeout.poll({ handle: current, credentials });
  assert.equal(exhausted.status, 'failed');
  assert.equal(exhausted.failure.code, 'RUNNINGHUB_OUTCOME_UNKNOWN');
  const ambiguous = provider.createRunningHubSixRefProvider({ fetch: async () => ({ ok: true, json: async () => ({ status: 'SUCCESS', results: [{ nodeId: '384', outputType: 'mp4', url: 'https://cdn.example/comparison.mp4' }] }) }), apiKey: 'ref', instance: 'test', pool: {} }).capabilities[0].endpoint;
  const result = await ambiguous.poll({ handle, credentials });
  assert.equal(result.failure.code, 'RUNNINGHUB_OUTCOME_UNKNOWN');
});

test("HTTP error with an accepted taskId still checkpoints and returns its receipt", async () => {
  const checkpoints = [];
  let uploads = 0;
  const fetch = async (url) => url.endsWith('/openapi/v2/media/upload/binary')
    ? { ok: true, json: async () => ({ code: 0, data: { fileName: `upload-${++uploads}` } }) }
    : { ok: false, status: 502, json: async () => ({ taskId: 'paid-on-error', message: 'apiKey=secret' }) };
  const endpoint = provider.createRunningHubSixRefProvider({ fetch, apiKey: 'ref', instance: 'test', pool: {} }).capabilities[0].endpoint;
  const authored = { ports: { duration: [4], resolution: ['768P'], aspectRatio: ['9:16'], referenceImage: [1], referenceVideo: [1] },
    prompt: 'same scene', seconds: 4, resolution: '768P', aspect_ratio: '9:16',
    images: [{ resource: 'image', mediaType: 'image/png' }], videos: [{ resource: 'video', mediaType: 'video/mp4' }] };
  const result = await endpoint.start({ need: { constraints: authored }, credentials: { apiKey: { secret: 'secret' } },
    resources: { get: async () => new Uint8Array([1, 2, 3]) }, checkpoint: async value => checkpoints.push(value) });
  assert.equal(result.status, 'failed');
  assert.equal(result.receipt.id, 'paid-on-error');
  assert.equal(result.failure.code, 'RUNNINGHUB_OUTCOME_UNKNOWN');
  assert.equal(checkpoints[0].handle.taskId, 'paid-on-error');
  assert.ok(!JSON.stringify(result).includes('apiKey=secret'));
});

test("failed generated MP4 download remains an unknown outcome", async () => {
  const endpoint = provider.createRunningHubSixRefProvider({ fetch: async () => ({ ok: false, status: 503 }), apiKey: 'ref', instance: 'test', pool: {} }).capabilities[0].endpoint;
  const result = await endpoint.collect({ handle: { taskId: 'paid-123', resultUrl: 'https://cdn.example/generated.mp4' }, resources: { put: async () => 'unused' } });
  assert.equal(result.status, 'failed');
  assert.equal(result.receipt.id, 'paid-123');
  assert.equal(result.failure.code, 'RUNNINGHUB_OUTCOME_UNKNOWN');
});

