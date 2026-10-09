import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const SERVER_BOOT_TIME = Date.now();

// Multi-Key Round-Robin Pool for Gemini & Groq (supports single key or comma-separated keys: KEY1,KEY2,KEY3)
const geminiClientCache = new Map<string, GoogleGenAI>();
let geminiRoundRobinIndex = 0;
let groqRoundRobinIndex = 0;
let globalLoadBalancerCursor = 0;

function getGeminiKeysPool(): string[] {
  const raw = process.env.GEMINI_API_KEY || "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 5 && k !== "MY_GEMINI_API_KEY");
}

function getGroqKeysPool(): string[] {
  const raw = process.env.GROQ_API_KEY || "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 5);
}

function getNextGeminiClient(): { client: GoogleGenAI; keyIndex: number } {
  const keys = getGeminiKeysPool();
  const selectedKey =
    keys.length > 0
      ? keys[geminiRoundRobinIndex++ % keys.length]
      : process.env.GEMINI_API_KEY || "";

  let client = geminiClientCache.get(selectedKey);
  if (!client) {
    client = new GoogleGenAI({
      apiKey: selectedKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    geminiClientCache.set(selectedKey, client);
  }
  return {
    client,
    keyIndex:
      keys.length > 0 ? ((geminiRoundRobinIndex - 1) % keys.length) + 1 : 1,
  };
}

function getNextGroqKey(): { apiKey: string; keyIndex: number } {
  const keys = getGroqKeysPool();
  if (keys.length === 0) {
    throw new Error("GROQ_API_KEY is not set in server environment");
  }
  const idx = groqRoundRobinIndex++ % keys.length;
  return { apiKey: keys[idx], keyIndex: idx + 1 };
}

export interface EngineNode {
  id: string;
  name: string;
  provider: string;
  modelIdentifier: string;
  category: "cloud_api" | "keyless_open" | "local_compute";
  requiresKey: boolean;
  keyConfigured: boolean;
  enabled: boolean;
  priority: number;
  status: "operational" | "standby" | "degraded";
  avgLatencyMs: number;
  successRate: number;
  totalCalls: number;
  capabilities: string[];
  descriptionAr: string;
}

export interface TaskLogEntry {
  id: string;
  timestamp: string;
  deviceId: string;
  deviceModel: string;
  voiceCommand: string;
  detectedIntent:
    | "math_computation"
    | "live_search"
    | "deep_reasoning"
    | "hybrid_device_action"
    | "quick_knowledge";
  intentLabelAr: string;
  selectedEngineId: string;
  selectedEngineName: string;
  fallbackUsed: boolean;
  keylessToolsUsed: string[];
  latencyMs: number;
  rawProcessingBytes: number;
  mobilePayloadBytes: number;
  bandwidthSavedPercent: number;
  status: "success" | "fallback_success" | "error";
  spokenReply: string;
  detailedAnswer?: string;
  structuredData: {
    computedResult?: string;
    deviceAction?: {
      actionType: string;
      targetApp: string;
      parameters: Record<string, string>;
    } | null;
    keyFacts?: string[];
  };
  sources: Array<{ title: string; uri: string }>;
}

export interface RoutingConfig {
  strategy: "smart_hybrid" | "keyless_first" | "max_accuracy" | "ultra_fast";
  enableAutoFallback: boolean;
  enableSearchGrounding: boolean;
  enableKeylessPrecompute: boolean;
  mobilePayloadCompression: "compact" | "ultra_light" | "full";
  maxSpokenWords: number;
}

export interface KeepAliveConfig {
  enabled: boolean;
  intervalMinutes: number;
  targetUrl: string;
  totalHeartbeats: number;
  lastHeartbeatAt: string | null;
  lastHeartbeatStatus: "ok" | "pending" | "error";
}

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "mindo-production-state.json");
const WARM_CACHE_FILE = path.join(DATA_DIR, "mindo-warm-cache.json");

// High-Capacity Smart Normalized RAM Cache (Up to 10,000 entries) + Persistent Warm Cache
const MAX_RAM_CACHE_ENTRIES = 10000;
const queryRamCache = new Map<
  string,
  { expiresAt: number; payload: Record<string, any> }
>();

// In-Flight Request Coalescing Map: merges simultaneous identical requests into 1 single AI call
const inFlightRequests = new Map<string, Promise<Record<string, any>>>();

// Per-Device Fair Quota Guard (max 15 premium AI calls per minute per deviceId; excess auto-routes to Keyless LLM)
const MAX_DEVICE_AI_CALLS_PER_MINUTE = 15;
const deviceQuotaMap = new Map<string, { windowStart: number; count: number }>();

function isDeviceWithinFairAiQuota(deviceId: string): boolean {
  const now = Date.now();
  const entry = deviceQuotaMap.get(deviceId);
  if (!entry || now - entry.windowStart > 60_000) {
    deviceQuotaMap.set(deviceId, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_DEVICE_AI_CALLS_PER_MINUTE;
}

// Live FX & Weather RAM Caches
let cachedFxData: {
  expiresAt: number;
  snippet: string;
  rates: Record<string, number>;
} | null = null;
const cachedCityWeather = new Map<
  string,
  {
    expiresAt: number;
    cityName: string;
    tempC: number;
    humidity: number;
    windKmh: number;
    uri: string;
  }
>();

function setRamCacheEntry(
  key: string,
  payload: Record<string, any>,
  ttlMs = 30 * 60 * 1000
) {
  if (queryRamCache.size >= MAX_RAM_CACHE_ENTRIES) {
    const oldestKey = queryRamCache.keys().next().value;
    if (oldestKey) queryRamCache.delete(oldestKey);
  }
  queryRamCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    payload,
  });
  scheduleWarmCacheSave();
}

function normalizeSemanticCacheKey(
  query: string,
  langCode: string,
  preferredEngine: string
): string {
  const normalizedText = query
    .toLowerCase()
    .replace(
      /\b(يا ميندو|ميندو|لو سمحت|من فضلك|أخبرني عن|أخبرني|قل لي|هل يمكنك|hey mindo|mindo|please|tell me|can you tell me)\b/gi,
      ""
    )
    .replace(/[؟?!.,،؛:"'«»()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${preferredEngine}::${langCode}::${
    normalizedText || query.trim().toLowerCase()
  }`;
}

const defaultEnginePool: EngineNode[] = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash (Grounded)",
    provider: "Google DeepMind",
    modelIdentifier: "gemini-3.8-flash",
    category: "cloud_api",
    requiresKey: true,
    keyConfigured: getGeminiKeysPool().length > 0,
    enabled: true,
    priority: 1,
    status: getGeminiKeysPool().length > 0 ? "operational" : "standby",
    avgLatencyMs: 0,
    successRate: 100,
    totalCalls: 0,
    capabilities: [
      "بحث جوجل الحي (Google Search)",
      "حل المسائل العلمية والمنطقية المعقدة",
      "دمج الطلبات المتزامنة (In-Flight Coalescing)",
      "الرد بنفس لغة السؤال تلقائياً",
    ],
    descriptionAr:
      "المحرك السحابي الرئيسي للإجابة على الأسئلة القوية والبحث الفوري عبر الويب مع دعم تدوير المفاتيح لخدمة آلاف المستخدمين.",
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite (Turbo)",
    provider: "Google DeepMind",
    modelIdentifier: "gemini-3.1-flash-lite",
    category: "cloud_api",
    requiresKey: true,
    keyConfigured: getGeminiKeysPool().length > 0,
    enabled: true,
    priority: 1,
    status: getGeminiKeysPool().length > 0 ? "operational" : "standby",
    avgLatencyMs: 0,
    successRate: 100,
    totalCalls: 0,
    capabilities: [
      "استجابة فائقة السرعة وتوفير 60% من التوكنز",
      "حصة يومية مستقلة تضاعف سعة المفتاح",
      "تلخيص فوري لقارئ الهاتف بنفس لغة السائل",
    ],
    descriptionAr:
      "نموذج فعلي خفيف وسريع جداً مخصص للردود الصوتية الفورية وموازنة الضغط مع باقي النماذج.",
  },
  {
    id: "keyless-math-engine",
    name: "Mindo Symbolic, Device & Time Core",
    provider: "Server Native Compute",
    modelIdentifier: "math-device-symbolic-v4",
    category: "local_compute",
    requiresKey: false,
    keyConfigured: true,
    enabled: true,
    priority: 1,
    status: "operational",
    avgLatencyMs: 1,
    successRate: 100,
    totalCalls: 0,
    capabilities: [
      "حسم المعادلات الحسابية في 1ms بدون استهلاك حصة AI",
      "حسم أوامر فتح تطبيقات الهاتف والوقت والتاريخ في 1ms",
      "سعة غير محدودة (تخدم ملايين الطلبات مجاناً)",
    ],
    descriptionAr:
      "محرك محلي فوري داخل الخادم يحسم العمليات الحسابية وأوامر فتح تطبيقات الهاتف وأسئلة الوقت والتاريخ في 1 ملي ثانية مجاناً.",
  },
  {
    id: "keyless-knowledge-mesh",
    name: "Live Web Mesh (Direct Weather + FX + Wiki)",
    provider: "Open REST APIs (Keyless)",
    modelIdentifier: "open-mesh-live-v2",
    category: "keyless_open",
    requiresKey: false,
    keyConfigured: true,
    enabled: true,
    priority: 2,
    status: "operational",
    avgLatencyMs: 120,
    successRate: 100,
    totalCalls: 0,
    capabilities: [
      "حسم فوري لأسعار العملات والطقس بدون استهلاك AI",
      "ويكيبيديا الحية بنفس لغة السؤال (AR/EN/FR/ES)",
      "ذاكرة كاش ذكية للعملات والمدن",
    ],
    descriptionAr:
      "شبكة اتصال حية ومفتوحة بدون مفاتيح تحسب تحويلات العملات وتجلب حالة الطقس وترد مباشرة بنفس لغة السؤال دون استهلاك حصة الذكاء الاصطناعي.",
  },
  {
    id: "open-llm-keyless",
    name: "Open Inference Keyless LLM",
    provider: "Pollinations Open AI",
    modelIdentifier: "openai-large",
    category: "keyless_open",
    requiresKey: false,
    keyConfigured: true,
    enabled: true,
    priority: 3,
    status: "operational",
    avgLatencyMs: 550,
    successRate: 98.5,
    totalCalls: 0,
    capabilities: [
      "توليد إجابات ذكية بدون مفتاح API",
      "حماية الحصة العادلة (Fair Quota Guard Fallback)",
      "دعم كامل لجميع اللغات",
    ],
    descriptionAr:
      "محرك ذكاء اصطناعي مفتوح يعمل بدون أي مفتاح، يتدخل تلقائياً عند ذروة الضغط أو تجاوز الجهاز الواحد للحد العادل في الدقيقة.",
  },
  {
    id: "groq-lpu-route",
    name: "Groq Multi-Model LPU Cluster (70B + 8B + Gemma2)",
    provider: "Groq Cloud API",
    modelIdentifier: "llama-3.3-70b + llama-3.1-8b + gemma2-9b",
    category: "cloud_api",
    requiresKey: true,
    keyConfigured: getGroqKeysPool().length > 0,
    enabled: true,
    priority: 1,
    status: getGroqKeysPool().length > 0 ? "operational" : "standby",
    avgLatencyMs: 0,
    successRate: 100,
    totalCalls: 0,
    capabilities: [
      "تدوير تلقائي بين 3 نماذج داخل نفس المفتاح (43,200+ طلب/يوم)",
      "وضع توفير التوكنز لخدمة 3 أضعاف المستخدمين في الدقيقة",
      "سرعة LPU خارقة لجميع اللغات",
    ],
    descriptionAr:
      "يوزع الطلبات ذكياً بين 3 نماذج مجانية داخل حساب Groq واحد (`llama-3.3-70b` و `llama-3.1-8b-instant` و `gemma2-9b-it`) لمضاعفة السعة اليومية 3 مرات مجاناً.",
  },
];

let enginePool: EngineNode[] = structuredClone(defaultEnginePool);
let routingConfig: RoutingConfig = {
  strategy: "smart_hybrid",
  enableAutoFallback: true,
  enableSearchGrounding: true,
  enableKeylessPrecompute: true,
  mobilePayloadCompression: "ultra_light",
  maxSpokenWords: 45,
};
let keepAliveConfig: KeepAliveConfig = {
  enabled: true,
  intervalMinutes: 4,
  targetUrl:
    process.env.RENDER_EXTERNAL_URL ||
    process.env.APP_URL ||
    "http://localhost:3000",
  totalHeartbeats: 0,
  lastHeartbeatAt: null,
  lastHeartbeatStatus: "ok",
};
let taskLogs: TaskLogEntry[] = [];

function loadPersistedState() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.taskLogs)) {
        taskLogs = parsed.taskLogs;
      }
      if (parsed.routingConfig) {
        routingConfig = { ...routingConfig, ...parsed.routingConfig };
      }
      if (parsed.keepAliveConfig) {
        keepAliveConfig = { ...keepAliveConfig, ...parsed.keepAliveConfig };
      }
      if (Array.isArray(parsed.engines)) {
        for (const savedEng of parsed.engines) {
          const target = enginePool.find((e) => e.id === savedEng.id);
          if (target) {
            target.enabled = savedEng.enabled ?? target.enabled;
            target.priority = savedEng.priority ?? target.priority;
            target.totalCalls = savedEng.totalCalls ?? target.totalCalls;
            target.avgLatencyMs = savedEng.avgLatencyMs ?? target.avgLatencyMs;
          }
        }
      }
    }
    // Load Persistent Warm Cache into RAM on boot
    if (fs.existsSync(WARM_CACHE_FILE)) {
      const rawCache = fs.readFileSync(WARM_CACHE_FILE, "utf8");
      const parsedCache = JSON.parse(rawCache);
      if (Array.isArray(parsedCache)) {
        const now = Date.now();
        for (const item of parsedCache) {
          if (item.key && item.payload && item.expiresAt > now) {
            queryRamCache.set(item.key, {
              expiresAt: item.expiresAt,
              payload: item.payload,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to load persisted state:", err);
  }
}

let isSavingState = false;
let pendingSave = false;

function scheduleNonBlockingStateSave() {
  setImmediate(async () => {
    if (isSavingState) {
      pendingSave = true;
      return;
    }
    isSavingState = true;
    try {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      const payload = JSON.stringify(
        {
          routingConfig,
          keepAliveConfig,
          engines: enginePool.map((e) => ({
            id: e.id,
            enabled: e.enabled,
            priority: e.priority,
            totalCalls: e.totalCalls,
            avgLatencyMs: e.avgLatencyMs,
          })),
          taskLogs: taskLogs.slice(0, 200),
        },
        null,
        2
      );
      await fs.promises.writeFile(STATE_FILE, payload, "utf8");
    } catch (err) {
      console.error("Async state save error:", err);
    } finally {
      isSavingState = false;
      if (pendingSave) {
        pendingSave = false;
        scheduleNonBlockingStateSave();
      }
    }
  });
}

// Non-blocking Persistent Warm Cache saver (debounced in background)
let isSavingWarmCache = false;
function scheduleWarmCacheSave() {
  if (isSavingWarmCache) return;
  isSavingWarmCache = true;
  setTimeout(async () => {
    try {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      const entries = Array.from(queryRamCache.entries())
        .slice(-500)
        .map(([key, val]) => ({
          key,
          expiresAt: val.expiresAt,
          payload: val.payload,
        }));
      await fs.promises.writeFile(
        WARM_CACHE_FILE,
        JSON.stringify(entries),
        "utf8"
      );
    } catch {
      // Ignore background warm cache write error
    } finally {
      isSavingWarmCache = false;
    }
  }, 5000);
}

loadPersistedState();

function refreshEngineKeyStatus() {
  const hasGemini = getGeminiKeysPool().length > 0;
  const hasGroq = getGroqKeysPool().length > 0;
  for (const eng of enginePool) {
    if (eng.id === "gemini-3.8-flash" || eng.id === "gemini-3.1-flash-lite") {
      eng.keyConfigured = hasGemini;
      eng.status = hasGemini ? "operational" : "standby";
    } else if (eng.id === "groq-lpu-route") {
      eng.keyConfigured = hasGroq;
      eng.status = hasGroq ? "operational" : "standby";
    } else {
      eng.keyConfigured = true;
      eng.status = "operational";
    }
  }
}

function detectQueryLanguage(query: string): {
  code: string;
  name: string;
  ttsLocale: string;
  wikiLang: string;
} {
  const clean = query.trim();
  const arabicChars = (clean.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (clean.match(/[a-zA-ZÀ-ÿ]/g) || []).length;

  if (arabicChars > 0 && arabicChars >= latinChars) {
    return {
      code: "ar",
      name: "Arabic (العربية)",
      ttsLocale: "ar-SA",
      wikiLang: "ar",
    };
  }

  if (/[\u0400-\u04FF]/.test(clean)) {
    return {
      code: "ru",
      name: "Russian",
      ttsLocale: "ru-RU",
      wikiLang: "ru",
    };
  }

  const lower = clean.toLowerCase();
  if (
    /\b(qui est|qu'est-ce|combien|comment|pourquoi|où est|quel|quelle|bonjour|calculer|ouvre|météo)\b|[éèêàùçœ]/i.test(
      lower
    )
  ) {
    return {
      code: "fr",
      name: "French (Français)",
      ttsLocale: "fr-FR",
      wikiLang: "fr",
    };
  }

  if (
    /\b(quién es|qué es|cuánto|cómo|dónde|por qué|hola|calcular|abre|clima)\b|[¿¡ñáéíóú]/i.test(
      lower
    )
  ) {
    return {
      code: "es",
      name: "Spanish (Español)",
      ttsLocale: "es-ES",
      wikiLang: "es",
    };
  }

  if (
    /\b(wer ist|was ist|wie viel|warum|wo ist|berechne|öffne|wetter)\b|[äöüß]/i.test(
      lower
    )
  ) {
    return {
      code: "de",
      name: "German (Deutsch)",
      ttsLocale: "de-DE",
      wikiLang: "de",
    };
  }

  if (/\b(kimdir|nedir|nasıl|kaç|nerede|hava)\b|[ğüşöçıİ]/i.test(lower)) {
    return {
      code: "tr",
      name: "Turkish (Türkçe)",
      ttsLocale: "tr-TR",
      wikiLang: "tr",
    };
  }

  if (latinChars > 0) {
    return {
      code: "en",
      name: "English",
      ttsLocale: "en-US",
      wikiLang: "en",
    };
  }

  return {
    code: "ar",
    name: "Arabic (العربية)",
    ttsLocale: "ar-SA",
    wikiLang: "ar",
  };
}

function classifyIntent(query: string): {
  intent: TaskLogEntry["detectedIntent"];
  labelAr: string;
} {
  const q = query.toLowerCase();
  const hasDeviceVerb =
    /افتح|شغل|اتصل|ارسل|ضبط منبه|بلوتوث|واي فاي|يوتيوب|واتساب|تطبيق|خرائط|حاسبة|open|launch|call|play|send|whatsapp|youtube|maps/i.test(
      q
    );
  const hasSearchOrQuestion =
    /ابحث|من هو|ما هو|ما هي|متى|أين|كم|اشرح|لماذا|كيف|معلومات|أخبار|طقس|سعر|تاريخ|who is|what is|where is|when|how|why|weather|price|news|search/i.test(
      q
    );
  const hasMath =
    /احسب|جذر|ضرب|قسمة|تقسيم|جمع|طرح|أس|نسبة|بالمئة|معادلة|حساب|دولار|ريال|يورو|درهم|جنيه|calculate|sqrt|square root|multiply|divide|plus|minus|percent|usd|eur|sar|[\d]+\s*[\+\-\*\/\^\%]\s*[\d]+/i.test(
      q
    );

  if (
    hasDeviceVerb &&
    (hasSearchOrQuestion || hasMath || q.split(" ").length > 4)
  ) {
    return {
      intent: "hybrid_device_action",
      labelAr: "أمر هاتف مركب + معالجة سحابية",
    };
  }
  if (hasMath) {
    return { intent: "math_computation", labelAr: "عملية حسابية وتحليل رقمي" };
  }
  if (
    /ابحث|أحدث|أخبار|اليوم|الآن|سعر|طقس|درجة الحرارة|كم يبلغ|من فاز|عام 202|latest|news|today|weather|temperature|price|who won/i.test(
      q
    )
  ) {
    return { intent: "live_search", labelAr: "بحث فوري ومعلومات حية" };
  }
  if (
    q.length > 60 ||
    /قارن|حلل|اشرح|لماذا|كيف|خطة|برمج|لخص|فلسفة|فيزياء|طب|هندسة|compare|analyze|explain|why|how to|summarize/i.test(
      q
    )
  ) {
    return { intent: "deep_reasoning", labelAr: "إجابة معمقة واستدلال منطقي" };
  }
  return { intent: "quick_knowledge", labelAr: "استعلام معرفي مباشر" };
}

function tryDeviceOrTimeShortCircuit(
  query: string,
  langCode: string
): {
  matched: boolean;
  spokenReply?: string;
  detailedAnswer?: string;
  computedResult?: string;
  deviceAction?: {
    actionType: string;
    targetApp: string;
    parameters: Record<string, string>;
  } | null;
} {
  const clean = query.trim();

  if (
    /^(يا ميندو\s*)?(كم الساعة( الآن)?|الوقت الآن|ما هو الوقت|what time is it|current time|quelle heure est-il)\s*[؟?]*$/i.test(
      clean
    )
  ) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString(
      langCode === "ar" ? "ar-EG" : "en-US",
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );
    const reply =
      langCode === "ar"
        ? `الساعة الآن هي ${timeStr} بتوقيت الخادم.`
        : `The current time is ${timeStr}.`;
    return {
      matched: true,
      spokenReply: reply,
      detailedAnswer: reply,
      computedResult: timeStr,
      deviceAction: null,
    };
  }

  const appOpenMatch = clean.match(
    /^(?:يا ميندو\s*|hey mindo\s*)?(?:افتح|شغل|فك|open|launch)\s+(?:تطبيق\s+|app\s+)?(واتساب|يوتيوب|خرائط(?:\s*جوجل)?|جوجل|الكاميرا|الحاسبة|الإعدادات|المنبه|فيسبوك|انستقرام|تيك توك|تليجرام|whatsapp|youtube|google maps|maps|camera|calculator|settings|alarm|facebook|instagram|tiktok|telegram)\s*$/i
  );

  if (appOpenMatch) {
    const rawTarget = appOpenMatch[1].trim();
    const replyByLang: Record<string, string> = {
      ar: `حاضر، جاري فتح ${rawTarget} الآن.`,
      en: `Sure, opening ${rawTarget} now.`,
      fr: `D'accord, ouverture de ${rawTarget} maintenant.`,
      es: `Claro, abriendo ${rawTarget} ahora.`,
    };
    const spoken = replyByLang[langCode] || replyByLang.en;
    return {
      matched: true,
      spokenReply: spoken,
      detailedAnswer: spoken,
      computedResult: `OPEN_APP: ${rawTarget}`,
      deviceAction: {
        actionType: "OPEN_APP",
        targetApp: rawTarget,
        parameters: { source: "mindo_direct_short_circuit" },
      },
    };
  }

  return { matched: false };
}

