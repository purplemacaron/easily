// Easily site — no build step. Renders provider logos and the feature list.
(function () {
  var REPO = "purplemacaron/easily";

  var LOGO_CDN = "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/";
  // Mirrors packages/core/src/providers/presets.ts. Local paths = Easily's own glyphs.
  var PROVIDERS = [
    ["Anthropic", "anthropic"],
    ["OpenAI", "openai"],
    ["Google Gemini", "gemini"],
    ["OpenAI 호환", "assets/openai-compatible.svg"],
    ["Anthropic 호환", "assets/anthropic-compatible.svg"],
    ["AWS Bedrock", "bedrock"],
    ["Vertex AI", "vertexai"],
    ["Azure OpenAI", "azure"],
    ["OpenRouter", "openrouter"],
    ["Groq", "groq"],
    ["Together AI", "together"],
    ["Fireworks", "fireworks"],
    ["Mistral", "mistral"],
    ["xAI", "xai"],
    ["DeepSeek", "deepseek"],
    ["Perplexity", "perplexity"],
    ["Qwen", "qwen"],
    ["Moonshot", "moonshot"],
    ["Zhipu", "zhipu"],
    ["Ollama", "ollama"],
    ["LM Studio", "lmstudio"],
    ["vLLM", "vllm"],
  ];

  var $ = function (s) {
    return document.querySelector(s);
  };

  document.querySelectorAll("[data-repo-link]").forEach(function (a) {
    a.href = "https://github.com/" + REPO;
  });
  document.querySelectorAll("[data-release-link]").forEach(function (a) {
    a.href = "https://github.com/" + REPO + "/releases/latest";
  });

  var logos = $("#logos");
  PROVIDERS.forEach(function (p) {
    var li = document.createElement("li");
    var img = document.createElement("img");
    img.src = p[1].indexOf("/") >= 0 ? p[1] : LOGO_CDN + p[1] + ".svg";
    img.alt = "";
    img.loading = "lazy";
    img.onerror = function () {
      img.remove();
    };
    li.appendChild(img);
    li.appendChild(document.createTextNode(p[0]));
    logos.appendChild(li);
  });

  var data = window.EASILY_FEATURES;
  if (!data) return;
  document.querySelectorAll('[data-count="features"]').forEach(function (el) {
    el.textContent = data.items.length;
  });

  var state = { cat: "all", q: "" };
  var cats = $("#cats");
  var list = $("#feature-list");

  function chip(id, label) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.dataset.cat = id;
    b.textContent = label;
    b.onclick = function () {
      state.cat = id;
      render();
    };
    cats.appendChild(b);
  }
  chip("all", "전체");
  data.categories.forEach(function (c) {
    chip(c.id, c.name);
  });

  $("#q").addEventListener("input", function (e) {
    state.q = e.target.value.trim().toLowerCase();
    render();
  });

  function render() {
    cats.querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.cat === state.cat));
    });
    list.textContent = "";
    data.items.forEach(function (it) {
      if (state.cat !== "all" && it[0].indexOf(state.cat + "-") !== 0) return;
      if (state.q && (it[2] + " " + it[3]).toLowerCase().indexOf(state.q) < 0) return;
      var li = document.createElement("li");
      li.textContent = it[2];
      li.title = it[3];
      list.appendChild(li);
    });
  }
  render();
})();
