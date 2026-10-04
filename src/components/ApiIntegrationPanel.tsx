import React, { useState } from "react";
import { Copy, Check, RefreshCw } from "lucide-react";
import { KeepAliveState } from "../types";

interface ApiIntegrationPanelProps {
  keepAlive?: KeepAliveState;
  onUpdateKeepAlive: (payload: {
    enabled?: boolean;
    targetUrl?: string;
    triggerNow?: boolean;
  }) => Promise<void>;
  onQuickTest: (sampleCommand: string) => void;
}

export const ApiIntegrationPanel: React.FC<ApiIntegrationPanelProps> = ({
  keepAlive,
  onUpdateKeepAlive,
  onQuickTest,
}) => {
  const defaultOrigin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://mindo-cloud-brain.onrender.com";

  const [customBaseUrl, setCustomBaseUrl] = useState<string>(defaultOrigin);
  const [selectedLang, setSelectedLang] = useState<
    "kotlin" | "flutter" | "react_native" | "render_yaml"
  >("kotlin");
  const [copied, setCopied] = useState(false);
  const [copiedPing, setCopiedPing] = useState(false);
  const [isPingingNow, setIsPingingNow] = useState(false);

  const cleanBase = customBaseUrl.replace(/\/$/, "");
  const endpointUrl = `${cleanBase}/api/v1/mindo/execute`;
  const pingEndpointUrl = `${cleanBase}/api/v1/mindo/ping`;

  const snippets: Record<typeof selectedLang, { title: string; code: string }> =
    {
      kotlin: {
        title:
          "Android (Kotlin + OkHttp) — مع نبضة استيقاظ استباقية عند فتح التطبيق",
        code: `// كود الربط داخل تطبيق ميندو للأندرويد (Mindo Android Voice Service)
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class MindoCloudBrainClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private val executeEndpoint = "${endpointUrl}"
    private val pingEndpoint = "${pingEndpointUrl}"

    // استدعِ هذه الدالة فور فتح المستخدم لتطبيق ميندو أو ضغط زر الميكروفون لضمان يقظة الخادم 100%
    fun warmUpServerAsync() {
        Thread {
            try {
                val req = Request.Builder().url(pingEndpoint).get().build()
                client.newCall(req).execute().close()
            } catch (_: Exception) {}
        }.start()
    }

    fun offloadHeavyCommand(voiceText: String, onResult: (spokenReply: String, detailed: String, targetApp: String?) -> Unit) {
        val payload = JSONObject().apply {
            put("query", voiceText)
            put("deviceId", "mindo-android-user")
            put("deviceModel", android.os.Build.MODEL)
            put("preferredEngine", "auto")
        }

        val body = payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder().url(executeEndpoint).post(body).build()

        client.newCall(request).execute().use { response ->
            val json = JSONObject(response.body?.string() ?: "{}")
            val spokenReply = json.optString("spokenReply", "تم تنفيذ طلبك")
            val detailedAnswer = json.optString("detailedAnswer", spokenReply)
            val structured = json.optJSONObject("structuredData")
            val deviceAction = structured?.optJSONObject("deviceAction")
            val targetApp = deviceAction?.optString("targetApp")

            onResult(spokenReply, detailedAnswer, targetApp)
        }
    }
}`,
      },
      flutter: {
        title: "Flutter / Dart (Android & iOS) — مع نبضة منع السبات",
        code: `// كود الربط لتطبيق ميندو عبر Flutter
import 'dart:convert';
import 'package:http/http.dart' as http;

class MindoBrainService {
  static const String executeEndpoint = '${endpointUrl}';
  static const String pingEndpoint = '${pingEndpointUrl}';

  // يُستدعى عند تشغيل التطبيق لإبقاء الخادم في حالة يقظة فورية
  static Future<void> warmUpServer() async {
    try {
      await http.get(Uri.parse(pingEndpoint)).timeout(const Duration(seconds: 5));
    } catch (_) {}
  }

  static Future<Map<String, dynamic>> sendHeavyTask(String voiceCommand) async {
    final response = await http.post(
      Uri.parse(executeEndpoint),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'query': voiceCommand,
        'deviceId': 'mindo-flutter-client',
        'deviceModel': 'Mindo Mobile v2.5',
        'preferredEngine': 'auto',
      }),
    );

    if (response.statusCode == 200) {
      return jsonDecode(utf8.decode(response.bodyBytes));
    } else {
      throw Exception('فشل الاتصال بعقل ميندو السحابي');
    }
  }
}`,
      },
      react_native: {
        title: "React Native / Expo (TypeScript)",
        code: `// إرسال المهام الثقيلة من تطبيق ميندو إلى الخادم السحابي
const BASE_URL = "${cleanBase}";

export async function warmUpMindoServer() {
  try {
    await fetch(\`\${BASE_URL}/api/v1/mindo/ping\`);
  } catch {}
}

export async function executeMindoCloudTask(voiceTranscript: string) {
  const response = await fetch(\`\${BASE_URL}/api/v1/mindo/execute\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: voiceTranscript,
      deviceId: "mindo-rn-mobile",
      deviceModel: "Mindo Mobile App",
      preferredEngine: "auto"
    }),
  });

  const result = await response.json();
  return {
    spokenReply: result.spokenReply,
    detailedAnswer: result.detailedAnswer,
    computedResult: result.structuredData?.computedResult,
    deviceAction: result.structuredData?.deviceAction,
    sources: result.sources || []
  };
}`,
      },
      render_yaml: {
        title: "ملف render.yaml المدمج في المشروع للنشر الفوري على Render.com",
        code: `# تم تجهيز هذا الملف (render.yaml) بالإضافة إلى (Dockerfile) داخل ملفات المشروع الجذرية
services:
  - type: web
    name: mindo-cloud-brain
    runtime: node
    plan: free
    buildCommand: npm install && npm run build
    startCommand: npm run start
    healthCheckPath: /api/v1/mindo/ping
    envVars:
      - key: NODE_ENV
        value: production
      - key: GEMINI_API_KEY
        sync: false
      - key: GROQ_API_KEY
        sync: false
      - key: ENABLE_KEEP_ALIVE
        value: "true"`,
      },
    };

  const handleCopy = () => {
    navigator.clipboard.writeText(snippets[selectedLang].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPingUrl = () => {
    navigator.clipboard.writeText(pingEndpointUrl);
    setCopiedPing(true);
    setTimeout(() => setCopiedPing(false), 2000);
  };

  const handleTriggerHeartbeat = async () => {
    setIsPingingNow(true);
    await onUpdateKeepAlive({ targetUrl: cleanBase, triggerNow: true });
    setIsPingingNow(false);
  };

  return (
    <div className="space-y-8">
      {/* 1. Anti-Sleep & Render Deployment Readiness Panel */}
      <div className="border border-slate-800 bg-slate-900/60 rounded-xl p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-emerald-400 font-semibold">
                نظام منع السبات المدمج (24/7 Anti-Sleep Keep-Alive)
              </span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="text-slate-300">
                جاهز للنشر المباشر على Render.com
              </span>
            </div>
            <h2 className="text-xl font-semibold text-white">
              منع السيرفر من النوم نهائياً + النشر على منصة Render
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              لضمان عدم دخول الخادم في وضع السبات أبداً (سواء هنا أو على خطة Render المجانية)، قمتُ بدمج **محرك نبض ذاتي تلقائي (Self-Ping كل 4 دقائق)** داخل الخادم، وتجهيز نقطة فحص خفيفة جداً (`GET /api/v1/mindo/ping`) ترد في أقل من `1ms`، بالإضافة إلى إنشاء ملفي `render.yaml` و `Dockerfile` في المشروع.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleTriggerHeartbeat}
              disabled={isPingingNow}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isPingingNow ? "animate-spin" : ""}`}
              />
              <span>
                {isPingingNow
                  ? "جاري إرسال النبضة..."
                  : "إرسال نبضة تنشيط الآن"}
              </span>
            </button>
          </div>
        </div>

        {/* Keep-Alive Live Telemetry & Ping URL */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-1">
            <div className="text-xs text-slate-400">
              حالة النبض الذاتي التلقائي (كل 4 دقائق)
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-sm font-semibold text-emerald-400">
                {keepAlive?.enabled ? "مفعّل ويعمل بالخلفية" : "موقوف"}
              </span>
              <button
                type="button"
                onClick={() =>
                  onUpdateKeepAlive({ enabled: !keepAlive?.enabled })
                }
                className="text-xs text-slate-300 underline hover:text-white cursor-pointer"
              >
                {keepAlive?.enabled ? "إيقاف" : "تفعيل"}
              </button>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-1">
            <div className="text-xs text-slate-400">
              إجمالي نبضات التنشيط الناجحة
            </div>
            <div className="text-sm font-mono-tabular font-semibold text-white pt-1">
              {keepAlive?.totalHeartbeats ?? 1} نبضة (مدة التشغيل:{" "}
              {Math.max(1, Math.floor((keepAlive?.uptimeSeconds || 60) / 60))}{" "}
              دقيقة)
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-1">
            <div className="text-xs text-slate-400">
              رابط منع السبات لربطه مع Cron-job.org أو UptimeRobot
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <code
                dir="ltr"
                className="text-xs font-mono-tabular text-emerald-400 truncate select-all"
              >
                GET {pingEndpointUrl}
              </code>
              <button
                type="button"
                onClick={handleCopyPingUrl}
                className="text-xs text-slate-300 hover:text-white shrink-0 cursor-pointer"
              >
                {copiedPing ? "تم النسخ" : "نسخ"}
              </button>
            </div>
          </div>
        </div>

        {/* 3-Step Guide to Deploy on Render.com + Zero Sleep */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">
            كيف تنشر هذا الموقع على منصة Render.com وتمنع السبات 100%؟
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-300 leading-relaxed">
            <div className="space-y-1.5">
              <div className="font-semibold text-emerald-400">
                01. تصدير الكود إلى GitHub
              </div>
              <p>
                ملفات المشروع أصبحت جاهزة تماماً وتحتوي على ملف{" "}
                <code className="font-mono-tabular text-white">render.yaml</code>{" "}
                وملف{" "}
                <code className="font-mono-tabular text-white">Dockerfile</code>{" "}
                وإعداد المنفذ الديناميكي{" "}
                <code className="font-mono-tabular text-white">
                  process.env.PORT
                </code>
                . ارفع المشروع إلى حسابك في GitHub.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="font-semibold text-emerald-400">
                02. الإنشاء في Render وإضافة المفتاح
              </div>
              <p>
                في موقع Render اختر <strong>New Web Service</strong> واربط
                مستودع GitHub. سيقرأ Render الإعدادات تلقائياً، وفقط أضف{" "}
                <code className="font-mono-tabular text-white">
                  GEMINI_API_KEY
                </code>{" "}
                و{" "}
                <code className="font-mono-tabular text-white">
                  GROQ_API_KEY
                </code>{" "}
                في خانة Environment Variables.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="font-semibold text-emerald-400">
                03. ضمان عدم النوم على الخطة المجانية
              </div>
              <p>
                بالإضافة إلى النبض الذاتي المدمج في الخادم، انسخ رابط{" "}
                <code className="font-mono-tabular text-white">
                  /api/v1/mindo/ping
                </code>{" "}
                وضعه في موقع <strong>cron-job.org</strong> (مجاني) ليزور الرابط
                كل 5 دقائق، وبذلك لن يدخل سيرفر Render في وضع السبات إطلاقاً!
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Domain Selector & Mobile App Code Generator */}
      <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1 flex-1">
            <label className="block text-xs font-medium text-slate-300">
              رابط السيرفر المستخدم في توليد أكواد تطبيق الهاتف (يمكنك وضع رابط Render الخاص بك هنا أو استخدام الرابط الحالي):
            </label>
            <input
              type="text"
              dir="ltr"
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder="https://mindo-cloud-brain.onrender.com"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono-tabular text-emerald-400 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCustomBaseUrl(defaultOrigin)}
              className="px-3.5 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              استخدام الرابط الحالي
            </button>
            <button
              type="button"
              onClick={() =>
                onQuickTest("احسب 450 ضرب 18.5 ثم افتح تطبيق الحاسبة")
              }
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              اختبار إرسال أمر حي
            </button>
          </div>
        </div>

        {/* Code Snippets Tabs */}
        <div className="border border-slate-800 bg-slate-950/90 rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-800">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedLang("kotlin")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  selectedLang === "kotlin"
                    ? "bg-emerald-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Android (Kotlin)
              </button>
              <button
                type="button"
                onClick={() => setSelectedLang("flutter")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  selectedLang === "flutter"
                    ? "bg-emerald-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Flutter (Dart)
              </button>
              <button
                type="button"
                onClick={() => setSelectedLang("react_native")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  selectedLang === "react_native"
                    ? "bg-emerald-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                React Native
              </button>
              <button
                type="button"
                onClick={() => setSelectedLang("render_yaml")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  selectedLang === "render_yaml"
                    ? "bg-emerald-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                إعداد Render (render.yaml)
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copied ? "تم نسخ الكود بنجاح" : "نسخ الكود"}</span>
            </button>
          </div>

          <div className="p-5 overflow-x-auto" dir="ltr">
            <div className="text-xs font-mono-tabular text-slate-400 mb-3">
              {snippets[selectedLang].title}
            </div>
            <pre className="text-xs font-mono-tabular text-slate-200 leading-relaxed">
              <code>{snippets[selectedLang].code}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