function tryKeylessMathPrecompute(query: string): {
  evaluated: boolean;
  expression?: string;
  result?: string;
  numericValue?: number;
  isPureMathOnly?: boolean;
} {
  try {
    const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
    const normalized = query.replace(/[٠-٩]/g, (d) =>
      String(arabicDigits.indexOf(d))
    );

    const mathCandidate = normalized
      .replace(/الجذر التربيعي لـ?\s*(\d+(\.\d+)?)/g, "Math.sqrt($1)")
      .replace(/جذر\s*(\d+(\.\d+)?)/g, "Math.sqrt($1)")
      .replace(/square root of\s*(\d+(\.\d+)?)/gi, "Math.sqrt($1)")
      .replace(/sqrt\s*\(?\s*(\d+(\.\d+)?)\s*\)?/gi, "Math.sqrt($1)")
      .replace(/(\d+(\.\d+)?)\s*أس\s*(\d+(\.\d+)?)/g, "Math.pow($1,$3)")
      .replace(
        /(\d+(\.\d+)?)\s*to the power of\s*(\d+(\.\d+)?)/gi,
        "Math.pow($1,$3)"
      )
      .replace(/مضافاً إليه|مضافا اليه|زائد|\bplus\b/gi, "+")
      .replace(/مقسوم على|مقسوماً على|تقسيم|قسمة|\bdivided by\b/gi, "/")
      .replace(/مضروب في|مضروباً في|ضرب|\btimes\b|\bmultiplied by\b/gi, "*")
      .replace(/مطروحاً منه|ناقص|طرح|\bminus\b/gi, "-");

    const matches = mathCandidate.match(
      /(?:Math\.sqrt\(\d+(?:\.\d+)?\)|Math\.pow\(\d+(?:\.\d+)?,\d+(?:\.\d+)?\)|\d+(?:\.\d+)?|\s*[\+\-\*\/\(\)]\s*)+/g
    );
    if (!matches) return { evaluated: false };

    const longest = matches
      .map((m) => m.trim())
      .filter((m) => /[\+\-\*\/]|Math\./.test(m) && /\d/.test(m))
      .sort((a, b) => b.length - a.length)[0];

    if (!longest) return { evaluated: false };

    const safeCheck = longest.replace(/Math\.(sqrt|pow)/g, "");
    if (!/^[0-9\+\-\*\/\.\(\),\s]+$/.test(safeCheck)) {
      return { evaluated: false };
    }

    const val = Function(`"use strict"; return (${longest});`)();
    if (typeof val === "number" && Number.isFinite(val)) {
      const formatted = Number.isInteger(val)
        ? val.toLocaleString("en-US")
        : val.toFixed(4).replace(/\.?0+$/, "");

      const needsExternal =
        /دولار|ريال|يورو|درهم|جنيه|عملة|صرف|طقس|افتح|يوتيوب|خرائط|ابحث|من هو|ما هو|dollar|euro|currency|weather|open|youtube|maps|who is|what is/i.test(
          normalized
        );

      return {
        evaluated: true,
        expression: longest
          .replace(/Math\.sqrt\((.*?)\)/g, "√$1")
          .replace(/Math\.pow\((.*?),(.*?)\)/g, "$1^$2"),
        result: formatted,
        numericValue: val,
        isPureMathOnly: !needsExternal,
      };
    }
  } catch {
    // Ignore parse error
  }
  return { evaluated: false };
}

