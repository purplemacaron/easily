/**
 * Provider presets — the single list of model services Easily knows about.
 *
 * A preset is NOT an adapter. There are only a handful of adapter kinds (see ProviderKind);
 * every popular service is a preset on top of one of them (default baseURL + logo + links).
 * Users create *connections* from presets and may create many connections per preset.
 *
 * `logo` is a slug in @lobehub/icons (app) / @lobehub/icons-static-svg (site).
 * Custom compatible endpoints use Easily's own glyphs ("easily:openai-compatible", ...).
 *
 * Model IDs are intentionally NOT listed here (except Anthropic defaults): they are fetched
 * from each connection's models endpoint at connect time. See ARCHITECTURE.md §5-1.
 */

export type ProviderKind =
  | "anthropic"
  | "anthropic-compatible"
  | "openai"
  | "openai-compatible"
  | "gemini"
  | "bedrock"
  | "vertex";

export type PresetGroup = "featured" | "cloud" | "inference" | "regional" | "local" | "custom";

export interface ProviderPreset {
  id: string;
  name: string;
  kind: ProviderKind;
  group: PresetGroup;
  /** Default base URL. Empty string = SDK default. Required input for custom presets. */
  baseURL: string;
  logo: string;
  /** Where the user gets an API key. */
  keyUrl?: string;
  docsUrl?: string;
  /** Local servers usually need no key. */
  requiresKey: boolean;
  /** User must type the base URL (custom endpoints, Azure). */
  editableBaseURL: boolean;
  /** Extra fields shown in the connection sheet (e.g. Azure api-version, AWS region). */
  extraFields?: Array<{ key: string; label: string; placeholder?: string; required?: boolean }>;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  // ── featured ────────────────────────────────────────────────────────────
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    group: "featured",
    baseURL: "",
    logo: "anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    docsUrl: "https://docs.anthropic.com",
    requiresKey: true,
    editableBaseURL: false,
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai",
    group: "featured",
    baseURL: "",
    logo: "openai",
    keyUrl: "https://platform.openai.com/api-keys",
    requiresKey: true,
    editableBaseURL: false,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    kind: "gemini",
    group: "featured",
    baseURL: "",
    logo: "gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    requiresKey: true,
    editableBaseURL: false,
  },

  // ── custom compatible endpoints (the two first-class "bring any endpoint" options) ──
  {
    id: "custom-openai",
    name: "OpenAI 호환 API",
    kind: "openai-compatible",
    group: "custom",
    baseURL: "",
    logo: "easily:openai-compatible",
    requiresKey: false,
    editableBaseURL: true,
    extraFields: [{ key: "headers", label: "추가 헤더 (JSON)", placeholder: '{"X-Org": "..."}' }],
  },
  {
    id: "custom-anthropic",
    name: "Anthropic 호환 API",
    kind: "anthropic-compatible",
    group: "custom",
    baseURL: "",
    logo: "easily:anthropic-compatible",
    requiresKey: false,
    editableBaseURL: true,
    extraFields: [
      { key: "authStyle", label: "인증 방식", placeholder: "x-api-key | bearer" },
      { key: "headers", label: "추가 헤더 (JSON)" },
    ],
  },

  // ── cloud platforms ─────────────────────────────────────────────────────
  {
    id: "bedrock",
    name: "AWS Bedrock",
    kind: "bedrock",
    group: "cloud",
    baseURL: "",
    logo: "bedrock",
    requiresKey: false,
    editableBaseURL: false,
    extraFields: [{ key: "awsRegion", label: "Region", placeholder: "us-east-1", required: true }],
  },
  {
    id: "vertex",
    name: "Google Vertex AI",
    kind: "vertex",
    group: "cloud",
    baseURL: "",
    logo: "vertexai",
    requiresKey: false,
    editableBaseURL: false,
    extraFields: [
      { key: "projectId", label: "Project ID", required: true },
      { key: "region", label: "Region", placeholder: "global", required: true },
    ],
  },
  {
    id: "azure-openai",
    name: "Azure OpenAI",
    kind: "openai-compatible",
    group: "cloud",
    baseURL: "https://{resource}.openai.azure.com/openai/v1",
    logo: "azure",
    requiresKey: true,
    editableBaseURL: true,
  },

  // ── inference platforms (OpenAI-compatible) ─────────────────────────────
  oc("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "openrouter", "https://openrouter.ai/keys"),
  oc("groq", "Groq", "https://api.groq.com/openai/v1", "groq", "https://console.groq.com/keys"),
  oc("together", "Together AI", "https://api.together.xyz/v1", "together", "https://api.together.ai/settings/api-keys"),
  oc("fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1", "fireworks"),
  oc("mistral", "Mistral", "https://api.mistral.ai/v1", "mistral", "https://console.mistral.ai/api-keys"),
  oc("xai", "xAI", "https://api.x.ai/v1", "xai", "https://console.x.ai"),
  oc("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "deepseek", "https://platform.deepseek.com/api_keys"),
  oc("perplexity", "Perplexity", "https://api.perplexity.ai", "perplexity"),

  // ── regional ────────────────────────────────────────────────────────────
  oc("qwen", "Qwen (DashScope)", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "qwen", undefined, "regional"),
  oc("moonshot", "Moonshot (Kimi)", "https://api.moonshot.ai/v1", "moonshot", undefined, "regional"),
  oc("zhipu", "Zhipu (GLM)", "https://open.bigmodel.cn/api/paas/v4", "zhipu", undefined, "regional"),

  // ── local ───────────────────────────────────────────────────────────────
  local("ollama", "Ollama", "http://127.0.0.1:11434/v1", "ollama"),
  local("lmstudio", "LM Studio", "http://127.0.0.1:1234/v1", "lmstudio"),
  local("vllm", "vLLM", "http://127.0.0.1:8000/v1", "vllm"),
] as const;

function oc(
  id: string,
  name: string,
  baseURL: string,
  logo: string,
  keyUrl?: string,
  group: PresetGroup = "inference",
): ProviderPreset {
  return { id, name, kind: "openai-compatible", group, baseURL, logo, keyUrl, requiresKey: true, editableBaseURL: true };
}

function local(id: string, name: string, baseURL: string, logo: string): ProviderPreset {
  return { id, name, kind: "openai-compatible", group: "local", baseURL, logo, requiresKey: false, editableBaseURL: true };
}

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
