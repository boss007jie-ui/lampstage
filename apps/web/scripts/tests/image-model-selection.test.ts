import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  APP_MAX_IMAGE_REFERENCES, DEFAULT_IMAGE_MODEL, IMAGE_MODELS, getImageModel, isImageModelId,
  recordedImageModel, validateImageSelection, type ImageModelId,
} from "../../lib/image-models";
import { extractGeminiImage } from "../../lib/providers/gemini-response";
import { readImageReferences, resolveImageBytes } from "../../lib/providers/image-io";
import {
  buildImage25Request, buildNano21Request, extractOpenAiImage,
  IMAGE_25_ENDPOINT, NANO_21_ENDPOINT, type ImageReference,
} from "../../lib/providers/image-requests";
import { createOpenLuxImageProvider } from "../../lib/providers/openlux-images";
import type { GenInput } from "../../lib/providers/types";
import type { ToolLogInput } from "../../lib/tool-log";

const room: ImageReference = { bytes: Buffer.from("room"), mime: "image/png" };
const product: ImageReference = { bytes: Buffer.from("product"), mime: "image/jpeg" };
const input: GenInput = {
  prompt: "Place this lamp in the room", referenceImageUrl: "https://invalid.example/product",
  aspectRatio: "1_1", platformStyle: "brand_site", outputCount: 1, jobId: "job-test",
};

test("public names, IDs, default, validation, and historical metadata are exact", () => {
  assert.equal(NANO_21_ENDPOINT, "https://api.openlux.ai/v1beta/models/gemini-nano-banana-2.1:generateContent");
  assert.equal(IMAGE_25_ENDPOINT, "https://api.openlux.ai/v1/images/edits");
  assert.deepEqual(IMAGE_MODELS, [
    { id: "nano_banana_21", name: "nano banana 2.1", apiModel: "gemini-nano-banana-2.1", maxReferences: 6 },
    { id: "image_25", name: "image 2.5", apiModel: "gpt-image-2-c", maxReferences: 6 },
  ]);
  assert.equal(APP_MAX_IMAGE_REFERENCES, 6);
  assert.equal(DEFAULT_IMAGE_MODEL, "nano_banana_21");
  assert.equal(getImageModel("image_25").apiModel, "gpt-image-2-c");
  assert.equal(isImageModelId("gpt-image-2-c"), false);
  assert.deepEqual(validateImageSelection(undefined, "1_1"), { ok: true, imageModel: "nano_banana_21" });
  assert.deepEqual(validateImageSelection("image_25", "1_1"), { ok: true, imageModel: "image_25" });
  for (const value of [null, "", "gpt-image-2-c", "old-model", 3]) {
    assert.deepEqual(validateImageSelection(value, "1_1"), { ok: false, reason: "bad_image_model" });
  }
  for (const aspect of ["4_5", "16_9", "9_16", undefined]) {
    assert.deepEqual(validateImageSelection("nano_banana_21", aspect), { ok: false, reason: "unsupported_model_aspect" });
  }
  for (const metadata of [null, undefined, {}, [], { provider_model: "gemini-nano-banana-2.1" }, { image_model: "old-model" }]) {
    assert.equal(recordedImageModel(metadata), null);
  }
  assert.equal(recordedImageModel({ image_model: "nano_banana_21", provider_model: "gemini-nano-banana-2.1" }), "nano_banana_21");
  assert.equal(recordedImageModel({ image_model: "image_25", provider_model: "gpt-image-2-c" }), "image_25");
});

test("Nano native JSON keeps prompt and two references in supplied order with only verified fields", () => {
  const request = buildNano21Request(input.prompt, [room, product]);
  assert.deepEqual(request, {
    contents: [{ role: "user", parts: [
      { text: input.prompt },
      { inlineData: { mimeType: "image/png", data: room.bytes.toString("base64") } },
      { inlineData: { mimeType: "image/jpeg", data: product.bytes.toString("base64") } },
    ] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  });
  assert.equal(JSON.stringify(request).includes("imageConfig"), false);
  assert.equal(JSON.stringify(request).includes("response_format"), false);
  assert.equal(JSON.stringify(request).includes("gemini-3-pro-image"), false);
  assert.throws(() => buildNano21Request("x", []), /reference/);
  assert.throws(() => buildNano21Request("x", Array(7).fill(room)), /reference/);
});

test("GPT single-image multipart retains its existing image field", async () => {
  const form = buildImage25Request(input.prompt, [product]);
  assert.deepEqual([...form.keys()], ["model", "prompt", "image"]);
  assert.equal(form.get("model"), "gpt-image-2-c");
  assert.equal(form.get("prompt"), input.prompt);
  const image = form.get("image");
  assert.ok(image instanceof File);
  assert.equal(image.name, "product.jpg");
  assert.equal(image.type, "image/jpeg");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), product.bytes);
  for (const forbidden of ["n", "quality", "size", "moderation", "response_format"]) assert.equal(form.has(forbidden), false);
  assert.throws(() => buildImage25Request("x", Array(7).fill(room)), /reference/);
});