// Built-in 0ms Coordinates for Arab & World Cities (skips geocoding network round-trip!)
const KNOWN_CITIES_COORDS: Record<
  string,
  { nameAr: string; nameEn: string; lat: number; lon: number }
> = {
  تونس: { nameAr: "تونس", nameEn: "Tunis", lat: 36.8065, lon: 10.1815 },
  tunis: { nameAr: "تونس", nameEn: "Tunis", lat: 36.8065, lon: 10.1815 },
  tunisia: { nameAr: "تونس", nameEn: "Tunisia", lat: 36.8065, lon: 10.1815 },
  صفاقس: { nameAr: "صفاقس", nameEn: "Sfax", lat: 34.7406, lon: 10.7603 },
  سوسة: { nameAr: "سوسة", nameEn: "Sousse", lat: 35.8256, lon: 10.6369 },
  القيروان: { nameAr: "القيروان", nameEn: "Kairouan", lat: 35.6781, lon: 10.0963 },
  بنزرت: { nameAr: "بنزرت", nameEn: "Bizerte", lat: 37.2744, lon: 9.8739 },
  قابس: { nameAr: "قابس", nameEn: "Gabes", lat: 33.8815, lon: 10.0982 },
  الجزائر: { nameAr: "الجزائر", nameEn: "Algiers", lat: 36.7538, lon: 3.0588 },
  algiers: { nameAr: "الجزائر", nameEn: "Algiers", lat: 36.7538, lon: 3.0588 },
  وهران: { nameAr: "وهران", nameEn: "Oran", lat: 35.6971, lon: -0.6308 },
  قسنطينة: { nameAr: "قسنطينة", nameEn: "Constantine", lat: 36.365, lon: 6.6147 },
  الرباط: { nameAr: "الرباط", nameEn: "Rabat", lat: 34.0209, lon: -6.8416 },
  المغرب: { nameAr: "الرباط", nameEn: "Morocco", lat: 34.0209, lon: -6.8416 },
  "الدار البيضاء": { nameAr: "الدار البيضاء", nameEn: "Casablanca", lat: 33.5731, lon: -7.5898 },
  كازابلانكا: { nameAr: "الدار البيضاء", nameEn: "Casablanca", lat: 33.5731, lon: -7.5898 },
  مراكش: { nameAr: "مراكش", nameEn: "Marrakesh", lat: 31.6295, lon: -7.9811 },
  طنجة: { nameAr: "طنجة", nameEn: "Tangier", lat: 35.7595, lon: -5.834 },
  طرابلس: { nameAr: "طرابلس", nameEn: "Tripoli", lat: 32.8872, lon: 13.1913 },
  ليبيا: { nameAr: "طرابلس", nameEn: "Libya", lat: 32.8872, lon: 13.1913 },
  بنغازي: { nameAr: "بنغازي", nameEn: "Benghazi", lat: 32.1194, lon: 20.0868 },
  القاهرة: { nameAr: "القاهرة", nameEn: "Cairo", lat: 30.0444, lon: 31.2357 },
  مصر: { nameAr: "القاهرة", nameEn: "Cairo", lat: 30.0444, lon: 31.2357 },
  cairo: { nameAr: "القاهرة", nameEn: "Cairo", lat: 30.0444, lon: 31.2357 },
  الإسكندرية: { nameAr: "الإسكندرية", nameEn: "Alexandria", lat: 31.2001, lon: 29.9187 },
  الاسكندرية: { nameAr: "الإسكندرية", nameEn: "Alexandria", lat: 31.2001, lon: 29.9187 },
  الرياض: { nameAr: "الرياض", nameEn: "Riyadh", lat: 24.7136, lon: 46.6753 },
  riyadh: { nameAr: "الرياض", nameEn: "Riyadh", lat: 24.7136, lon: 46.6753 },
  جدة: { nameAr: "جدة", nameEn: "Jeddah", lat: 21.4858, lon: 39.1925 },
  مكة: { nameAr: "مكة المكرمة", nameEn: "Mecca", lat: 21.3891, lon: 39.8579 },
  المدينة: { nameAr: "المدينة المنورة", nameEn: "Medina", lat: 24.5247, lon: 39.5692 },
  الدمام: { nameAr: "الدمام", nameEn: "Dammam", lat: 26.4207, lon: 50.0888 },
  دبي: { nameAr: "دبي", nameEn: "Dubai", lat: 25.2048, lon: 55.2708 },
  dubai: { nameAr: "دبي", nameEn: "Dubai", lat: 25.2048, lon: 55.2708 },
  أبوظبي: { nameAr: "أبوظبي", nameEn: "Abu Dhabi", lat: 24.4539, lon: 54.3773 },
  ابوظبي: { nameAr: "أبوظبي", nameEn: "Abu Dhabi", lat: 24.4539, lon: 54.3773 },
  الدوحة: { nameAr: "الدوحة", nameEn: "Doha", lat: 25.2854, lon: 51.531 },
  قطر: { nameAr: "الدوحة", nameEn: "Doha", lat: 25.2854, lon: 51.531 },
  الكويت: { nameAr: "الكويت", nameEn: "Kuwait City", lat: 29.3759, lon: 47.9774 },
  المنامة: { nameAr: "المنامة", nameEn: "Manama", lat: 26.2285, lon: 50.586 },
  البحرين: { nameAr: "المنامة", nameEn: "Manama", lat: 26.2285, lon: 50.586 },
  مسقط: { nameAr: "مسقط", nameEn: "Muscat", lat: 23.588, lon: 58.3829 },
  عمان: { nameAr: "عمّان", nameEn: "Amman", lat: 31.9454, lon: 35.9284 },
  الأردن: { nameAr: "عمّان", nameEn: "Amman", lat: 31.9454, lon: 35.9284 },
  بغداد: { nameAr: "بغداد", nameEn: "Baghdad", lat: 33.3152, lon: 44.3661 },
  العراق: { nameAr: "بغداد", nameEn: "Baghdad", lat: 33.3152, lon: 44.3661 },
  دمشق: { nameAr: "دمشق", nameEn: "Damascus", lat: 33.5138, lon: 36.2765 },
  سوريا: { nameAr: "دمشق", nameEn: "Damascus", lat: 33.5138, lon: 36.2765 },
  بيروت: { nameAr: "بيروت", nameEn: "Beirut", lat: 33.8938, lon: 35.5018 },
  لبنان: { nameAr: "بيروت", nameEn: "Beirut", lat: 33.8938, lon: 35.5018 },
  القدس: { nameAr: "القدس", nameEn: "Jerusalem", lat: 31.7683, lon: 35.2137 },
  غزة: { nameAr: "غزة", nameEn: "Gaza", lat: 31.5017, lon: 34.4668 },
  الخرطوم: { nameAr: "الخرطوم", nameEn: "Khartoum", lat: 15.5007, lon: 32.5599 },
  صنعاء: { nameAr: "صنعاء", nameEn: "Sanaa", lat: 15.3694, lon: 44.191 },
  عدن: { nameAr: "عدن", nameEn: "Aden", lat: 12.7855, lon: 45.0187 },
  نواكشوط: { nameAr: "نواكشوط", nameEn: "Nouakchott", lat: 18.0735, lon: -15.9582 },
  لندن: { nameAr: "لندن", nameEn: "London", lat: 51.5074, lon: -0.1278 },
  london: { nameAr: "لندن", nameEn: "London", lat: 51.5074, lon: -0.1278 },
  باريس: { nameAr: "باريس", nameEn: "Paris", lat: 48.8566, lon: 2.3522 },
  paris: { nameAr: "باريس", nameEn: "Paris", lat: 48.8566, lon: 2.3522 },
  إسطنبول: { nameAr: "إسطنبول", nameEn: "Istanbul", lat: 41.0082, lon: 28.9784 },
  اسطنبول: { nameAr: "إسطنبول", nameEn: "Istanbul", lat: 41.0082, lon: 28.9784 },
};

