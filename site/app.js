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
  // One-click download: links start at the releases page and are swapped for the
  // actual installer URLs once the latest release's assets are known.
  var RELEASES = "https://github.com/" + REPO + "/releases/latest";
  var OS_NAME = { win: "Windows", mac: "macOS", linux: "Linux" };
  var ASSET = {
    win: [/Setup.*\.exe$/i, /\.exe$/i],
    mac: [/arm64\.dmg$/i, /\.dmg$/i],
    linux: [/\.AppImage$/i, /\.deb$/i],
  };
  var ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent;
  var myOs = /win/i.test(ua) ? "win" : /mac|iphone|ipad/i.test(ua) ? "mac" : /linux|x11/i.test(ua) ? "linux" : null;
  var isMobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);

  var hero = $("#hero-download");
  if (myOs && !isMobile) hero.textContent = OS_NAME[myOs] + "용 다운로드";

  document.querySelectorAll("[data-release-link]").forEach(function (a) {
    a.href = RELEASES;
  });

  function pick(assets, os) {
    for (var i = 0; i < ASSET[os].length; i++) {
      for (var j = 0; j < assets.length; j++) {
        if (ASSET[os][i].test(assets[j].name)) return assets[j];
      }
    }
    return null;
  }

  fetch("https://api.github.com/repos/" + REPO + "/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (rel) {
      if (!rel || !rel.assets) return;
      var urls = {};
      ["win", "mac", "linux"].forEach(function (os) {
        var asset = pick(rel.assets, os);
        if (asset) urls[os] = asset.browser_download_url;
      });
      document.querySelectorAll("[data-os]").forEach(function (a) {
        var u = urls[a.dataset.os];
        if (u) a.href = u;
      });
      if (myOs && !isMobile && urls[myOs]) hero.href = urls[myOs];
    })
    .catch(function () {
      // Offline or rate-limited: the links keep pointing at the releases page.
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
