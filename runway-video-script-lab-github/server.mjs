import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const rootDir = resolve(new URL(".", import.meta.url).pathname);
const uploadDir = join(rootDir, "tmp", "uploads");

loadDotEnv();

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const transcribeModel = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const analysisModel = process.env.OPENAI_ANALYSIS_MODEL || "gpt-4.1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        ffmpeg: await hasFfmpeg(),
        openaiKey: Boolean(process.env.OPENAI_API_KEY),
        acceptsBrowserKey: true,
        model: transcribeModel,
        analysisModel,
      });
    }

    if (req.method === "POST" && req.url === "/api/transcribe") {
      await handleTranscribe(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/analyze") {
      await handleAnalyze(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/analyze-video") {
      await handleAnalyzeVideo(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/sync-translation") {
      await handleSyncTranslation(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/revise-rewrite") {
      await handleReviseRewrite(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/update-rewrite-prompt") {
      await handleUpdateRewritePrompt(req, res);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(req, res);
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Video Script Lab running at http://${host}:${port}`);
});

async function handleTranscribe(req, res) {
  const apiKey = getOpenAiApiKey(req);

  if (!apiKey) {
    return sendJson(res, 401, {
      error: "缺少 OpenAI API Key。请在页面输入 Key，或在 .env 文件里填写 OPENAI_API_KEY。",
    });
  }

  if (!(await hasFfmpeg())) {
    return sendJson(res, 500, {
      error: "没有找到 ffmpeg，无法从视频中抽取音频。",
    });
  }

  const form = await readMultipartForm(req);
  const video = form.get("video");
  const language = String(form.get("language") || "zh");
  const prompt = String(
    form.get("prompt") ||
      "这是一段中文短视频带货或产品介绍口播，请尽量保留原话、语气词和分段节奏。"
  );

  if (!video || typeof video.arrayBuffer !== "function") {
    return sendJson(res, 400, { error: "没有收到视频文件。" });
  }

  await mkdir(uploadDir, { recursive: true });
  const jobId = randomUUID();
  const safeName = sanitizeFileName(video.name || "video.mp4");
  const videoPath = join(uploadDir, `${jobId}-${safeName}`);
  const audioPath = join(uploadDir, `${jobId}.mp3`);

  try {
    await writeFile(videoPath, Buffer.from(await video.arrayBuffer()));
    await extractAudio(videoPath, audioPath);
    const transcript = await transcribeAudio(audioPath, { apiKey, language, prompt });

    sendJson(res, 200, {
      text: transcript.text,
      model: transcribeModel,
      sourceFile: video.name || safeName,
    });
  } finally {
    await rm(videoPath, { force: true }).catch(() => {});
    await rm(audioPath, { force: true }).catch(() => {});
  }
}

async function handleAnalyze(req, res) {
  const apiKey = getOpenAiApiKey(req);
  if (!apiKey) {
    return sendJson(res, 401, {
      error: "缺少 OpenAI API Key。请在页面输入 Key。",
    });
  }

  const body = await readJsonBody(req);
  const transcript = String(body.transcript || "").trim();

  if (transcript.length < 12) {
    return sendJson(res, 422, {
      error: "识别文本太短，无法做真实拆解。请检查视频音频，或手动补充字幕/口播文本。",
    });
  }

  const payload = await createRunwayAnalysis(apiKey, body);
  sendJson(res, 200, payload);
}

async function handleAnalyzeVideo(req, res) {
  const apiKey = getOpenAiApiKey(req);
  if (!apiKey) {
    return sendJson(res, 401, {
      error: "缺少 OpenAI API Key。请在页面输入 Key。",
    });
  }

  if (!(await hasFfmpeg())) {
    return sendJson(res, 500, {
      error: "没有找到 ffmpeg，无法抽取视频画面。",
    });
  }

  const form = await readMultipartForm(req);
  const video = form.get("video");
  if (!video || typeof video.arrayBuffer !== "function") {
    return sendJson(res, 400, { error: "没有收到视频文件。" });
  }

  await mkdir(uploadDir, { recursive: true });
  const jobId = randomUUID();
  const safeName = sanitizeFileName(video.name || "video.mp4");
  const videoPath = join(uploadDir, `${jobId}-${safeName}`);
  const frameDir = join(uploadDir, `${jobId}-frames`);

  try {
    await mkdir(frameDir, { recursive: true });
    await writeFile(videoPath, Buffer.from(await video.arrayBuffer()));
    const frames = await extractVideoFrames(videoPath, frameDir);

    if (!frames.length) {
      return sendJson(res, 422, { error: "没有抽取到可分析的视频画面。" });
    }

    const frameImages = await Promise.all(
      frames.map(async (framePath) => ({
        dataUrl: `data:image/jpeg;base64,${(await readFile(framePath)).toString("base64")}`,
        name: basename(framePath),
      }))
    );

    const payload = await createRunwayAnalysis(apiKey, {
      transcript: String(form.get("transcript") || ""),
      category: String(form.get("category") || "产品"),
      tone: String(form.get("tone") || "种草"),
      productName: String(form.get("productName") || "新产品"),
      imageName: String(form.get("imageName") || ""),
      rewriteRequirements: String(form.get("rewriteRequirements") || ""),
      needsRewrite: String(form.get("needsRewrite") || "false") === "true",
      visualMode: true,
      frameCount: frameImages.length,
      frameImages,
      sourceFile: video.name || safeName,
    });

    sendJson(res, 200, payload);
  } finally {
    await rm(videoPath, { force: true }).catch(() => {});
    await rm(frameDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function handleSyncTranslation(req, res) {
  const apiKey = getOpenAiApiKey(req);
  if (!apiKey) {
    return sendJson(res, 401, {
      error: "缺少 OpenAI API Key。请在页面输入 Key。",
    });
  }

  const body = await readJsonBody(req);
  const chinese = String(body.chinese || "").trim();
  if (!chinese) {
    return sendJson(res, 422, { error: "没有可同步的中文内容。" });
  }

  const section = String(body.section || "content");
  const prompt = `Translate and adapt the following Chinese ${section} into precise English for Runway video generation.

Rules:
- Preserve structure, scene numbers, shot language, and product details.
- For Runway prompts, keep it strictly visual: no spoken dialogue, no subtitles, no on-screen text unless explicitly part of packaging.
- Use natural, production-ready English, not literal translation.
- Return only the English text.

Chinese:
${chinese}`;

  const text = await callOpenAIText(apiKey, {
    model: analysisModel,
    input: [
      {
        role: "system",
        content: "You are a bilingual commercial video director and Runway prompt specialist.",
      },
      { role: "user", content: prompt },
    ],
  });

  sendJson(res, 200, { text });
}

async function handleReviseRewrite(req, res) {
  const apiKey = getOpenAiApiKey(req);
  if (!apiKey) {
    return sendJson(res, 401, {
      error: "缺少 OpenAI API Key。请在页面输入 Key。",
    });
  }

  const body = await readJsonBody(req);
  const revisionInstruction = String(body.revisionInstruction || "").trim();
  if (!revisionInstruction) {
    return sendJson(res, 422, { error: "请填写需要 AI 修改的要求。" });
  }

  const payload = await createRewriteRevision(apiKey, body);
  sendJson(res, 200, payload);
}

async function handleUpdateRewritePrompt(req, res) {
  const apiKey = getOpenAiApiKey(req);
  if (!apiKey) {
    return sendJson(res, 401, {
      error: "缺少 OpenAI API Key。请在页面输入 Key。",
    });
  }

  const body = await readJsonBody(req);
  const rewriteScript = normalizeBilingual(body.rewriteScript, "");
  if (!rewriteScript.zh && !rewriteScript.en) {
    return sendJson(res, 422, { error: "当前仿写脚本为空，无法更新提示词。" });
  }

  const payload = await createRewritePromptFromScript(apiKey, body);
  sendJson(res, 200, payload);
}

async function createRunwayAnalysis(apiKey, body) {
  const needsRewrite = Boolean(body.needsRewrite);
  const transcript = String(body.transcript || "").trim();
  const productName = String(body.productName || "新产品").trim();
  const category = String(body.category || "产品").trim();
  const tone = String(body.tone || "种草").trim();
  const imageName = String(body.imageName || "").trim();
  const rewriteRequirements = String(body.rewriteRequirements || "").trim();
  const visualMode = Boolean(body.visualMode);
  const frameCount = Number(body.frameCount || 0);

  const userPrompt = `你是一个短视频脚本拆解专家、中文广告导演、Runway 视频运动提示词专家。

请基于视频画面${transcript ? "和识别到的口播/字幕" : ""}做真正拆解，而不是套模板。输出必须是 JSON，字段和结构严格按要求。

产品品类：${category}
目标风格：${tone}
新产品名称：${productName}
产品图片文件名：${imageName || "未提供"}
是否需要仿写：${needsRewrite ? "是" : "否"}
仿写要求（只允许影响 rewriteScript 和 rewritePrompt，绝对不能影响 originalScript 和 originalPrompt）：${rewriteRequirements || "无额外要求。若需要仿写，请尽量 1:1 复刻原视频结构、镜头节奏、展示逻辑和 Runway 提示词，只替换为新产品。"}
分析模式：${visualMode ? `视频画面抽帧分析，已提供 ${frameCount} 张按时间顺序抽取的画面` : "文本分析"}

识别文本：
${transcript || "无口播/未识别到可用口播。请重点分析视频画面、镜头、动作、物体、场景、构图、节奏和展示逻辑。"}

重要要求：
1. originalScript 和 originalPrompt 是原视频分析结果，必须只基于原视频画面、口播/字幕和产品，不得受“新产品名称、产品图片、仿写要求”影响。
2. 优先分析整个视频，而不是只分析口播。若无口播，要明确这是“纯画面/纯展示/剧情视频”，并基于画面完成拆解。
3. 原视频脚本不是简单复述，要做详细“时间轴拉片”：按时间段/画面内容/主体动作/文案或口播/声音节奏/核心作用/是否有效/可复刻点拆解。至少输出 5 个镜头节点；如果视频短，也要按可观察动作拆细。
4. originalScript 必须补充“爆款原因”：为什么停留、为什么看完、为什么相信、为什么点击、最可能爆点、最可能转化点、最难复刻、可复刻优先级。
5. originalPrompt 不是“让 AI 分析视频的任务提示词”。它必须是“原视频反推 Runway 生成提示词”：把原视频拆成 Scene 1/2/3...，每个 Scene 都能直接投喂 Runway 来复刻原视频画面运动。至少输出 5 个 Scene；每个 Scene 写清主体、动作、场景、构图、景别、镜头移动、光线、材质、节奏、转场和负面约束。
6. Runway 提示词必须是视觉和运动描述，英文版必须可直接复制给 Runway；不要包含对白、旁白、字幕、屏幕文字；不要写“请分析/请拆解/请生成/请模仿”这类元指令。
7. 每个 Runway scene 控制在 3300 字符以内，优先写镜头、主体动作、场景、光线、材质、运动、构图、景别、镜头移动、物理约束、负面约束。
8. 中英文要语义对应。中文用于编辑，英文用于 Runway。
9. 仿写要保留原视频的结构和节奏，但替换成新产品，不要照抄。若“仿写要求”为空，要尽量 1:1 复刻原视频；若有要求，必须结合要求调整。仿写要求只影响 rewriteScript 和 rewritePrompt。
10. 如果只提供了文本没有画面，要说明画面缺失；如果提供了抽帧画面，则必须描述你从画面中看到的具体主体、动作、场景和镜头变化。

返回 JSON schema：
{
  "quality": { "zh": "...", "en": "..." },
  "originalScript": { "zh": "...", "en": "..." },
  "originalPrompt": { "zh": "...", "en": "..." },
  "rewriteScript": { "zh": "...", "en": "..." },
  "rewritePrompt": { "zh": "...", "en": "..." }
}

字段说明：
- quality：识别质量判断和缺失信息提醒。
- originalScript：原视频脚本真实拆解，必须详细。包含时间轴拉片、逐镜头画面、主体动作、声音/字幕、核心作用、爆款原因、有效性判断和可复刻点。不受仿写要求影响。
- originalPrompt：原视频反推 Runway 提示词，必须详细。不受仿写要求影响。必须按 Scene 1/2/3... 输出，逐镜头描述原视频画面、主体、动作、场景、构图、光线、材质、镜头运动、节奏、转场和约束。英文必须是可直接复制到 Runway 的视觉运动提示词；中文是对应解释版。禁止输出“请分析一个视频”这类分析任务提示词。
- rewriteScript：若需要仿写，输出新产品脚本拆解；不需要则写“本次未选择脚本仿写”。
- rewritePrompt：若需要仿写，输出 Runway 视频运动提示词，按 Scene 1/2/3...；每个 Scene 必须英文严格视觉版，并可在中文中解释意图；不需要则写“本次未选择仿写脚本提示词”。`;

  const content = [{ type: "text", text: userPrompt }];
  for (const frame of body.frameImages || []) {
    content.push({
      type: "image_url",
      image_url: { url: frame.dataUrl, detail: "low" },
    });
  }

  const text = await callOpenAIText(apiKey, {
    model: analysisModel,
    input: [
      {
        role: "system",
        content:
          "You produce rigorous bilingual JSON for video script analysis and Runway visual motion prompts. Return valid JSON only.",
      },
      { role: "user", content },
    ],
    text: {
      format: {
        type: "json_object",
      },
    },
  });

  return normalizeAnalysisJson(text, needsRewrite);
}

async function createRewriteRevision(apiKey, body) {
  const revisionInstruction = String(body.revisionInstruction || "").trim();
  const rewriteRequirements = String(body.rewriteRequirements || "").trim();
  const productName = String(body.productName || "新产品").trim();
  const category = String(body.category || "产品").trim();
  const tone = String(body.tone || "种草").trim();
  const originalScript = normalizeBilingual(body.originalScript, "");
  const originalPrompt = normalizeBilingual(body.originalPrompt, "");
  const currentRewriteScript = normalizeBilingual(body.currentRewriteScript, "");
  const currentRewritePrompt = normalizeBilingual(body.currentRewritePrompt, "");

  const prompt = `你是短视频仿写导演和 Runway 提示词专家。请根据用户的局部修改要求，二次修改“仿写脚本”和“仿写脚本提示词”。

核心原则：
1. 当前仿写脚本可能已经被用户手动修改过，除非用户明确要求改动，否则必须尽量保留。
2. 只围绕用户提出的不满意之处做局部修改，不要重置整篇。
3. 修改后的 rewritePrompt 必须跟随 rewriteScript 的变化同步更新。
4. Runway 提示词必须是严格视觉和运动描述，不要包含对白、旁白、字幕、屏幕文字，不要写“请生成/请分析”。
5. 中英文语义对应，英文必须可直接复制给 Runway。

产品品类：${category}
目标风格：${tone}
新产品名称：${productName}
生成前仿写要求：${rewriteRequirements || "无额外要求；尽量 1:1 复刻原视频结构和镜头节奏。"}

用户这次的修改要求：
${revisionInstruction}

原视频脚本拆解（参考原结构）：
中文：
${originalScript.zh}

English:
${originalScript.en}

原视频 Runway 反推提示词（参考原镜头运动）：
中文：
${originalPrompt.zh}

English:
${originalPrompt.en}

当前仿写脚本（必须在此基础上局部修改，保留手动修改部分）：
中文：
${currentRewriteScript.zh}

English:
${currentRewriteScript.en}

当前仿写 Runway 提示词：
中文：
${currentRewritePrompt.zh}

English:
${currentRewritePrompt.en}

返回 JSON：
{
  "rewriteScript": { "zh": "...", "en": "..." },
  "rewritePrompt": { "zh": "...", "en": "..." }
}`;

  const text = await callOpenAIText(apiKey, {
    model: analysisModel,
    input: [
      {
        role: "system",
        content:
          "You revise rewritten commercial video scripts and Runway prompts while preserving user edits. Return valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    text: { format: { type: "json_object" } },
  });

  const parsed = parseJsonText(text);
  return {
    rewriteScript: normalizeBilingual(parsed.rewriteScript, currentRewriteScript.zh || "模型没有返回仿写脚本。"),
    rewritePrompt: normalizeBilingual(parsed.rewritePrompt, currentRewritePrompt.zh || "模型没有返回仿写提示词。"),
  };
}

async function createRewritePromptFromScript(apiKey, body) {
  const rewriteRequirements = String(body.rewriteRequirements || "").trim();
  const productName = String(body.productName || "新产品").trim();
  const category = String(body.category || "产品").trim();
  const tone = String(body.tone || "种草").trim();
  const originalPrompt = normalizeBilingual(body.originalPrompt, "");
  const rewriteScript = normalizeBilingual(body.rewriteScript, "");
  const currentRewritePrompt = normalizeBilingual(body.currentRewritePrompt, "");

  const prompt = `请根据用户当前手动修改后的仿写脚本，重新生成对应的 Runway 视频运动提示词。

要求：
1. 不修改仿写脚本，只更新 rewritePrompt。
2. rewritePrompt 必须严格跟随当前 rewriteScript 的每个场景、动作、情绪、卖点和节奏。
3. 参考原视频 Runway 反推提示词的镜头结构和运动逻辑。
4. 若仿写要求为空，尽量 1:1 保持原视频镜头节奏；若有要求，提示词必须体现要求。
5. 英文必须可直接复制给 Runway。不要包含对白、旁白、字幕、屏幕文字，不要写“请生成/请分析”。

产品品类：${category}
目标风格：${tone}
新产品名称：${productName}
生成前仿写要求：${rewriteRequirements || "无额外要求；尽量 1:1 复刻原视频结构和镜头节奏。"}

原视频 Runway 反推提示词：
中文：
${originalPrompt.zh}

English:
${originalPrompt.en}

当前仿写脚本：
中文：
${rewriteScript.zh}

English:
${rewriteScript.en}

当前仿写提示词（仅作为旧版本参考，可改写）：
中文：
${currentRewritePrompt.zh}

English:
${currentRewritePrompt.en}

返回 JSON：
{
  "rewritePrompt": { "zh": "...", "en": "..." }
}`;

  const text = await callOpenAIText(apiKey, {
    model: analysisModel,
    input: [
      {
        role: "system",
        content:
          "You update Runway visual motion prompts to match a revised script. Return valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    text: { format: { type: "json_object" } },
  });

  const parsed = parseJsonText(text);
  return {
    rewritePrompt: normalizeBilingual(parsed.rewritePrompt, currentRewritePrompt.zh || "模型没有返回仿写提示词。"),
  };
}

async function readMultipartForm(req) {
  const request = new Request(`http://127.0.0.1${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req,
    duplex: "half",
  });

  return request.formData();
}

async function transcribeAudio(audioPath, { apiKey, language, prompt }) {
  const form = new FormData();
  const audioBuffer = await readFile(audioPath);
  form.append("file", new File([audioBuffer], basename(audioPath), { type: "audio/mpeg" }));
  form.append("model", transcribeModel);
  form.append("response_format", "json");
  form.append("language", language);
  form.append("prompt", prompt);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  const raw = await response.text();
  if (!response.ok) {
    let detail = raw;
    try {
      detail = JSON.parse(raw).error?.message || raw;
    } catch {}
    throw new Error(`语音识别失败：${detail}`);
  }

  const data = JSON.parse(raw);
  return { text: data.text || "" };
}

function getOpenAiApiKey(req) {
  const headerKey = req.headers["x-openai-api-key"];
  const providedKey = Array.isArray(headerKey) ? headerKey[0] : headerKey;
  return String(providedKey || process.env.OPENAI_API_KEY || "").trim();
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("请求内容不是有效 JSON。");
  }
}

async function callOpenAIText(apiKey, payload) {
  const messages = payload.input.map((item) => ({
    role: item.role,
    content: item.content,
  }));

  const body = {
    model: payload.model || analysisModel,
    messages,
    temperature: 0.45,
  };

  if (payload.text?.format?.type === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  if (!response.ok) {
    let detail = raw;
    try {
      detail = JSON.parse(raw).error?.message || raw;
    } catch {}
    throw new Error(`AI 拆解失败：${detail}`);
  }

  const data = JSON.parse(raw);
  return data.choices?.[0]?.message?.content?.trim() || "";
}

function normalizeAnalysisJson(text, needsRewrite) {
  const parsed = parseJsonText(text);
  const fallback = "模型没有返回有效内容，请重新生成。";
  const disabled = "本次未选择脚本仿写。";
  const originalScript = normalizeBilingual(parsed.originalScript, fallback);
  let originalPrompt = normalizeBilingual(parsed.originalPrompt, fallback);

  if (looksLikeMetaPrompt(originalPrompt.zh) || looksLikeMetaPrompt(originalPrompt.en)) {
    originalPrompt = buildFallbackOriginalRunwayPrompt(originalScript);
  }

  return {
    quality: normalizeBilingual(parsed.quality, fallback),
    originalScript,
    originalPrompt,
    rewriteScript: normalizeBilingual(parsed.rewriteScript, needsRewrite ? fallback : disabled),
    rewritePrompt: normalizeBilingual(parsed.rewritePrompt, needsRewrite ? fallback : disabled),
  };
}

function looksLikeMetaPrompt(text) {
  const value = String(text || "").trim();
  if (!value) return true;

  const metaPatterns = [
    "请分析",
    "请拆解",
    "请生成",
    "请模仿",
    "分析一个",
    "按时间线拆解",
    "Analyze a",
    "Please analyze",
    "Please break down",
    "Generate a prompt",
  ];

  const hasScene = /Scene\s*\d|镜头\s*\d|场景\s*\d/i.test(value);
  const hasVisualTerms = /camera|shot|close-up|tracking|pan|tilt|lighting|scene|镜头|构图|光线|主体|动作|转场/i.test(value);
  return metaPatterns.some((pattern) => value.includes(pattern)) && !(hasScene && hasVisualTerms);
}

function buildFallbackOriginalRunwayPrompt(originalScript) {
  return {
    zh: `Scene 1（原视频反推 Runway 提示词）
基于原视频拆解内容复刻画面：将原视频中的主要产品、主体动作、场景环境、构图方式和展示节奏转化为纯视觉镜头。按原片顺序呈现产品出现、主体互动、关键动作、情绪或卖点强化、结尾展示。强调真实物理运动、自然手部动作、稳定镜头、清晰产品材质、柔和自然光、无文字字幕、无口播、无物体变形。

参考拆解：
${originalScript.zh}`,
    en: `Scene 1 (Original Video Reverse-Engineered Runway Prompt)
Recreate the original video as a strictly visual image-to-video prompt. Follow the same sequence of shots, product presence, subject actions, setting, composition, pacing, and display logic described in the breakdown. Show the product entering the frame, the main interaction or demonstration, the key visual proof, and the closing product moment. Use realistic physical motion, natural hand or subject movement, stable camera behavior, clear product texture, soft natural lighting, no subtitles, no spoken dialogue, no on-screen text, no object morphing.

Reference breakdown:
${originalScript.en}`,
  };
}

function normalizeBilingual(value, fallback) {
  if (typeof value === "string") {
    return { zh: cleanModelText(value || fallback), en: cleanModelText(value || fallback) };
  }

  return {
    zh: cleanModelText(value?.zh || fallback),
    en: cleanModelText(value?.en || fallback),
  };
}

function cleanModelText(value) {
  return String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseJsonText(text) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("AI 返回内容无法解析为 JSON，请重新生成。");
  }
}

function extractAudio(inputPath, outputPath) {
  return new Promise((resolvePromise, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "64k",
      outputPath,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`音频抽取失败：${stderr.slice(-800)}`));
    });
  });
}

function extractVideoFrames(inputPath, outputDir) {
  return new Promise((resolvePromise, reject) => {
    const outputPattern = join(outputDir, "frame-%03d.jpg");
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vf",
      "fps=1,scale='min(768,iw)':-2",
      "-frames:v",
      "12",
      "-q:v",
      "4",
      outputPattern,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", reject);
    ffmpeg.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`视频画面抽取失败：${stderr.slice(-800)}`));
        return;
      }

      try {
        const { readdir } = await import("node:fs/promises");
        const files = (await readdir(outputDir))
          .filter((file) => file.endsWith(".jpg"))
          .sort()
          .map((file) => join(outputDir, file));
        resolvePromise(files);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function hasFfmpeg() {
  return new Promise((resolvePromise) => {
    const probe = spawn("ffmpeg", ["-version"]);
    probe.on("error", () => resolvePromise(false));
    probe.on("close", (code) => resolvePromise(code === 0));
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(rootDir, requestedPath));

  if (!filePath.startsWith(rootDir)) {
    return sendText(res, 403, "Forbidden");
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") return res.end();
    res.end(body);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sanitizeFileName(name) {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120) || "upload.mp4";
}

function loadDotEnv() {
  try {
    const envPath = join(rootDir, ".env");
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