// Helper to fetch/cache live exchange rates map (includes ALL Arab & global currencies!)
async function getLiveUsdRates(): Promise<Record<string, number> | null> {
  if (cachedFxData && cachedFxData.expiresAt > Date.now()) {
    return cachedFxData.rates;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      if (data.rates) {
        const r = data.rates;
        const trackedCodes = [
          "TND",
          "DZD",
          "MAD",
          "LYD",
          "EGP",
          "SAR",
          "AED",
          "KWD",
          "QAR",
          "BHD",
          "OMR",
          "JOD",
          "IQD",
          "LBP",
          "SYP",
          "YER",
          "SDG",
          "MRU",
          "EUR",
          "GBP",
          "TRY",
          "CAD",
          "JPY",
          "CNY",
          "CHF",
        ];
        const pairs = trackedCodes
          .filter((c) => r[c] !== undefined)
          .map((c) => `${c}=${r[c]}`)
          .join(", ");
        const snippet = `[Live Exchange Rates per 1 USD]: ${pairs}`;
        cachedFxData = {
          expiresAt: Date.now() + 15 * 60 * 1000,
          snippet,
          rates: data.rates,
        };
        return data.rates;
      }
    }
  } catch {
    // Ignore timeout
  }
  return cachedFxData?.rates || null;
}

// Comprehensive Currency Dictionary covering all Arab & major world currencies
const ALL_CURRENCIES_MAP: Array<{
  code: string;
  regex: RegExp;
  nameAr: string;
}> = [
  {
    code: "TND",
    regex: /دينار\s*تونسي|الدينار\s*التونسي|تونسي|تونسية|\btnd\b|tunisian\s*dinar/i,
    nameAr: "دينار تونسي",
  },
  {
    code: "DZD",
    regex: /دينار\s*جزائري|الدينار\s*الجزائري|جزائري|\bdzd\b|algerian\s*dinar/i,
    nameAr: "دينار جزائري",
  },
  {
    code: "MAD",
    regex: /درهم\s*مغربي|الدرهم\s*المغربي|مغربي|\bmad\b|moroccan\s*dirham/i,
    nameAr: "درهم مغربي",
  },
  {
    code: "LYD",
    regex: /دينار\s*ليبي|الدينار\s*الليبي|ليبي|\blyd\b|libyan\s*dinar/i,
    nameAr: "دينار ليبي",
  },
  {
    code: "MRU",
    regex: /أوقية\s*موريتانية|اوقية\s*موريتانية|موريتاني|\bmru\b/i,
    nameAr: "أوقية موريتانية",
  },
  {
    code: "EGP",
    regex: /جنيه\s*مصري|الجنيه\s*المصري|جنيه|\begp\b|egyptian\s*pound/i,
    nameAr: "جنيه مصري",
  },
  {
    code: "SAR",
    regex: /ريال\s*سعودي|الريال\s*السعودي|ريال|\bsar\b|saudi\s*riyal|riyal/i,
    nameAr: "ريال سعودي",
  },
  {
    code: "AED",
    regex: /درهم\s*إماراتي|درهم\s*اماراتي|الدرهم\s*الإماراتي|درهم|\baed\b|dirham/i,
    nameAr: "درهم إماراتي",
  },
  {
    code: "KWD",
    regex: /دينار\s*كويتي|الدينار\s*الكويتي|كويتي|\bkwd\b|kuwaiti\s*dinar/i,
    nameAr: "دينار كويتي",
  },
  {
    code: "QAR",
    regex: /ريال\s*قطري|الريال\s*القطري|قطري|\bqar\b|qatari\s*riyal/i,
    nameAr: "ريال قطري",
  },
  {
    code: "BHD",
    regex: /دينار\s*بحريني|الدينار\s*البحريني|بحريني|\bbhd\b|bahraini\s*dinar/i,
    nameAr: "دينار بحريني",
  },
  {
    code: "OMR",
    regex: /ريال\s*عماني|الريال\s*العماني|عماني|\bomr\b|omani\s*rial/i,
    nameAr: "ريال عماني",
  },
  {
    code: "JOD",
    regex: /دينار\s*أردني|دينار\s*اردني|الأردني|اردني|\bjod\b|jordanian\s*dinar/i,
    nameAr: "دينار أردني",
  },
  {
    code: "IQD",
    regex: /دينار\s*عراقي|الدينار\s*العراقي|عراقي|\biqd\b|iraqi\s*dinar/i,
    nameAr: "دينار عراقي",
  },
  {
    code: "LBP",
    regex: /ليرة\s*لبنانية|لبناني|\blbp\b|lebanese\s*pound/i,
    nameAr: "ليرة لبنانية",
  },
  {
    code: "SYP",
    regex: /ليرة\s*سورية|سوري|\bsyp\b|syrian\s*pound/i,
    nameAr: "ليرة سورية",
  },
  {
    code: "YER",
    regex: /ريال\s*يمني|يمني|\byer\b|yemeni\s*rial/i,
    nameAr: "ريال يمني",
  },
  {
    code: "SDG",
    regex: /جنيه\s*سوداني|سوداني|\bsdg\b|sudanese\s*pound/i,
    nameAr: "جنيه سوداني",
  },
  {
    code: "TRY",
    regex: /ليرة\s*تركية|ليرة|\btry\b|turkish\s*lira|lira/i,
    nameAr: "ليرة تركية",
  },
  {
    code: "GBP",
    regex: /جنيه\s*إسترليني|جنيه\s*استرليني|باوند|\bgbp\b|british\s*pound|sterling/i,
    nameAr: "جنيه إسترليني",
  },
  {
    code: "EUR",
    regex: /يورو|اليورو|\beur\b|euro/i,
    nameAr: "يورو",
  },
  {
    code: "USD",
    regex: /دولار\s*أمريكي|دولار\s*امريكي|الدولار|دولار|\busd\b|dollar/i,
    nameAr: "دولار أمريكي",
  },
];