test("four distinct references retain order and bytes on both provider request wires", async () => {
  const refs: ImageReference[] = [
    { bytes: Buffer.from("mother"), mime: "image/png" },
    { bytes: Buffer.from("baby"), mime: "image/jpeg" },
    { bytes: Buffer.from("product"), mime: "image/webp" },
    { bytes: Buffer.from("scene"), mime: "image/png" },
  ];
  const nano = buildNano21Request("four roles", refs);
  assert.deepEqual(nano.contents[0].parts, [
    { text: "four roles" },
    ...refs.map(ref => ({ inlineData: { mimeType: ref.mime, data: ref.bytes.toString("base64") } })),
  ]);
  const gpt = buildImage25Request("four roles", refs);
  assert.deepEqual([...gpt.keys()], ["model", "prompt", "image[]", "image[]", "image[]", "image[]"]);
  assert.equal(gpt.get("model"), "gpt-image-2-c");
  assert.equal(gpt.get("prompt"), "four roles");
  const files = gpt.getAll("image[]");
  assert.deepEqual(files.map(file => file instanceof File ? file.name : null),
    ["reference-01.png", "reference-02.jpg", "reference-03.webp", "reference-04.png"]);
  for (const [index, file] of files.entries()) {
    assert.ok(file instanceof File);
    assert.equal(file.type, refs[index].mime);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), refs[index].bytes);
  }
  assert.equal(gpt.has("image"), false);
  for (const forbidden of ["n", "quality", "size", "moderation", "response_format"]) assert.equal(gpt.has(forbidden), false);
});

test("response extractors skip thoughts and accept inline, URL, data URI shapes", () => {
  const dataUri = "data:image/png;base64,QUJD";
  assert.deepEqual(extractGeminiImage({ candidates: [{ content: { parts: [
    { thought: true, inlineData: { data: "wrong" } }, { text: "ok" },
    { inlineData: { mimeType: "image/png", data: "QUJD" } },
  ] } }] }), { mime: "image/png", b64: "QUJD" });
  assert.deepEqual(extractGeminiImage({ candidates: [{ content: { parts: [
    { file_data: { file_uri: dataUri, mime_type: "image/png" } },
  ] } }] }), { mime: "image/png", url: dataUri });
  assert.deepEqual(extractOpenAiImage({ data: [{ revised_prompt: "text" }, { b64_json: "QUJD" }] }), { b64: "QUJD" });
  assert.deepEqual(extractOpenAiImage({ data: [{ url: dataUri }] }), { url: dataUri });
  assert.deepEqual(extractOpenAiImage({ data: [{ url: "https://invalid.example/image.png" }] }), { url: "https://invalid.example/image.png" });
  assert.equal(extractOpenAiImage({ data: [{ revised_prompt: "only text" }] }), null);
  assert.equal(extractGeminiImage({ candidates: [{ content: { parts: [{ thought: true, inlineData: { data: "QUJD" } }] } }] }), null);
});

function harness(id: ImageModelId, response: { status: number; payload?: unknown }, resolveFailure = false) {
  const fetchCalls: Array<{ url: unknown; init: RequestInit | undefined }> = [];
  const readCalls: number[] = [];
  const resolveCalls: unknown[] = [];
  const logs: ToolLogInput[] = [];
  const references = id === "nano_banana_21" ? [room, product] : [product];
  const provider = createOpenLuxImageProvider(id, {
    apiKey: () => "local-test-key",
    readReferences: async (_input, max) => { readCalls.push(max); return references; },
    fetch: (async (url: unknown, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return { ok: response.status >= 200 && response.status < 300, status: response.status,
        json: async () => response.payload ?? { secret: "signed-provider-body" } } as Response;
    }) as typeof fetch,
    resolveImage: async (image) => {
      resolveCalls.push(image);
      if (resolveFailure) throw new Error("signed image download failed https://secret.invalid/token");
      return { bytes: Buffer.from("decoded"), mime: "image/png" };
    },
    log: async entry => { logs.push(entry); },
  });
  return { provider, fetchCalls, readCalls, resolveCalls, logs };
}

