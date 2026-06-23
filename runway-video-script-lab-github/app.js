const state = {
  videoFile: null,
  productImage: null,
  language: "zh",
  results: {
    quality: { zh: "", en: "" },
    originalScript: { zh: "上传视频后，这里会生成原视频脚本拆解。", en: "Upload a video to generate the original script breakdown." },
    originalPrompt: { zh: "这里会生成可复刻原视频画面运动的 Runway 反推提示词。", en: "This area will generate a Runway prompt reverse-engineered from the original video's visuals and motion." },
    rewriteScript: { zh: "打开仿写选项并填写新产品信息后，这里会生成新脚本。", en: "Enable rewrite and enter the new product information to generate a new script." },
    rewritePrompt: { zh: "这里会生成可继续批量仿写的提示词。", en: "This area will generate Runway-ready visual motion prompts for the rewritten script." },
  },
};

const sectionIds = ["originalScript", "originalPrompt", "rewriteScript", "rewritePrompt"];

const els = {
  form: document.querySelector("#scriptForm"),
  videoInput: document.querySelector("#videoInput"),
  productImageInput: document.querySelector("#productImageInput"),
  videoPreview: document.querySelector("#videoPreview"),
  imagePreview: document.querySelector("#imagePreview"),
  videoFileName: document.querySelector("#videoFileName"),
  imageFileName: document.querySelector("#imageFileName"),
  apiKey: document.querySelector("#apiKey"),
  sourceText: document.querySelector("#sourceText"),
  category: document.querySelector("#category"),
  tone: document.querySelector("#tone"),
  rewriteToggle: document.querySelector("#rewriteToggle"),
  rewriteFields: document.querySelector("#rewriteFields"),
  rewriteRequirements: document.querySelector("#rewriteRequirements"),
  rewriteRevision: document.querySelector("#rewriteRevision"),
  reviseRewriteBtn: document.querySelector("#reviseRewriteBtn"),
  updateRewritePromptBtn: document.querySelector("#updateRewritePromptBtn"),
  productName: document.querySelector("#productName"),
  statusPill: document.querySelector("#statusPill"),
  clearBtn: document.querySelector("#clearBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  toast: document.querySelector("#toast"),
  qualityPanel: document.querySelector("#qualityPanel"),
  qualityText: document.querySelector("#qualityText"),
  rewriteScriptCard: document.querySelector("#rewriteScriptCard"),
  rewritePromptCard: document.querySelector("#rewritePromptCard"),
};

const outputEls = Object.fromEntries(
  sectionIds.map((section) => [
    section,
    {
      zh: document.querySelector(`#${section}Zh`),
      en: document.querySelector(`#${section}En`),
    },
  ])
);

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 1800);
}

function setStatus(text) {
  els.statusPill.textContent = text;
}

function requireApiKey() {
  const apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    throw new Error("请先在页面里输入 OpenAI API Key；刷新页面后需要重新输入。");
  }
  return apiKey;
}

function friendlyError(error) {
  const message = String(error?.message || error || "");
  if (message.includes("Failed to fetch")) {
    return "本地后端未连接。通常是昨天打开的服务今天已经停了，请使用我重新打开的新地址。";
  }
  return message || "未知错误";
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return {
      error:
        response.status === 404
          ? "当前页面没有连接到语音识别后端。请打开本地后端地址。"
          : `后端返回了无法解析的内容：${text.slice(0, 120)}`,
    };
  }
}

async function checkBackendHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await readJsonResponse(response);

    if (!response.ok) return setStatus("后端异常");
    if (!data.ffmpeg) return setStatus("缺少 ffmpeg");
    if (!data.acceptsBrowserKey) return setStatus("后端需更新");

    setStatus(data.openaiKey ? "可识别" : "等待输入 Key");
  } catch {
    setStatus("后端未连接");
  }
}

async function transcribeVideoIfNeeded() {
  if (!state.videoFile || els.sourceText.value.trim()) {
    return els.sourceText.value.trim();
  }

  const apiKey = requireApiKey();
  setStatus("识别中");
  showToast("正在识别视频口播");

  const formData = new FormData();
  formData.append("video", state.videoFile);
  formData.append("language", "zh");
  formData.append(
    "prompt",
    `这是一条${els.category.value}类短视频，风格偏${els.tone.value}。请识别中文口播，保留原句节奏。`
  );

  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "x-openai-api-key": apiKey },
    body: formData,
  });

  const data = await readJsonResponse(response);
  if (!response.ok) {
    showToast("未识别到口播，将继续分析画面");
    return "";
  }

  const text = (data.text || "").trim();
  if (!text) {
    showToast("无口播文本，将继续分析画面");
    return "";
  }

  els.sourceText.value = text;
  return text;
}