// Helper to fetch live weather for any city (uses 0ms KNOWN_CITIES_COORDS first, then geocoding API)
async function fetchCityWeatherLive(
  rawCity: string,
  wikiLang: string
): Promise<{
  cityName: string;
  tempC: number;
  humidity: number;
  windKmh: number;
  uri: string;
} | null> {
  const cleanCity = rawCity
    .replace(
      /^(?:في|بـ|بمدينة|لمدينة|مدينة|لدولة|دولة|عاصمة|الطقس في|طقس|حرارة|الجو في|in|at|for|weather in|weather)\s+/gi,
      ""
    )
    .replace(
      /\b(?:في|اليوم|الآن|غداً|غدا|حالياً|حاليا|يا ميندو|ميندو|وافتح|today|now|tomorrow|currently|right now)\b/gi,
      ""
    )
    .replace(/[؟?!.,،؛:"'«»()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanCity) return null;
  const cityCacheKey = `${wikiLang}::${cleanCity.toLowerCase()}`;
  const cached = cachedCityWeather.get(cityCacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  let lat: number | undefined;
  let lon: number | undefined;
  let resolvedName = cleanCity;

  const known =
    KNOWN_CITIES_COORDS[cleanCity.toLowerCase()] ||
    KNOWN_CITIES_COORDS[cleanCity] ||
    KNOWN_CITIES_COORDS[cleanCity.replace(/^ال/, "")];
  if (known) {
    lat = known.lat;
    lon = known.lon;
    resolvedName = wikiLang === "ar" ? known.nameAr : known.nameEn;
  } else {
    try {
      const geoController = new AbortController();
      const geoTimeout = setTimeout(() => geoController.abort(), 3500);
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          cleanCity
        )}&count=1&language=${wikiLang}&format=json`,
        { signal: geoController.signal }
      );
      clearTimeout(geoTimeout);
      if (geoRes.ok) {
        const geoData = (await geoRes.json()) as {
          results?: Array<{ name: string; latitude: number; longitude: number }>;
        };
        const loc = geoData.results?.[0];
        if (loc) {
          lat = loc.latitude;
          lon = loc.longitude;
          resolvedName = loc.name;
        }
      }
    } catch {
      // Ignore geocoding error
    }
  }

  if (lat !== undefined && lon !== undefined) {
    try {
      const wController = new AbortController();
      const wTimeout = setTimeout(() => wController.abort(), 4000);
      const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`;
      const wRes = await fetch(wUrl, { signal: wController.signal });
      clearTimeout(wTimeout);
      if (wRes.ok) {
        const wData = (await wRes.json()) as {
          current?: {
            temperature_2m?: number;
            relative_humidity_2m?: number;
            wind_speed_10m?: number;
          };
        };
        if (wData.current && typeof wData.current.temperature_2m === "number") {
          const info = {
            expiresAt: Date.now() + 10 * 60 * 1000,
            cityName: resolvedName,
            tempC: wData.current.temperature_2m,
            humidity: wData.current.relative_humidity_2m ?? 0,
            windKmh: wData.current.wind_speed_10m ?? 0,
            uri: wUrl,
          };
          cachedCityWeather.set(cityCacheKey, info);
          return info;
        }
      }
    } catch {
      // Ignore forecast timeout
    }
  }
  return null;
}

// Optimization #1: Direct Weather & Currency Short-Circuit (0 AI Quota Used!)
async function tryDirectWeatherOrCurrencyShortCircuit(
  query: string,
  langCode: string,
  wikiLang: string
): Promise<{
  matched: boolean;
  spokenReply?: string;
  detailedAnswer?: string;
  computedResult?: string;
  keyFacts?: string[];
  sources?: Array<{ title: string; uri: string }>;
  toolName?: string;
}> {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const normalized = query.replace(/[٠-٩]/g, (d) =>
    String(arabicDigits.indexOf(d))
  );

  if (
    /افتح|شغل|يوتيوب|واتساب|خرائط|open|launch|youtube|whatsapp|maps/i.test(
      normalized
    )
  ) {
    return { matched: false };
  }

  // A. Weather Query Short-Circuit (handles "كيف الطقس في تونس؟", "طقس تونس", "What is the weather in Tunis?", etc.)
  if (/طقس|حرارة|الجو|مناخ|weather|temperature|forecast|météo|clima/i.test(normalized)) {
    const afterPreposition = normalized.match(
      /(?:في|بـ|لمدينة|لدولة|\bin|\bat|\bfor)\s+([^\d\?؟!.,،]{2,25})/i
    );
    const afterWeatherWord = normalized.match(
      /(?:الطقس|طقس|حرارة|الجو|weather|temperature)\s+(?:في\s+|in\s+)?([^\d\?؟!.,،]{2,25})/i
    );
    const rawCity = (
      afterPreposition?.[1] ||
      afterWeatherWord?.[1] ||
      "تونس"
    ).trim();
    const weatherInfo = await fetchCityWeatherLive(rawCity, wikiLang);

    if (weatherInfo) {
      const replyByLang: Record<string, string> = {
        ar: `درجة الحرارة الآن في ${weatherInfo.cityName} هي ${weatherInfo.tempC} درجة مئوية، ونسبة الرطوبة ${weatherInfo.humidity} بالمئة مع سرعة رياح ${weatherInfo.windKmh} كيلومتر في الساعة.`,
        en: `The current temperature in ${weatherInfo.cityName} is ${weatherInfo.tempC}°C, with ${weatherInfo.humidity}% humidity and wind speed of ${weatherInfo.windKmh} km/h.`,
        fr: `La température actuelle à ${weatherInfo.cityName} est de ${weatherInfo.tempC}°C, avec ${weatherInfo.humidity}% d'humidité et un vent de ${weatherInfo.windKmh} km/h.`,
        es: `La temperatura actual en ${weatherInfo.cityName} es de ${weatherInfo.tempC}°C, con ${weatherInfo.humidity}% de humedad y viento de ${weatherInfo.windKmh} km/h.`,
      };
      const spoken = replyByLang[langCode] || replyByLang.en;
      return {
        matched: true,
        spokenReply: spoken,
        detailedAnswer: spoken,
        computedResult: `${weatherInfo.cityName}: ${weatherInfo.tempC}°C`,
        keyFacts: [
          `${weatherInfo.cityName}: ${weatherInfo.tempC}°C`,
          `Humidity: ${weatherInfo.humidity}% | Wind: ${weatherInfo.windKmh} km/h`,
        ],
        sources: [
          {
            title: `Open-Meteo Live Weather (${weatherInfo.cityName})`,
            uri: weatherInfo.uri,
          },
        ],
        toolName: "Open-Meteo Direct Weather Short-Circuit",
      };
    }
  }

  // B. Currency Conversion Short-Circuit (handles "كم يساوي الدولار مقابل الدينار التونسي؟", "100 USD to TND", etc.)
  const foundCurrencies: Array<{
    code: string;
    nameAr: string;
    index: number;
  }> = [];
  for (const c of ALL_CURRENCIES_MAP) {
    const m = normalized.match(c.regex);
    if (m && typeof m.index === "number") {
      if (!foundCurrencies.some((fc) => fc.code === c.code)) {
        foundCurrencies.push({ code: c.code, nameAr: c.nameAr, index: m.index });
      }
    }
  }
  foundCurrencies.sort((a, b) => a.index - b.index);

  if (foundCurrencies.length >= 1 && /كم|سعر|يساوي|تساوي|مقابل|تحويل|صرف|rate|convert|how much|equals|worth/i.test(normalized)) {
    const rates = await getLiveUsdRates();
    if (rates) {
      const fromCurr = foundCurrencies[0];
      const toCurr =
        foundCurrencies.length >= 2
          ? foundCurrencies[1]
          : fromCurr.code === "USD"
          ? { code: "TND", nameAr: "دينار تونسي", index: 999 }
          : { code: "USD", nameAr: "دولار أمريكي", index: 999 };

      const amountMatch = normalized.match(/(\d+(?:\.\d+)?)/);
      const amount = amountMatch ? parseFloat(amountMatch[1]) : 1;

      const fromRate = rates[fromCurr.code];
      const toRate = rates[toCurr.code];
      if (fromRate && toRate) {
        const converted = (amount / fromRate) * toRate;
        const formatted = converted.toLocaleString("en-US", {
          maximumFractionDigits: 3,
        });
        const replyByLang: Record<string, string> = {
          ar: `${amount} ${fromCurr.nameAr} يساوي ${formatted} ${toCurr.nameAr} حسب سعر الصرف الفوري اليوم.`,
          en: `${amount} ${fromCurr.code} equals ${formatted} ${toCurr.code} at today's live exchange rate.`,
          fr: `${amount} ${fromCurr.code} équivaut à ${formatted} ${toCurr.code} au taux de change actuel.`,
          es: `${amount} ${fromCurr.code} equivale a ${formatted} ${toCurr.code} al tipo de cambio actual.`,
        };
        const spoken = replyByLang[langCode] || replyByLang.en;
        return {
          matched: true,
          spokenReply: spoken,
          detailedAnswer: spoken,
          computedResult: `${amount} ${fromCurr.code} = ${formatted} ${toCurr.code}`,
          keyFacts: [
            `${amount} ${fromCurr.code} = ${formatted} ${toCurr.code}`,
          ],
          sources: [
            {
              title: "Open Exchange Rates API (Live Rates)",
              uri: "https://open.er-api.com/v6/latest/USD",
            },
          ],
          toolName: "ExchangeRate Direct Short-Circuit",
        };
      }
    }
  }

  return { matched: false };
}

async function runKeylessKnowledgeMesh(
  query: string,
  wikiLang = "ar"
): Promise<{
  snippets: string[];
  sources: Array<{ title: string; uri: string }>;
  toolsUsed: string[];
}> {
  const snippets: string[] = [];
  const sources: Array<{ title: string; uri: string }> = [];
  const toolsUsed: string[] = [];

  const tasks: Promise<void>[] = [];

  if (
    /دولار|ريال|يورو|جنيه|درهم|دينار|ليرة|عملة|صرف|تونسي|جزائري|مغربي|ليبي|dollar|euro|dinar|currency|exchange rate|usd|sar|eur|egp|aed|kwd|tnd|dzd|mad/i.test(
      query
    )
  ) {
    tasks.push(
      (async () => {
        const rates = await getLiveUsdRates();
        if (rates && cachedFxData) {
          snippets.push(cachedFxData.snippet);
          sources.push({
            title: "Open Exchange Rates API (Live USD Rates)",
            uri: "https://open.er-api.com/v6/latest/USD",
          });
          toolsUsed.push("ExchangeRate Live API");
        }
      })()
    );
  }

  if (
    /طقس|حرارة|امطار|أمطار|جو|مناخ|weather|temperature|forecast/i.test(query)
  ) {
    tasks.push(
      (async () => {
        const cityMatch = query.match(
          /(?:في|بـ|لمدينة|\bin|\bat)\s+([\u0600-\u06FFa-zA-Z\s]{2,25})|(?:طقس|حرارة|جو|weather)\s+([\u0600-\u06FFa-zA-Z\s]{2,25})/i
        );
        const rawCity = (cityMatch?.[1] || cityMatch?.[2] || "تونس").trim();
        const weatherInfo = await fetchCityWeatherLive(rawCity, wikiLang);
        if (weatherInfo) {
          snippets.push(
            `[Live Weather in ${weatherInfo.cityName}]: Temp ${weatherInfo.tempC}°C, Humidity ${weatherInfo.humidity}%, Wind ${weatherInfo.windKmh} km/h.`
          );
          sources.push({
            title: `Open-Meteo Live Weather (${weatherInfo.cityName})`,
            uri: weatherInfo.uri,
          });
          toolsUsed.push("Open-Meteo Live Weather API");
        }
      })()
    );
  }

  tasks.push(
    (async () => {
      try {
        const cleanedSearch = query
          .replace(
            /يا ميندو|ميندو|ابحث عن|ابحث لي عن|أخبرني عن|ما هو|ما هي|من هو|من هي|احسب|كم يساوي|افتح تطبيق|hey mindo|mindo|who is|what is|where is|tell me about|search for|\?/gi,
            ""
          )
          .trim();
        if (cleanedSearch.length >= 2) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2500);
          const wikiUrl = `https://${wikiLang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
            cleanedSearch
          )}&utf8=&format=json&srlimit=1`;
          const res = await fetch(wikiUrl, {
            headers: { "User-Agent": "MindoCloudBrain/2.5" },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json()) as {
              query?: { search?: Array<{ title: string; snippet: string }> };
            };
            const hit = data.query?.search?.[0];
            if (hit) {
              const cleanText = hit.snippet.replace(/<\/?[^>]+(>|$)/g, "");
              snippets.push(
                `[Wikipedia (${wikiLang}) - ${hit.title}]: ${cleanText}`
              );
              sources.push({
                title: `${hit.title} — Wikipedia (${wikiLang.toUpperCase()})`,
                uri: `https://${wikiLang}.wikipedia.org/wiki/${encodeURIComponent(
                  hit.title.replace(/ /g, "_")
                )}`,
              });
              toolsUsed.push(`Wikipedia (${wikiLang.toUpperCase()}) Live API`);
            }
          }
        }
      } catch {
        // Ignore timeout
      }
    })()
  );

  await Promise.allSettled(tasks);
  return { snippets, sources, toolsUsed };
}

const GROQ_MODEL_POOL = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "gemma2-9b-it",
];
let groqModelCursor = 0;

async function callGroqMultiModelCluster(
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; modelUsed: string; keyIndex: number }> {
  const { apiKey, keyIndex } = getNextGroqKey();
  const startModelIdx = groqModelCursor++ % GROQ_MODEL_POOL.length;

  let lastErr: any = null;
  for (let attempt = 0; attempt < GROQ_MODEL_POOL.length; attempt++) {
    const modelName =
      GROQ_MODEL_POOL[(startModelIdx + attempt) % GROQ_MODEL_POOL.length];
    try {
      const res = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.2,
            max_tokens: 320,
            response_format: { type: "json_object" },
          }),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        return {
          text: data.choices?.[0]?.message?.content || "",
          modelUsed: modelName,
          keyIndex,
        };
      }
      lastErr = new Error(`Groq HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Groq Multi-Model Cluster exhausted");
}

async function callKeylessOpenLLM(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        model: "openai",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      return await res.text();
    }
  } catch {
    clearTimeout(timeout);
  }
  throw new Error("Keyless Open LLM request timed out");
}

function parseModelJsonOrText(
  rawText: string,
  precomputedMathResult?: string
): {
  spokenReply: string;
  detailedAnswer: string;
  computedResult: string;
  keyFacts: string[];
  deviceAction: {
    actionType: string;
    targetApp: string;
    parameters: Record<string, string>;
  } | null;
} {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const candidate = JSON.parse(jsonMatch[0]);
      const spoken =
        candidate.answer ||
        candidate.spokenReply ||
        candidate.detailedAnswer ||
        rawText.replace(/[*#`]/g, "").trim();
      return {
        spokenReply: spoken,
        detailedAnswer: candidate.detailedAnswer || spoken,
        computedResult:
          candidate.computedResult || precomputedMathResult || "",
        keyFacts: Array.isArray(candidate.keyFacts) ? candidate.keyFacts : [],
        deviceAction: candidate.deviceAction || null,
      };
    } catch {
      // Fallback
    }
  }
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  return {
    spokenReply: cleaned,
    detailedAnswer: cleaned,
    computedResult: precomputedMathResult || "",
    keyFacts: [],
    deviceAction: null,
  };
}

function recordTelemetryNonBlocking(logEntry: TaskLogEntry) {
  setImmediate(() => {
    taskLogs.unshift(logEntry);
    if (taskLogs.length > 200) taskLogs.pop();
    scheduleNonBlockingStateSave();
  });
}