test("both explicit models use their exact endpoint and body, regardless of legacy provider setting", async () => {
  const previous = process.env.IMAGE_PROVIDER;
  process.env.IMAGE_PROVIDER = "some-old-provider";
  try {
    const cases = [
      { id: "nano_banana_21" as const, endpoint: NANO_21_ENDPOINT,
        payload: { candidates: [{ content: { parts: [{ inlineData: { data: "QUJD", mimeType: "image/png" } }] } }] },
        image: { mime: "image/png", b64: "QUJD" }, tool: "nano-banana", apiModel: "gemini-nano-banana-2.1" },
      { id: "image_25" as const, endpoint: IMAGE_25_ENDPOINT,
        payload: { data: [{ b64_json: "QUJD" }] }, image: { b64: "QUJD" },
        tool: "gpt-image-2", apiModel: "gpt-image-2-c" },
    ];
    for (const item of cases) {
      const h = harness(item.id, { status: 200, payload: item.payload });
      assert.equal(h.provider.name, getImageModel(item.id).name);
      assert.deepEqual(await h.provider.generate(input), { ok: true, bytes: Buffer.from("decoded"), mime: "image/png",
        attempt: { status: "response_received", http_status: 200 } });
      assert.equal(h.fetchCalls.length, 1);
      assert.equal(h.fetchCalls[0].url, item.endpoint);
      assert.deepEqual(h.readCalls, [getImageModel(item.id).maxReferences]);
      assert.deepEqual(h.resolveCalls, [item.image]);
      const init = h.fetchCalls[0].init!;
      assert.equal(init.method, "POST");
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer local-test-key");
      if (item.id === "nano_banana_21") {
        assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/json");
        assert.deepEqual(JSON.parse(init.body as string), buildNano21Request(input.prompt, [room, product]));
      } else {
        assert.equal((init.headers as Record<string, string>)["Content-Type"], undefined);
        assert.ok(init.body instanceof FormData);
        assert.deepEqual([...init.body.keys()], ["model", "prompt", "image"]);
        assert.equal(init.body.get("model"), "gpt-image-2-c");
        assert.equal(init.body.get("prompt"), input.prompt);
        const attached = init.body.get("image");
        assert.ok(attached instanceof File);
        assert.deepEqual(Buffer.from(await attached.arrayBuffer()), product.bytes);
      }
      assert.equal(h.logs.length, 1);
      assert.equal(h.logs[0].status, "ok");
      assert.equal(h.logs[0].tool, item.tool);
      assert.equal(h.logs[0].model, item.apiModel);
      assert.equal(h.logs[0].httpStatus, 200);
      assert.equal(h.logs[0].jobId, input.jobId);
    }
  } finally {
    if (previous === undefined) delete process.env.IMAGE_PROVIDER;
    else process.env.IMAGE_PROVIDER = previous;
  }
});

test("401, 500, no image, and decode failure stop after one request without false success or secret leakage", async () => {
  const cases = [
    { status: 401, payload: { error: "signed-provider-body secret-key" } },
    { status: 500, payload: { error: "signed-provider-body secret-key" } },
    { status: 200, payload: {} },
    { status: 200, payload: { candidates: [{ content: { parts: [{ inlineData: { data: "QUJD" } }] } }], data: [{ b64_json: "QUJD" }] }, decode: true },
  ];
  for (const id of ["nano_banana_21", "image_25"] as const) {
    for (const item of cases) {
      const h = harness(id, item, item.decode);
      const result = await h.provider.generate(input);
      assert.equal(result.ok, false, `${id} / ${item.status}`);
      assert.match(result.error!, /image generation did not complete/);
      assert.equal(result.error!.includes("secret"), false);
      assert.equal(result.error!.includes("token"), false);
      if (item.status >= 400) assert.match(result.error!, new RegExp(`HTTP ${item.status}`));
      assert.equal(h.fetchCalls.length, 1);
      assert.equal(h.logs.length, 1);
      assert.equal(h.logs[0].status, "failed");
      assert.equal(h.logs[0].error, result.error);
      assert.equal(h.logs[0].httpStatus, item.status);
      assert.equal(h.resolveCalls.length, item.decode ? 1 : 0);
    }
  }
});