async function analyzeScript(transcript) {
  const apiKey = requireApiKey();
  setStatus(state.videoFile ? "分析画面中" : "拆解中");
  showToast(state.videoFile ? "正在分析视频画面和口播" : "正在进行真实脚本拆解");

  if (state.videoFile) {
    const formData = new FormData();
    formData.append("video", state.videoFile);
    formData.append("transcript", transcript || els.sourceText.value.trim());
    formData.append("category", els.category.value);
    formData.append("tone", els.tone.value);
    formData.append("productName", els.productName.value.trim());
    formData.append("imageName", state.productImage?.name || "");
    formData.append("rewriteRequirements", els.rewriteRequirements.value.trim());
    formData.append("needsRewrite", String(els.rewriteToggle.checked));

    const response = await fetch("/api/analyze-video", {
      method: "POST",
      headers: { "x-openai-api-key": apiKey },
      body: formData,
    });

    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "视频画面分析失败。");
    }

    state.results = mergeResults(state.results, data);
    renderResults();
    return;
  }

  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-openai-api-key": apiKey,
    },
    body: JSON.stringify({
      transcript,
      category: els.category.value,
      tone: els.tone.value,
      productName: els.productName.value.trim(),
      imageName: state.productImage?.name || "",
      rewriteRequirements: els.rewriteRequirements.value.trim(),
      needsRewrite: els.rewriteToggle.checked,
    }),
  });

  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(data.error || "AI 拆解失败。");
  }

  state.results = mergeResults(state.results, data);
  renderResults();
}

function mergeResults(previous, next) {
  const merged = { ...previous };
  ["quality", ...sectionIds].forEach((section) => {
    merged[section] = {
      zh: cleanText(next?.[section]?.zh || previous[section]?.zh || ""),
      en: cleanText(next?.[section]?.en || previous[section]?.en || ""),
    };
  });
  return merged;
}

function renderResults() {
  els.qualityText.textContent = state.results.quality[state.language] || "";
  els.qualityPanel.hidden = !els.qualityText.textContent.trim();

  sectionIds.forEach((section) => {
    state.results[section].zh = cleanText(state.results[section].zh);
    state.results[section].en = cleanText(state.results[section].en);
    outputEls[section].zh.textContent = state.results[section].zh;
    outputEls[section].en.textContent = state.results[section].en;
  });

  updateLanguageView();
}

function cleanText(value) {
  return String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function updateLanguageView() {
  document.querySelectorAll("[data-lang-switch]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.langSwitch === state.language);
  });

  sectionIds.forEach((section) => {
    outputEls[section].zh.hidden = state.language !== "zh";
    outputEls[section].en.hidden = state.language !== "en";
  });

  els.qualityText.textContent = state.results.quality[state.language] || "";
}

function updateRewriteVisibility() {
  const enabled = els.rewriteToggle.checked;
  els.rewriteFields.classList.toggle("is-hidden", !enabled);
  els.rewriteScriptCard.classList.toggle("is-disabled", !enabled);
  els.rewritePromptCard.classList.toggle("is-disabled", !enabled);

  if (!enabled) {
    state.results.rewriteScript = {
      zh: "本次未选择脚本仿写。",
      en: "Script rewriting was not selected for this run.",
    };
    state.results.rewritePrompt = {
      zh: "本次未选择仿写脚本提示词。",
      en: "Runway prompts for the rewritten script were not selected for this run.",
    };
    renderResults();
  }
}

function handleVideoFile(file) {
  if (!file) return;
  state.videoFile = file;
  els.videoFileName.textContent = file.name;
  els.videoPreview.src = URL.createObjectURL(file);
  els.videoPreview.hidden = false;
  setStatus("已上传");
}

function handleImageFile(file) {
  if (!file) return;
  state.productImage = file;
  els.imageFileName.textContent = file.name;
  els.imagePreview.src = URL.createObjectURL(file);
  els.imagePreview.hidden = false;
}