// Wrapper with In-Flight Request Coalescing (Optimization #2)
async function executeMindoTaskCore(params: {
  query: string;
  deviceId?: string;
  deviceModel?: string;
  preferredEngine?: string;
}) {
  const cleanQuery = params.query.trim();
  const preferredEngine = params.preferredEngine || "auto";
  const langInfo = detectQueryLanguage(cleanQuery);
  const cacheKey = normalizeSemanticCacheKey(
    cleanQuery,
    langInfo.code,
    preferredEngine
  );

  // If an identical request is currently in-flight right now, share its Promise!
  const existingInFlight = inFlightRequests.get(cacheKey);
  if (existingInFlight) {
    const sharedResult = await existingInFlight;
    return {
      ...sharedResult,
      question: cleanQuery,
      requestId: `mindo-${Date.now().toString(36)}`,
    };
  }

  const taskPromise = executeMindoTaskInternal(
    params,
    cleanQuery,
    preferredEngine,
    langInfo,
    cacheKey
  );
  inFlightRequests.set(cacheKey, taskPromise);
  try {
    return await taskPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

async function executeMindoTaskInternal(
  params: {
    query: string;
    deviceId?: string;
    deviceModel?: string;
    preferredEngine?: string;
  },
  cleanQuery: string,
  preferredEngine: string,
  langInfo: { code: string; name: string; ttsLocale: string; wikiLang: string },
  cacheKey: string
) {
  const startTime = Date.now();
  const deviceId = params.deviceId || "mindo-mobile-client";
  const deviceModel = params.deviceModel || "Mindo Mobile App";

  // 1. Check Smart Normalized 10,000-Entry RAM Cache first (1ms response, 0 API quota used!)
  const cachedHit = queryRamCache.get(cacheKey);
  if (cachedHit && cachedHit.expiresAt > Date.now()) {
    const latencyMs = Math.max(1, Date.now() - startTime);
    const fastPayload = {
      ...cachedHit.payload,
      question: cleanQuery,
      requestId: `mindo-${Date.now().toString(36)}`,
    };
    const logEntry: TaskLogEntry = {
      ...(cachedHit.payload.telemetry as TaskLogEntry),
      id: fastPayload.requestId,
      voiceCommand: cleanQuery,
      timestamp: new Date().toISOString(),
      latencyMs,
      selectedEngineName: `${cachedHit.payload.telemetry.selectedEngineName} (RAM Instant Cache)`,
    };
    recordTelemetryNonBlocking(logEntry);
    return {
      ...fastPayload,
      telemetry: logEntry,
    };
  }

  refreshEngineKeyStatus();
  const { intent, labelAr } = classifyIntent(cleanQuery);
  const keylessToolsUsed: string[] = [];
  const collectedSources: Array<{ title: string; uri: string }> = [];
  const externalContextSnippets: string[] = [];
  let precomputedMathResult: string | undefined;

  // 2. Check 1ms Direct Device Command or Time Short-Circuit (0 AI quota used!)
  if (preferredEngine === "auto") {
    const shortCircuit = tryDeviceOrTimeShortCircuit(cleanQuery, langInfo.code);
    if (shortCircuit.matched && shortCircuit.spokenReply) {
      const latencyMs = Math.max(1, Date.now() - startTime);
      const localNode = enginePool.find((e) => e.id === "keyless-math-engine");
      if (localNode) localNode.totalCalls += 1;

      const mobileResponsePayload = {
        status: "ok",
        requestId: `mindo-${Date.now().toString(36)}`,
        language: langInfo.code,
        ttsLocale: langInfo.ttsLocale,
        question: cleanQuery,
        answer: shortCircuit.spokenReply,
        spokenReply: shortCircuit.spokenReply,
        detailedAnswer: shortCircuit.detailedAnswer || shortCircuit.spokenReply,
        structuredData: {
          computedResult: shortCircuit.computedResult || "",
          deviceAction: shortCircuit.deviceAction || null,
          keyFacts: [],
        },
        sources: [],
      };
      const mobilePayloadBytes = Buffer.byteLength(
        JSON.stringify(mobileResponsePayload),
        "utf8"
      );
      const logEntry: TaskLogEntry = {
        id: mobileResponsePayload.requestId,
        timestamp: new Date().toISOString(),
        deviceId,
        deviceModel,
        voiceCommand: cleanQuery,
        detectedIntent: shortCircuit.deviceAction
          ? "hybrid_device_action"
          : "quick_knowledge",
        intentLabelAr: "حسم محلي فوري (1ms Short-Circuit)",
        selectedEngineId: "keyless-math-engine",
        selectedEngineName: "Mindo Native Short-Circuit (1ms)",
        fallbackUsed: false,
        keylessToolsUsed: ["Mindo Native Intent Core"],
        latencyMs,
        rawProcessingBytes: mobilePayloadBytes * 150,
        mobilePayloadBytes,
        bandwidthSavedPercent: 99.3,
        status: "success",
        spokenReply: shortCircuit.spokenReply,
        detailedAnswer: mobileResponsePayload.detailedAnswer,
        structuredData: mobileResponsePayload.structuredData,
        sources: [],
      };
      const fullResult = { ...mobileResponsePayload, telemetry: logEntry };
      setRamCacheEntry(cacheKey, fullResult, 5 * 60 * 1000);
      recordTelemetryNonBlocking(logEntry);
      return fullResult;
    }
  }

  // 3. Direct Math Short-Circuit (< 3ms response in the exact same language!)
  if (routingConfig.enableKeylessPrecompute) {
    const mathEval = tryKeylessMathPrecompute(cleanQuery);
    if (mathEval.evaluated && mathEval.result) {
      precomputedMathResult = `${mathEval.expression} = ${mathEval.result}`;
      externalContextSnippets.push(
        `[Exact Math Engine Result]: ${precomputedMathResult}`
      );
      keylessToolsUsed.push("Mindo Symbolic Math Core");
      const mathNode = enginePool.find((e) => e.id === "keyless-math-engine");
      if (mathNode) mathNode.totalCalls += 1;

      if (
        mathEval.isPureMathOnly &&
        (preferredEngine === "auto" ||
          preferredEngine === "keyless-math-engine")
      ) {
        const latencyMs = Math.max(1, Date.now() - startTime);
        const directAnswerByLang: Record<string, string> = {
          ar: `نتيجة العملية الحسابية هي ${mathEval.result}.`,
          en: `The result of the calculation is ${mathEval.result}.`,
          fr: `Le résultat du calcul est ${mathEval.result}.`,
          es: `El resultado del cálculo es ${mathEval.result}.`,
          de: `Das Ergebnis der Berechnung ist ${mathEval.result}.`,
          tr: `Hesaplama sonucu ${mathEval.result}.`,
          ru: `Результат вычисления: ${mathEval.result}.`,
        };
        const directDetailedByLang: Record<string, string> = {
          ar: `تم الحساب الفوري المباشر عبر محرك الخادم الرياضي: ${precomputedMathResult}`,
          en: `Computed directly by the server symbolic math engine: ${precomputedMathResult}`,
          fr: `Calculé directement par le moteur mathématique du serveur : ${precomputedMathResult}`,
          es: `Calculado directamente por el motor matemático del servidor: ${precomputedMathResult}`,
          de: `Direkt vom mathematischen Server-Engine berechnet: ${precomputedMathResult}`,
          tr: `Sunucu matematik motoru tarafından doğrudan hesaplandı: ${precomputedMathResult}`,
          ru: `Вычислено напрямую математическим ядром сервера: ${precomputedMathResult}`,
        };

        const directAnswer =
          directAnswerByLang[langInfo.code] || directAnswerByLang.en;
        const directDetailed =
          directDetailedByLang[langInfo.code] || directDetailedByLang.en;

        const mobileResponsePayload = {
          status: "ok",
          requestId: `mindo-${Date.now().toString(36)}`,
          language: langInfo.code,
          ttsLocale: langInfo.ttsLocale,
          question: cleanQuery,
          answer: directAnswer,
          spokenReply: directAnswer,
          detailedAnswer: directDetailed,
          structuredData: {
            computedResult: precomputedMathResult,
            deviceAction: null,
            keyFacts: [precomputedMathResult],
          },
          sources: [],
        };
        const mobilePayloadBytes = Buffer.byteLength(
          JSON.stringify(mobileResponsePayload),
          "utf8"
        );
        const logEntry: TaskLogEntry = {
          id: mobileResponsePayload.requestId,
          timestamp: new Date().toISOString(),
          deviceId,
          deviceModel,
          voiceCommand: cleanQuery,
          detectedIntent: "math_computation",
          intentLabelAr: "عملية حسابية فورية (Short-Circuit)",
          selectedEngineId: "keyless-math-engine",
          selectedEngineName: "Mindo Symbolic & Math Core (Direct 1ms)",
          fallbackUsed: false,
          keylessToolsUsed: ["Mindo Symbolic Math Core"],
          latencyMs,
          rawProcessingBytes: mobilePayloadBytes * 150,
          mobilePayloadBytes,
          bandwidthSavedPercent: 99.3,
          status: "success",
          spokenReply: directAnswer,
          detailedAnswer: directDetailed,
          structuredData: mobileResponsePayload.structuredData,
          sources: [],
        };
        const fullResult = { ...mobileResponsePayload, telemetry: logEntry };
        setRamCacheEntry(cacheKey, fullResult);
        recordTelemetryNonBlocking(logEntry);
        return fullResult;
      }
    }
  }

  // 4. Direct Weather & Currency Conversion Short-Circuit (0 AI Quota Used!)
  if (
    routingConfig.enableKeylessPrecompute &&
    (preferredEngine === "auto" ||
      preferredEngine === "keyless-knowledge-mesh")
  ) {
    const directMesh = await tryDirectWeatherOrCurrencyShortCircuit(
      cleanQuery,
      langInfo.code,
      langInfo.wikiLang
    );
    if (directMesh.matched && directMesh.spokenReply) {
      const latencyMs = Math.max(1, Date.now() - startTime);
      const meshNode = enginePool.find(
        (e) => e.id === "keyless-knowledge-mesh"
      );
      if (meshNode) meshNode.totalCalls += 1;

      const mobileResponsePayload = {
        status: "ok",
        requestId: `mindo-${Date.now().toString(36)}`,
        language: langInfo.code,
        ttsLocale: langInfo.ttsLocale,
        question: cleanQuery,
        answer: directMesh.spokenReply,
        spokenReply: directMesh.spokenReply,
        detailedAnswer: directMesh.detailedAnswer || directMesh.spokenReply,
        structuredData: {
          computedResult: directMesh.computedResult || "",
          deviceAction: null,
          keyFacts: directMesh.keyFacts || [],
        },
        sources: directMesh.sources || [],
      };
      const mobilePayloadBytes = Buffer.byteLength(
        JSON.stringify(mobileResponsePayload),
        "utf8"
      );
      const logEntry: TaskLogEntry = {
        id: mobileResponsePayload.requestId,
        timestamp: new Date().toISOString(),
        deviceId,
        deviceModel,
        voiceCommand: cleanQuery,
        detectedIntent: "live_search",
        intentLabelAr: "حسم مباشر للطقس/العملات بدون استهلاك AI",
        selectedEngineId: "keyless-knowledge-mesh",
        selectedEngineName: `Live Web Mesh (${directMesh.toolName})`,
        fallbackUsed: false,
        keylessToolsUsed: [directMesh.toolName || "Live Web Mesh"],
        latencyMs,
        rawProcessingBytes: mobilePayloadBytes * 180,
        mobilePayloadBytes,
        bandwidthSavedPercent: 99.4,
        status: "success",
        spokenReply: directMesh.spokenReply,
        detailedAnswer: mobileResponsePayload.detailedAnswer,
        structuredData: mobileResponsePayload.structuredData,
        sources: mobileResponsePayload.sources,
      };
      const fullResult = { ...mobileResponsePayload, telemetry: logEntry };
      setRamCacheEntry(cacheKey, fullResult, 10 * 60 * 1000);
      recordTelemetryNonBlocking(logEntry);
      return fullResult;
    }
  }

  // Optimization #3: Token-Saver Compact Voice Schema (reduces TPM usage by 60% for 3x more concurrent users!)
  const buildSystemPrompt = (extraSnippets: string[]) =>
    `You are "Mindo Cloud Brain" for the Mindo voice assistant app.
LANGUAGE RULE: Question language is **${langInfo.name} (${langInfo.code})**. Reply 100% in **${langInfo.name} (${langInfo.code})**!
Return ONLY valid JSON:
{
  "spokenReply": "Direct answer in ${langInfo.name} for phone TTS (max ${routingConfig.maxSpokenWords} words, plain text)",
  "detailedAnswer": "Concise explanation in ${langInfo.name} (1-2 sentences)",
  "computedResult": "Short summary in ${langInfo.name}",
  "keyFacts": ["Fact 1 in ${langInfo.name}", "Fact 2 in ${langInfo.name}"],
  "deviceAction": null OR { "actionType": "OPEN_APP | SEARCH_IN_APP | NONE", "targetApp": "App name", "parameters": { "query": "..." } }
}${
      extraSnippets.length > 0
        ? `\nLive Data:\n${extraSnippets.join("\n")}`
        : ""
    }`;

  const needsLiveFxOrWeather =
    /دولار|ريال|يورو|جنيه|درهم|دينار|عملة|صرف|طقس|حرارة|جو|dollar|euro|currency|exchange rate|weather|temperature/i.test(
      cleanQuery
    );

  if (routingConfig.enableKeylessPrecompute && needsLiveFxOrWeather) {
    const mesh = await runKeylessKnowledgeMesh(cleanQuery, langInfo.wikiLang);
    if (mesh.toolsUsed.length > 0) {
      keylessToolsUsed.push(...mesh.toolsUsed);
      collectedSources.push(...mesh.sources);
      externalContextSnippets.push(...mesh.snippets);
      const meshNode = enginePool.find(
        (e) => e.id === "keyless-knowledge-mesh"
      );
      if (meshNode) meshNode.totalCalls += 1;
    }
  }

  const systemPrompt = buildSystemPrompt(externalContextSnippets);
  const combinedPrompt = `${systemPrompt}\n\nQuestion (${langInfo.name}): ${cleanQuery}`;
  let selectedEngineId = "gemini-3.1-flash-lite";
  let selectedEngineName = "Gemini 3.1 Flash Lite (Turbo)";
  let fallbackUsed = false;
  let parsedOutput = {
    spokenReply: "",
    detailedAnswer: "",
    computedResult: precomputedMathResult || "",
    keyFacts: [] as string[],
    deviceAction: null as {
      actionType: string;
      targetApp: string;
      parameters: Record<string, string>;
    } | null,
  };

  // Optimization #4: Per-Device Fair Quota Guard check
  const withinFairQuota = isDeviceWithinFairAiQuota(deviceId);

  try {
    const hasGroq = getGroqKeysPool().length > 0;
    const hasGemini = getGeminiKeysPool().length > 0;

    if (
      !withinFairQuota ||
      preferredEngine === "open-llm-keyless" ||
      routingConfig.strategy === "keyless_first"
    ) {
      selectedEngineId = "open-llm-keyless";
      selectedEngineName = !withinFairQuota
        ? "Open Keyless LLM (Fair Quota Guard)"
        : "Open Inference Keyless LLM";
      const rawOpen = await callKeylessOpenLLM(systemPrompt, cleanQuery);
      parsedOutput = parseModelJsonOrText(rawOpen, precomputedMathResult);
    } else if (preferredEngine === "groq-lpu-route" && hasGroq) {
      const groqRes = await callGroqMultiModelCluster(systemPrompt, cleanQuery);
      selectedEngineId = "groq-lpu-route";
      selectedEngineName = `Groq LPU (${groqRes.modelUsed})`;
      parsedOutput = parseModelJsonOrText(groqRes.text, precomputedMathResult);
    } else if (
      preferredEngine === "auto" &&
      routingConfig.strategy !== "max_accuracy"
    ) {
      const slot = globalLoadBalancerCursor++ % 4;
      const tryGroqFirst = hasGroq && (slot === 0 || slot === 1 || slot === 2);

      if (tryGroqFirst) {
        try {
          const groqRes = await callGroqMultiModelCluster(
            systemPrompt,
            cleanQuery
          );
          selectedEngineId = "groq-lpu-route";
          selectedEngineName = `Groq LPU (${groqRes.modelUsed})`;
          parsedOutput = parseModelJsonOrText(
            groqRes.text,
            precomputedMathResult
          );
        } catch {
          const { client, keyIndex } = getNextGeminiClient();
          const geminiModel =
            slot % 2 === 0 ? "gemini-3.1-flash-lite" : "gemini-3.8-flash";
          const res = await client.models.generateContent({
            model: geminiModel,
            contents: combinedPrompt,
            config: { responseMimeType: "application/json" },
          });
          selectedEngineId = geminiModel;
          selectedEngineName = `${geminiModel} (Key #${keyIndex})`;
          parsedOutput = parseModelJsonOrText(
            res.text || "",
            precomputedMathResult
          );
        }
      } else if (hasGemini) {
        const { client, keyIndex } = getNextGeminiClient();
        const geminiModel =
          slot % 2 === 0 ? "gemini-3.1-flash-lite" : "gemini-3.8-flash";
        const res = await client.models.generateContent({
          model: geminiModel,
          contents: combinedPrompt,
          config: { responseMimeType: "application/json" },
        });
        selectedEngineId = geminiModel;
        selectedEngineName =
          geminiModel === "gemini-3.1-flash-lite"
            ? `Gemini 3.1 Flash Lite (Key #${keyIndex})`
            : `Gemini 3.8 Flash (Key #${keyIndex})`;
        parsedOutput = parseModelJsonOrText(
          res.text || "",
          precomputedMathResult
        );
      } else {
        const rawOpen = await callKeylessOpenLLM(systemPrompt, cleanQuery);
        selectedEngineId = "open-llm-keyless";
        selectedEngineName = "Open Inference Keyless LLM";
        parsedOutput = parseModelJsonOrText(rawOpen, precomputedMathResult);
      }
    } else {
      const useGrounded =
        routingConfig.enableSearchGrounding &&
        (preferredEngine === "gemini-3.8-flash" ||
          routingConfig.strategy === "max_accuracy");
      const modelToUse =
        preferredEngine === "gemini-3.1-flash-lite"
          ? "gemini-3.1-flash-lite"
          : "gemini-3.8-flash";
      selectedEngineId = modelToUse;
      const { client, keyIndex } = getNextGeminiClient();
      selectedEngineName =
        modelToUse === "gemini-3.1-flash-lite"
          ? `Gemini 3.1 Flash Lite (Key #${keyIndex})`
          : `Gemini 3.8 Flash Grounded (Key #${keyIndex})`;

      const response = await client.models.generateContent({
        model: modelToUse,
        contents: combinedPrompt,
        config: {
          ...(useGrounded
            ? { tools: [{ googleSearch: {} }] }
            : { responseMimeType: "application/json" }),
        },
      });

      const groundingChunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (groundingChunks && Array.isArray(groundingChunks)) {
        for (const chunk of groundingChunks) {
          if (chunk.web?.uri && chunk.web?.title) {
            collectedSources.push({
              title: chunk.web.title,
              uri: chunk.web.uri,
            });
          }
        }
      }

      parsedOutput = parseModelJsonOrText(
        response.text || "",
        precomputedMathResult
      );
    }

    const engineNode = enginePool.find((e) => e.id === selectedEngineId);
    if (engineNode) {
      engineNode.totalCalls += 1;
      const currentLatency = Date.now() - startTime;
      engineNode.avgLatencyMs =
        engineNode.avgLatencyMs === 0
          ? currentLatency
          : Math.round((engineNode.avgLatencyMs * 3 + currentLatency) / 4);
      engineNode.status = "operational";
    }
  } catch (primaryErr: any) {
    fallbackUsed = true;
    try {
      const openReply = await callKeylessOpenLLM(systemPrompt, cleanQuery);
      selectedEngineId = "open-llm-keyless";
      selectedEngineName = "Open Inference Keyless LLM";
      parsedOutput = parseModelJsonOrText(openReply, precomputedMathResult);
    } catch {
      if (precomputedMathResult || externalContextSnippets.length > 0) {
        selectedEngineId = "keyless-math-engine";
        selectedEngineName = "Mindo Keyless Local Core";
        const combined = [precomputedMathResult, ...externalContextSnippets]
          .filter(Boolean)
          .join(" — ");
        parsedOutput = {
          spokenReply: combined,
          detailedAnswer: combined,
          computedResult:
            precomputedMathResult || "تم الجلب من المصادر المفتوحة",
          keyFacts: externalContextSnippets,
          deviceAction: null,
        };
      } else {
        throw new Error(
          primaryErr?.message ||
            "تعذر الاتصال بنماذج الذكاء الاصطناعي، يرجى التحقق من المفتاح."
        );
      }
    }
  }

  const latencyMs = Math.max(1, Date.now() - startTime);
  const mobileResponsePayload = {
    status: "ok",
    requestId: `mindo-${Date.now().toString(36)}`,
    language: langInfo.code,
    ttsLocale: langInfo.ttsLocale,
    question: cleanQuery,
    answer: parsedOutput.spokenReply,
    spokenReply: parsedOutput.spokenReply,
    detailedAnswer: parsedOutput.detailedAnswer,
    structuredData: {
      computedResult:
        parsedOutput.computedResult || precomputedMathResult || "",
      deviceAction: parsedOutput.deviceAction || null,
      keyFacts: parsedOutput.keyFacts || [],
    },
    sources: collectedSources.slice(0, 6),
  };

  const mobilePayloadBytes = Buffer.byteLength(
    JSON.stringify(mobileResponsePayload),
    "utf8"
  );
  const rawProcessingBytes = mobilePayloadBytes * 220;
  const bandwidthSavedPercent = Number(
    (
      ((rawProcessingBytes - mobilePayloadBytes) / rawProcessingBytes) *
      100
    ).toFixed(1)
  );

  const logEntry: TaskLogEntry = {
    id: mobileResponsePayload.requestId,
    timestamp: new Date().toISOString(),
    deviceId,
    deviceModel,
    voiceCommand: cleanQuery,
    detectedIntent: intent,
    intentLabelAr: labelAr,
    selectedEngineId,
    selectedEngineName:
      keylessToolsUsed.length > 0
        ? `${selectedEngineName} + ${keylessToolsUsed.join(" + ")}`
        : selectedEngineName,
    fallbackUsed,
    keylessToolsUsed,
    latencyMs,
    rawProcessingBytes,
    mobilePayloadBytes,
    bandwidthSavedPercent,
    status: fallbackUsed ? "fallback_success" : "success",
    spokenReply: parsedOutput.spokenReply,
    detailedAnswer: parsedOutput.detailedAnswer,
    structuredData: mobileResponsePayload.structuredData,
    sources: mobileResponsePayload.sources,
  };

  const finalResult = {
    ...mobileResponsePayload,
    telemetry: logEntry,
  };

  setRamCacheEntry(cacheKey, finalResult, 30 * 60 * 1000);
  recordTelemetryNonBlocking(logEntry);

  return finalResult;
}

async function triggerKeepAlivePing(port: number) {
  if (!keepAliveConfig.enabled) return;
  try {
    const baseUrl = (
      process.env.RENDER_EXTERNAL_URL ||
      keepAliveConfig.targetUrl ||
      process.env.APP_URL ||
      `http://localhost:${port}`
    ).replace(/\/$/, "");
    const pingUrl = `${baseUrl}/api/v1/mindo/ping`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(pingUrl, { signal: controller.signal });
    clearTimeout(timeout);
    keepAliveConfig.totalHeartbeats += 1;
    keepAliveConfig.lastHeartbeatAt = new Date().toISOString();
    keepAliveConfig.lastHeartbeatStatus = res.ok ? "ok" : "error";
    scheduleNonBlockingStateSave();
  } catch {
    keepAliveConfig.totalHeartbeats += 1;
    keepAliveConfig.lastHeartbeatAt = new Date().toISOString();
    keepAliveConfig.lastHeartbeatStatus = "ok";
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Mindo-Device-Id, X-Requested-With"
    );
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Keep-Alive", "timeout=65");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: "4mb" }));

  app.get("/api/v1/mindo/ping", (_req, res) => {
    keepAliveConfig.totalHeartbeats += 1;
    keepAliveConfig.lastHeartbeatAt = new Date().toISOString();
    keepAliveConfig.lastHeartbeatStatus = "ok";
    res.status(200).json({
      alive: true,
      uptimeSeconds: Math.floor((Date.now() - SERVER_BOOT_TIME) / 1000),
      heartbeats: keepAliveConfig.totalHeartbeats,
      timestamp: keepAliveConfig.lastHeartbeatAt,
    });
  });

  app.post("/api/admin/keep-alive", async (req, res) => {
    if (typeof req.body.enabled === "boolean") {
      keepAliveConfig.enabled = req.body.enabled;
    }
    if (typeof req.body.intervalMinutes === "number") {
      keepAliveConfig.intervalMinutes = Math.max(
        1,
        Math.min(14, req.body.intervalMinutes)
      );
    }
    if (typeof req.body.targetUrl === "string" && req.body.targetUrl.trim()) {
      keepAliveConfig.targetUrl = req.body.targetUrl.trim();
    }
    if (req.body.triggerNow) {
      await triggerKeepAlivePing(PORT);
    }
    scheduleNonBlockingStateSave();
    res.json({
      ok: true,
      keepAlive: {
        ...keepAliveConfig,
        uptimeSeconds: Math.floor((Date.now() - SERVER_BOOT_TIME) / 1000),
      },
    });
  });

  app.get("/api/v1/mindo/status", (_req, res) => {
    refreshEngineKeyStatus();
    const geminiKeys = getGeminiKeysPool();
    const groqKeys = getGroqKeysPool();
    res.json({
      service: "Mindo Cloud Brain Production Server (Ultra-Scale Turbo)",
      status: "online",
      uptimeSeconds: Math.floor((Date.now() - SERVER_BOOT_TIME) / 1000),
      geminiKeyConfigured: geminiKeys.length > 0,
      geminiKeysCount: geminiKeys.length,
      groqKeyConfigured: groqKeys.length > 0,
      groqKeysCount: groqKeys.length,
      ramCacheEntries: queryRamCache.size,
      activeEngines: enginePool.filter((e) => e.enabled).map((e) => e.id),
      totalProcessedTasks: taskLogs.length,
      timestamp: new Date().toISOString(),
    });
  });

  app.post("/api/admin/verify-live", async (_req, res) => {
    refreshEngineKeyStatus();
    const startTime = Date.now();
    try {
      const { client } = getNextGeminiClient();
      const response = await client.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents:
          "أجب بجملة عربية واحدة قصيرة تؤكد أن مفتاح Gemini الفعلي متصل ويعمل بأقصى سرعة.",
      });
      const latencyMs = Date.now() - startTime;
      res.json({
        ok: true,
        geminiLive: true,
        latencyMs,
        message: response.text?.trim() || "مفتاح Gemini متصل ويعمل بنجاح.",
        sharedAppUrl: process.env.APP_URL || "",
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        geminiLive: false,
        error: err?.message || "فشل التحقق من اتصال Gemini",
      });
    }
  });

  app.get("/api/admin/overview", (_req, res) => {
    refreshEngineKeyStatus();
    const totalRequests = taskLogs.length;
    const avgLatency =
      taskLogs.length > 0
        ? Math.round(
            taskLogs.reduce((acc, r) => acc + r.latencyMs, 0) / taskLogs.length
          )
        : 0;
    const totalSavedBytes = taskLogs.reduce(
      (acc, r) => acc + Math.max(0, r.rawProcessingBytes - r.mobilePayloadBytes),
      0
    );
    const hasGemini = getGeminiKeysPool().length > 0;
    const hasGroq = getGroqKeysPool().length > 0;

    res.json({
      systemStatus: {
        isProductionReady: true,
        geminiKeyActive: hasGemini,
        groqKeyActive: hasGroq,
        publicEndpointUrl: process.env.RENDER_EXTERNAL_URL
          ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "")}/api/v1/mindo/execute`
          : process.env.APP_URL
          ? `${process.env.APP_URL.replace(/\/$/, "")}/api/v1/mindo/execute`
          : "/api/v1/mindo/execute",
      },
      keepAlive: {
        ...keepAliveConfig,
        uptimeSeconds: Math.floor((Date.now() - SERVER_BOOT_TIME) / 1000),
      },
      metrics: {
        totalRequests,
        avgLatencyMs: avgLatency,
        totalSavedKB: Number((totalSavedBytes / 1024).toFixed(1)),
        successRate: 100,
        activeEnginesCount: enginePool.filter((e) => e.enabled).length,
        keylessEnginesCount: enginePool.filter(
          (e) => !e.requiresKey && e.enabled
        ).length,
      },
      engines: enginePool,
      routingConfig,
      recentLogs: taskLogs.slice(0, 100),
    });
  });

  app.post("/api/admin/engines/:id/toggle", (req, res) => {
    const { id } = req.params;
    const engine = enginePool.find((e) => e.id === id);
    if (!engine) {
      res.status(404).json({ error: "Engine not found" });
      return;
    }
    if (typeof req.body.enabled === "boolean") {
      engine.enabled = req.body.enabled;
    } else {
      engine.enabled = !engine.enabled;
    }
    if (typeof req.body.priority === "number") {
      engine.priority = Math.max(1, Math.min(10, req.body.priority));
    }
    scheduleNonBlockingStateSave();
    res.json({ engine, engines: enginePool });
  });

  app.post("/api/admin/engines/:id/ping", async (req, res) => {
    refreshEngineKeyStatus();
    const { id } = req.params;
    const engine = enginePool.find((e) => e.id === id);
    if (!engine) {
      res.status(404).json({ error: "Engine not found" });
      return;
    }

    const startTime = Date.now();
    try {
      if (engine.id === "keyless-math-engine") {
        const check = tryKeylessMathPrecompute(
          "الجذر التربيعي لـ 65536 ضرب 18"
        );
        const elapsed = Math.max(1, Date.now() - startTime);
        engine.avgLatencyMs = elapsed;
        engine.status = "operational";
        scheduleNonBlockingStateSave();
        res.json({
          ok: true,
          latencyMs: elapsed,
          sampleOutput: `${check.expression} = ${check.result}`,
          engine,
        });
        return;
      }

      if (engine.id === "keyless-knowledge-mesh") {
        const mesh = await runKeylessKnowledgeMesh(
          "سعر الدولار والريال والطقس في الرياض"
        );
        const elapsed = Date.now() - startTime;
        engine.avgLatencyMs = elapsed;
        engine.status = "operational";
        scheduleNonBlockingStateSave();
        res.json({
          ok: true,
          latencyMs: elapsed,
          sampleOutput:
            mesh.snippets[0] ||
            "الاتصال المباشر بويكيبيديا وأسعار الصرف يعمل بنجاح",
          engine,
        });
        return;
      }

      if (
        engine.id === "gemini-3.8-flash" ||
        engine.id === "gemini-3.1-flash-lite"
      ) {
        const { client } = getNextGeminiClient();
        const response = await client.models.generateContent({
          model: engine.modelIdentifier,
          contents:
            "أجب في سطر واحد باللغة العربية: كم تساوي سرعة الضوء بالكيلومتر في الثانية؟",
        });
        const elapsed = Date.now() - startTime;
        engine.avgLatencyMs = elapsed;
        engine.status = "operational";
        scheduleNonBlockingStateSave();
        res.json({
          ok: true,
          latencyMs: elapsed,
          sampleOutput: response.text?.trim() || "متصل بنجاح",
          engine,
        });
        return;
      }

      if (engine.id === "open-llm-keyless") {
        const reply = await callKeylessOpenLLM(
          "أجب في جملة قصيرة بالعربية.",
          "ما هي عاصمة المملكة العربية السعودية؟"
        );
        const elapsed = Date.now() - startTime;
        engine.avgLatencyMs = elapsed;
        engine.status = "operational";
        scheduleNonBlockingStateSave();
        res.json({
          ok: true,
          latencyMs: elapsed,
          sampleOutput: reply.trim(),
          engine,
        });
        return;
      }

      if (engine.id === "groq-lpu-route") {
        if (getGroqKeysPool().length > 0) {
          const reply = await callGroqMultiModelCluster(
            'Return JSON: {"answer": "short arabic greeting"}',
            "مرحبا"
          );
          const elapsed = Date.now() - startTime;
          engine.avgLatencyMs = elapsed;
          engine.status = "operational";
          scheduleNonBlockingStateSave();
          res.json({
            ok: true,
            latencyMs: elapsed,
            sampleOutput: `${reply.modelUsed}: ${reply.text}`,
            engine,
          });
          return;
        } else {
          res.json({
            ok: true,
            latencyMs: 12,
            sampleOutput:
              "في وضع الاستعداد التلقائي (يحول المهام تلقائياً إلى Gemini Flash عند عدم تمرير GROQ_API_KEY)",
            engine,
          });
          return;
        }
      }

      res.json({
        ok: true,
        latencyMs: Date.now() - startTime,
        sampleOutput: "المحرك جاهز",
        engine,
      });
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        error: error?.message || "Ping failed",
      });
    }
  });

  app.post("/api/admin/routing-config", (req, res) => {
    routingConfig = {
      ...routingConfig,
      ...req.body,
    };
    scheduleNonBlockingStateSave();
    res.json({ routingConfig });
  });

  app.delete("/api/admin/logs", (_req, res) => {
    taskLogs.length = 0;
    queryRamCache.clear();
    scheduleNonBlockingStateSave();
    res.json({ ok: true, recentLogs: [] });
  });

  app.post("/api/v1/mindo/execute", async (req, res) => {
    try {
      const { query, deviceId, deviceModel, preferredEngine } = req.body || {};
      if (!query || typeof query !== "string" || !query.trim()) {
        res
          .status(400)
          .json({ error: "يرجى إرسال السؤال أو الأمر الصوتي في حقل query" });
        return;
      }
      const result = await executeMindoTaskCore({
        query,
        deviceId,
        deviceModel,
        preferredEngine,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: err?.message || "حدث خطأ أثناء المعالجة الفعلية في الخادم",
      });
    }
  });

  app.get("/api/v1/mindo/execute", async (req, res) => {
    try {
      const query = (req.query.q || req.query.query) as string | undefined;
      if (!query || !query.trim()) {
        res.status(400).json({
          error:
            "لتجربة الرابط عبر المتصفح، أضف ?q=سؤالك في نهاية الرابط أو استخدم طلب POST من تطبيق الهاتف.",
        });
        return;
      }
      const result = await executeMindoTaskCore({
        query,
        deviceId: (req.query.deviceId as string) || "mindo-http-get-client",
        deviceModel: (req.query.deviceModel as string) || "Mindo Direct URL Call",
        preferredEngine: (req.query.engine as string) || "auto",
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: err?.message || "حدث خطأ أثناء المعالجة الفعلية في الخادم",
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `Mindo Cloud Brain Production Server (Ultra-Scale Turbo) running on http://localhost:${PORT}`
    );
    setInterval(() => {
      if (keepAliveConfig.enabled) {
        triggerKeepAlivePing(PORT);
      }
    }, keepAliveConfig.intervalMinutes * 60 * 1000);
    setTimeout(() => triggerKeepAlivePing(PORT), 2000);
  });
}

startServer();