test("image resolver reports bytes' real MIME and rejects nonimages and corrupt images", async () => {
  for (const [format, mime] of [["png", "image/png"], ["jpeg", "image/jpeg"], ["webp", "image/webp"]] as const) {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).toFormat(format).toBuffer();
    const resolved = await resolveImageBytes({ b64: bytes.toString("base64") });
    assert.equal(resolved.mime, mime);
    assert.deepEqual(resolved.bytes, bytes);
    const disguised = await resolveImageBytes({ url: `data:image/png;base64,${bytes.toString("base64")}` });
    assert.equal(disguised.mime, mime);
  }
  await assert.rejects(resolveImageBytes({ b64: Buffer.from("plain text").toString("base64") }));
  await assert.rejects(resolveImageBytes({ b64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]).toString("base64") }));
  await assert.rejects(resolveImageBytes({ url: "data:text/plain;base64,QUJD" }), /Invalid image data/);
});

test("bundled room references stay local when customer object storage uses R2", async () => {
  const keys = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT", "R2_PUBLIC_BASE"];
  const saved = keys.map(key => [key, process.env[key]] as const);
  try {
    // Nonempty R2 settings enable the branch, but the invalid endpoint cannot contact any service.
    for (const key of keys) process.env[key] = "offline-invalid-endpoint";
    const productBytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: "blue" } }).png().toBuffer();
    const references = await readImageReferences({ ...input, referenceImageUrl: "",
      referenceImageData: { bytes: productBytes, mime: "image/png" },
      compositionReferenceUrl: "/scene-refs-v2/_blank_canvas.png",
    }, 2);
    assert.equal(references.length, 2);
    assert.equal(references[0].mime, "image/png");
    assert.equal((await sharp(references[1].bytes).metadata()).width, 4);
    await assert.rejects(readImageReferences({ ...input, referenceImageData: { bytes: productBytes, mime: "image/png" },
      compositionReferenceUrl: "/scene-refs-v2/../../../../outside.png",
    }, 2), /Invalid static reference path/);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("explicit pinned references are preprocessed in order without reading legacy URLs", async () => {
  const colors = ["red", "green", "blue", "yellow"];
  const pinned = await Promise.all(colors.map(async color => ({
    bytes: await sharp({ create: { width: 3, height: 2, channels: 3, background: color } }).jpeg().toBuffer(),
    mime: "image/jpeg",
  })));
  const explicit: GenInput = { ...input, referenceImageUrl: "https://invalid.example/legacy-url-must-not-be-read", referenceImages: pinned };
  const prepared = await readImageReferences(explicit, 6);
  assert.equal(prepared.length, 4);
  assert.deepEqual(prepared.map(ref => ref.mime), Array(4).fill("image/png"));
  for (const [index, ref] of prepared.entries()) {
    const expected = await sharp(pinned[index].bytes).rotate().resize(1536, 1536,
      { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    assert.deepEqual(ref.bytes, expected);
  }
  await assert.rejects(readImageReferences({ ...explicit, referenceImages: [] }, 6), /reference image count/);
  await assert.rejects(readImageReferences({ ...explicit, referenceImages: Array(7).fill(pinned[0]) }, 6), /reference image count/);
  await assert.rejects(readImageReferences(explicit, 3), /reference image count/);
  await assert.rejects(readImageReferences({ ...explicit, compositionReferenceUrl: "" }, 6), /legacy reference data or composition/);
  await assert.rejects(readImageReferences({ ...explicit, compositionReferenceData: pinned[0] }, 6), /legacy reference data or composition/);
  await assert.rejects(readImageReferences({ ...explicit, referenceImageData: pinned[0] }, 6), /legacy reference data or composition/);
  await assert.rejects(readImageReferences({ ...explicit, referenceImages: [{ bytes: Buffer.from("bad"), mime: "image/png" }] }, 6));
});