function wireDropZone(zoneId, input, handler) {
  const zone = document.querySelector(zoneId);

  ["dragenter", "dragover"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove("drag-over");
    });
  });

  zone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files;
    input.files = event.dataTransfer.files;
    handler(file);
  });
}

async function syncSectionToEnglish(section) {
  const apiKey = requireApiKey();
  const chinese = state.results[section].zh.trim();
  if (!chinese) {
    showToast("没有可同步的中文内容");
    return;
  }

  setStatus("同步中");
  const response = await fetch("/api/sync-translation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-openai-api-key": apiKey,
    },
    body: JSON.stringify({ section, chinese }),
  });

  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(data.error || "英文同步失败。");
  }

  state.results[section].en = data.text || "";
  renderResults();
  setStatus("已同步");
  showToast("英文已同步");
}

async function reviseRewriteWithAI() {
  if (!els.rewriteToggle.checked) {
    showToast("请先打开脚本仿写");
    return;
  }

  const revisionInstruction = els.rewriteRevision.value.trim();
  if (!revisionInstruction) {
    showToast("请先填写修改要求");
    return;
  }

  const apiKey = requireApiKey();
  setStatus("修改仿写中");

  const response = await fetch("/api/revise-rewrite", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-openai-api-key": apiKey,
    },
    body: JSON.stringify({
      revisionInstruction,
      rewriteRequirements: els.rewriteRequirements.value.trim(),
      productName: els.productName.value.trim(),
      category: els.category.value,
      tone: els.tone.value,
      originalScript: state.results.originalScript,
      originalPrompt: state.results.originalPrompt,
      currentRewriteScript: state.results.rewriteScript,
      currentRewritePrompt: state.results.rewritePrompt,
    }),
  });

  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(data.error || "AI 修改仿写失败。");
  }

  state.results.rewriteScript = {
    zh: cleanText(data.rewriteScript?.zh || state.results.rewriteScript.zh),
    en: cleanText(data.rewriteScript?.en || state.results.rewriteScript.en),
  };
  state.results.rewritePrompt = {
    zh: cleanText(data.rewritePrompt?.zh || state.results.rewritePrompt.zh),
    en: cleanText(data.rewritePrompt?.en || state.results.rewritePrompt.en),
  };

  renderResults();
  setStatus("已修改");
  showToast("仿写已修改，提示词已同步");
}

async function updateRewritePromptFromScript() {
  if (!els.rewriteToggle.checked) {
    showToast("请先打开脚本仿写");
    return;
  }

  const apiKey = requireApiKey();
  setStatus("更新提示词中");

  const response = await fetch("/api/update-rewrite-prompt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-openai-api-key": apiKey,
    },
    body: JSON.stringify({
      rewriteRequirements: els.rewriteRequirements.value.trim(),
      productName: els.productName.value.trim(),
      category: els.category.value,
      tone: els.tone.value,
      originalScript: state.results.originalScript,
      originalPrompt: state.results.originalPrompt,
      rewriteScript: state.results.rewriteScript,
      currentRewritePrompt: state.results.rewritePrompt,
    }),
  });

  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(data.error || "更新仿写提示词失败。");
  }

  state.results.rewritePrompt = {
    zh: cleanText(data.rewritePrompt?.zh || state.results.rewritePrompt.zh),
    en: cleanText(data.rewritePrompt?.en || state.results.rewritePrompt.en),
  };

  renderResults();
  setStatus("已更新");
  showToast("仿写提示词已根据脚本更新");
}

function resetOutputs() {
  state.results = {
    quality: { zh: "", en: "" },
    originalScript: { zh: "上传视频后，这里会生成原视频脚本拆解。", en: "Upload a video to generate the original script breakdown." },
    originalPrompt: { zh: "这里会生成可复刻原视频画面运动的 Runway 反推提示词。", en: "This area will generate a Runway prompt reverse-engineered from the original video's visuals and motion." },
    rewriteScript: { zh: "打开仿写选项并填写新产品信息后，这里会生成新脚本。", en: "Enable rewrite and enter the new product information to generate a new script." },
    rewritePrompt: { zh: "这里会生成可继续批量仿写的提示词。", en: "This area will generate Runway-ready visual motion prompts for the rewritten script." },
  };
  renderResults();
}

els.videoInput.addEventListener("change", (event) => {
  handleVideoFile(event.target.files[0]);
});

els.productImageInput.addEventListener("change", (event) => {
  handleImageFile(event.target.files[0]);
});

els.rewriteToggle.addEventListener("change", updateRewriteVisibility);

els.reviseRewriteBtn.addEventListener("click", async () => {
  try {
    await reviseRewriteWithAI();
  } catch (error) {
    setStatus("修改失败");
    showToast(friendlyError(error));
  }
});

els.updateRewritePromptBtn.addEventListener("click", async () => {
  try {
    await updateRewritePromptFromScript();
  } catch (error) {
    setStatus("更新失败");
    showToast(friendlyError(error));
  }
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const transcript = await transcribeVideoIfNeeded();
    await analyzeScript(transcript);
    setStatus("已生成");
    showToast("结果已生成");
  } catch (error) {
    setStatus("生成失败");
    const message = friendlyError(error);
    state.results.quality.zh = `失败原因：${message}`;
    state.results.quality.en = `Failure reason: ${message}`;
    state.results.originalScript.zh = `无法完成真实拆解。\n\n排查建议：\n1. 请确认页面里输入了 OpenAI API Key。\n2. 如果视频声音很弱或只有字幕，请先手动粘贴字幕/口播文本。\n3. 如果识别文本少于 12 个字，系统会停止套模板，避免输出假结果。`;
    state.results.originalScript.en = "Real analysis could not be completed. Please check the API key, video file, or paste the transcript manually.";
    renderResults();
    showToast("生成失败");
  }
});

els.clearBtn.addEventListener("click", () => {
  els.form.reset();
  state.videoFile = null;
  state.productImage = null;
  els.videoFileName.textContent = "拖入或点击上传视频文件";
  els.imageFileName.textContent = "点击上传产品图";
  els.videoPreview.hidden = true;
  els.imagePreview.hidden = true;
  els.videoPreview.removeAttribute("src");
  els.imagePreview.removeAttribute("src");
  resetOutputs();
  updateRewriteVisibility();
  setStatus("待上传");
});

document.querySelectorAll("[data-lang-switch]").forEach((button) => {
  button.addEventListener("click", () => {
    state.language = button.dataset.langSwitch;
    updateLanguageView();
  });
});

document.querySelectorAll("[data-copy-section]").forEach((button) => {
  button.addEventListener("click", async () => {
    const section = button.dataset.copySection;
    await navigator.clipboard.writeText(state.results[section][state.language]);
    showToast("已复制");
  });
});

document.querySelectorAll("[data-sync]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await syncSectionToEnglish(button.dataset.sync);
    } catch (error) {
      setStatus("同步失败");
      showToast(friendlyError(error));
    }
  });
});

sectionIds.forEach((section) => {
  outputEls[section].zh.addEventListener("input", () => {
    state.results[section].zh = cleanText(outputEls[section].zh.textContent);
    if (section === "rewriteScript") {
      setStatus("提示词待同步");
    }
  });

  outputEls[section].en.addEventListener("input", () => {
    state.results[section].en = cleanText(outputEls[section].en.textContent);
    if (section === "rewriteScript") {
      setStatus("提示词待同步");
    }
  });
});

els.qualityText.addEventListener("input", () => {
  state.results.quality[state.language] = els.qualityText.textContent;
});

els.exportBtn.addEventListener("click", () => {
  const content = [
    "# 识别与拆解质量",
    "## 中文",
    state.results.quality.zh,
    "## English",
    state.results.quality.en,
    "# 原视频脚本",
    "## 中文",
    state.results.originalScript.zh,
    "## English",
    state.results.originalScript.en,
    "# 原视频 Runway 反推提示词",
    "## 中文",
    state.results.originalPrompt.zh,
    "## English",
    state.results.originalPrompt.en,
    "# 脚本仿写",
    "## 中文",
    state.results.rewriteScript.zh,
    "## English",
    state.results.rewriteScript.en,
    "# 仿写脚本提示词",
    "## 中文",
    state.results.rewritePrompt.zh,
    "## English",
    state.results.rewritePrompt.en,
  ].join("\n\n");

  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "runway-script-analysis.md";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("已导出 Markdown");
});

wireDropZone("#videoDrop", els.videoInput, handleVideoFile);
wireDropZone("#imageDrop", els.productImageInput, handleImageFile);
renderResults();
updateRewriteVisibility();
checkBackendHealth();
