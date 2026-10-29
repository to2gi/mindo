import React, { useState, useEffect } from "react";
import {
  Zap,
  Save,
  Check,
  Copy,
  Clock,
  Sparkles,
  Bot,
  Terminal,
  ShieldCheck,
  RotateCcw,
  Smartphone,
  Play,
  ArrowRight,
  Layers,
  Code,
  AlertTriangle,
  RefreshCw,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { OnlineTaskConfig, OnlineTaskResult, MindoActionPayload } from "../types";

interface OnlineTaskExecutorViewProps {
  onSpeak?: (text: string) => void;
}

const DEFAULT_EXECUTIVE_PROMPT = `# Role & Operational Protocol: Mindo Autonomous Executive Agent (وكيل ميندو التنفيذي الذكي)

You are the ultra-fast autonomous executive AI behind the Mindo Android system.
Your operational mandate is absolute execution: YOU NEVER REJECT, POSTPONE, OR QUESTION ANY USER COMMAND.

## Core Directives & Dynamic Reality:
1. **Unpredictable Human Commands at Any Moment (أوامر غير متوقعة في أي لحظة):**
   - Human users generate completely unexpected tasks, questions, and device commands at any split-second.
   - You must instantly deconstruct the user's input—whether in Standard Arabic, Moroccan, Algerian, Egyptian, Gulf, Levantine, French, or English—and deduce the intended objective at lightning speed.

2. **Visual & UI Feedback Loop (الرؤية والتحليل البصري والتأكد من الوصول):**
   - You receive real-time telemetry, screenshots, and accessibility node hierarchies from the user's phone.
   - You inspect previous steps executed on the phone (\`execution_history\`), detect screen buttons, inputs, icons, and menus.
   - You actively verify if the user has reached their intended destination website, app screen, or web form. If an obstacle or extra step appears (e.g., login modal, cookie prompt, search field), you generate the next click or input step to overcome it.

3. **Autonomous Action Execution:**
   - If the request is a knowledge inquiry, factual question, calculation, or translation: provide an accurate, clear, and direct answer immediately.
   - If the request requires device manipulation, downloading, browsing, or multi-step execution: output a strict, executable JSON object following the format below.

## Output Schema (Strict JSON for Actions):
\`\`\`json
{
  "action": "workflow | open_app | open_url | open_settings | call_contact | set_alarm | set_timer | toggle_flashlight | set_volume | click | type | video_download | search_and_download_book | search_and_download_image | none",
  "target": "target_name_or_url",
  "args": {
    "steps": [
      {
        "type": "click | type | find | delete | autofill",
        "label": "Button or element label",
        "text": "Text to write if applicable"
      }
    ],
    "verification": "Confirm user reached destination"
  },
  "explanation": "Brief explanation of the action taken"
}
\`\`\`
Always ensure steps are concrete, actionable, and verified.`;

const PRESET_COMMANDS = [
  {
    label: "تنزيل فيديو من يوتيوب",
    command: "حمل لي هذا الفيديو بجودة عالية 1080p",
    app: "com.google.android.youtube",
    url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
    elements: ["زر التنزيل", "مشاركة", "إلغاء"],
  },
  {
    label: "تثبيت تطبيق من Google Play",
    command: "افتح متجر جوجل بلاي وابحث عن تطبيق Telegram وحمله",
    app: "com.android.vending",
    url: "market://search?q=telegram",
    elements: ["تثبيت", "بحث", "التقييمات"],
  },
  {
    label: "تفعيل البلوتوث والاقتران",
    command: "افتح إعدادات البلوتوث واقترن بسماعة الرأس",
    app: "com.android.settings",
    url: "android.settings.BLUETOOTH_SETTINGS",
    elements: ["تشغيل البلوتوث", "الأجهزة المتاحة", "سماعة الرأس"],
  },
  {
    label: "تحميل كتاب بصيغة PDF",
    command: "ابحث لي عن كتاب مقدمة ابن خلدون ونزله كملف PDF",
    app: "com.android.chrome",
    url: "https://google.com/search?q=مقدمة+ابن+خلدون+pdf",
    elements: ["تحميل PDF مباشر", "قراءة أونلاين"],
  },
  {
    label: "سؤال معرفي فوري",
    command: "ما هي عاصمة اليابان وما هي مساحتها وعدد سكانها؟",
    app: "com.mindo.assistant",
    url: "",
    elements: [],
  },
];

export const OnlineTaskExecutorView: React.FC<OnlineTaskExecutorViewProps> = () => {
  const [activeTab, setActiveTab] = useState<"simulator" | "prompt" | "docs">("simulator");
  const [promptText, setPromptText] = useState<string>(DEFAULT_EXECUTIVE_PROMPT);
  const [selectedEngine, setSelectedEngine] = useState<string>("gemini-3.8-flash");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState<boolean>(false);

  // Interactive Execution State
  const [taskInput, setTaskInput] = useState<string>("افتح متجر جوجل بلاي وابحث عن تطبيق Telegram وحمله فوراً");
  const [deviceModel, setDeviceModel] = useState<string>("Samsung Galaxy S24 Ultra");
  const [androidVersion, setAndroidVersion] = useState<string>("Android 15");
  const [currentApp, setCurrentApp] = useState<string>("com.android.vending");
  const [currentUrl, setCurrentUrl] = useState<string>("https://play.google.com/store");
  const [uiElementsText, setUiElementsText] = useState<string>("زر 'تثبيت', حقل 'بحث', زر 'رجوع'");
  const [verificationFailed, setVerificationFailed] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<OnlineTaskResult | null>(null);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);
  const [copiedPayload, setCopiedPayload] = useState<boolean>(false);

  // Load config on mount
  useEffect(() => {
    fetch("/api/admin/online-task-config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.onlineTaskConfig) {
          const cfg = data.onlineTaskConfig as OnlineTaskConfig;
          if (cfg.customSystemPrompt && cfg.customSystemPrompt.trim()) {
            setPromptText(cfg.customSystemPrompt);
          }
          if (cfg.defaultEngine) setSelectedEngine(cfg.defaultEngine);
        }
      })
      .catch(() => {});
  }, []);

  const handleSavePrompt = async (textToSave?: string) => {
    const text = textToSave !== undefined ? textToSave : promptText;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const res = await fetch("/api/admin/online-task-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customSystemPrompt: text.trim(),
          defaultEngine: selectedEngine,
          autoWebGrounding: true,
        }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch {
      // Error saving
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefaultPrompt = () => {
    setPromptText(DEFAULT_EXECUTIVE_PROMPT);
    handleSavePrompt(DEFAULT_EXECUTIVE_PROMPT);
  };

  const handleRunTask = async (presetCommand?: string) => {
    const cmd = (presetCommand || taskInput).trim();
    if (!cmd || isExecuting) return;

    setIsExecuting(true);
    try {
      const res = await fetch("/api/v1/mindo/online-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: cmd,
          engine: selectedEngine,
          deviceModel,
          androidVersion,
          currentApp,
          currentUrl,
          uiElements: uiElementsText.split(",").map((s) => s.trim()).filter(Boolean),
          verificationFailed,
          lastFailureReason: verificationFailed ? "العنصر المطلوب لم يظهر على الشاشة أو فشل التحميل" : undefined,
        }),
      });
      const data = (await res.json()) as OnlineTaskResult;
      setLastResult(data);
    } catch (err: any) {
      setLastResult({
        status: "error",
        taskId: `err-${Date.now()}`,
        task: cmd,
        executedResult: `تعذر الاتصال بالخادم: ${err?.message || "خطأ غير متوقع"}`,
        executionSteps: [
          {
            stepNumber: 1,
            title: "فشل الاتصال",
            detail: "تعذر إرسال الطلب إلى الخادم.",
            status: "failed",
          },
        ],
        sources: [],
        modelUsed: selectedEngine,
        executionTimeMs: 0,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const endpointUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/v1/mindo/online-task`
      : "/api/v1/mindo/online-task";

  const copyEndpoint = () => {
    navigator.clipboard.writeText(endpointUrl);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  };

  const copyActionPayload = () => {
    if (!lastResult?.actionPayload) return;
    navigator.clipboard.writeText(JSON.stringify(lastResult.actionPayload, null, 2));
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  return (
    <div className="max-w-[1280px] mx-auto px-4 py-8 space-y-6">
      {/* Top Banner & Status */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 backdrop-blur shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl -z-10" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Zap className="w-5 h-5" />
              </span>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                القسم الثاني
              </span>
              <span className="text-xs font-bold px-3 py-1 rounded-full border bg-emerald-500/10 border-emerald-500/30 text-emerald-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                وكيل ميندو التنفيذي الذكي (Active)
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              منفّذ مهام الوضع الأونلاين (Autonomous Executive Agent)
            </h1>
            <p className="text-sm text-slate-400 mt-2 max-w-3xl leading-relaxed">
              الوكيل الذكي فائق السرعة لنظام وتطبيق Mindo Android. يستقبل جميع أوامر المستخدمين غير المتوقعة بجميع اللهجات،
              ويحلل واجهة شاشة الهاتف والتحقق البصري خطوة بخطوة، ويولّد مسار التنفيذ الدقيق بصيغة JSON قابلة للتطبيق الفوري.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={copyEndpoint}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              {copiedEndpoint ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  تم نسخ الرابط
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-slate-400" />
                  رابط الـ API المباشر
                </>
              )}
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 mt-6 border-t border-slate-800/80 pt-4">
          <button
            type="button"
            onClick={() => setActiveTab("simulator")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "simulator"
                ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20"
                : "bg-slate-800/80 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Smartphone className="w-4 h-4" />
            المحاكي التفاعلي والتنفيذ (Simulator)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("prompt")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "prompt"
                ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20"
                : "bg-slate-800/80 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Terminal className="w-4 h-4" />
            البروتوكول والبرومبت المعتمد
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("docs")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "docs"
                ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20"
                : "bg-slate-800/80 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Code className="w-4 h-4" />
            دليل الربط مع تطبيق الهاتف
          </button>
        </div>
      </div>

      {/* Tab 1: Simulator */}
      {activeTab === "simulator" && (
        <div className="space-y-6">
          {/* Telemetry & Phone State Configuration Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">
                  محاكاة بيئة الهاتف والتحقق البصري (Real-Time Phone Telemetry)
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">
                هذه البيانات يرسلها تطبيق الأندرويد تلقائياً مع كل طلب
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1.5 font-medium">نوع هاتف المستخدم:</label>
                <input
                  type="text"
                  value={deviceModel}
                  onChange={(e) => setDeviceModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="e.g. Samsung Galaxy S24"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1.5 font-medium">إصدار الأندرويد (OS):</label>
                <input
                  type="text"
                  value={androidVersion}
                  onChange={(e) => setAndroidVersion(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="Android 15"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1.5 font-medium">التطبيق النشط حالياً:</label>
                <input
                  type="text"
                  value={currentApp}
                  onChange={(e) => setCurrentApp(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="com.android.vending"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1.5 font-medium">الرابط أو الشاشة النشطة:</label>
                <input
                  type="text"
                  value={currentUrl}
                  onChange={(e) => setCurrentUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="md:col-span-2">
                <label className="text-xs text-slate-400 block mb-1.5 font-medium">
                  عناصر واجهة المستخدم المرصودة على الشاشة (UI Elements Tree):
                </label>
                <input
                  type="text"
                  value={uiElementsText}
                  onChange={(e) => setUiElementsText(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="زر 'تثبيت', حقل 'بحث', زر 'تخطي الإعلان'..."
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1.5 font-medium">حالة التحقق البصري:</label>
                <button
                  type="button"
                  onClick={() => setVerificationFailed(!verificationFailed)}
                  className={`w-full px-3 py-2 rounded-xl border text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                    verificationFailed
                      ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                      : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  }`}
                >
                  {verificationFailed ? (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5" />
                      تنبيه: فشل التحقق في الخطوة السابقة (إعادة محاولة)
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      التحقق البصري: سليم وجاهز
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Task Command Input & Presets */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                أمر المستخدم البشري (بأي لهجة أو لغة):
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">النموذج:</span>
                <select
                  value={selectedEngine}
                  onChange={(e) => setSelectedEngine(e.target.value)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="gemini-3.8-flash">Gemini 3.8 Flash (Ultra Fast)</option>
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
                  <option value="groq-lpu-route">Groq LPU Cluster</option>
                  <option value="open-llm-keyless">Open Keyless Engine</option>
                </select>
              </div>
            </div>

            {/* Presets Chips */}
            <div className="flex flex-wrap gap-2">
              {PRESET_COMMANDS.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setTaskInput(item.command);
                    setCurrentApp(item.app);
                    setCurrentUrl(item.url);
                    setUiElementsText(item.elements.join(", "));
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700/80 transition-colors cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRunTask()}
                placeholder="اكتب هنا أي أمر قد يخترعه أي مستخدم للهاتف..."
                className="flex-1 px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => handleRunTask()}
                disabled={isExecuting || !taskInput.trim()}
                className="px-6 py-3 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-500/20 disabled:opacity-50 whitespace-nowrap"
              >
                {isExecuting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    جاري التحليل والتنفيذ...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    تنفيذ المهمة الآن
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Results Display */}
          {lastResult && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2.5 rounded-xl border ${
                      lastResult.status === "ok"
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                        : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                    }`}
                  >
                    <Check className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">
                      نتيجة التنفيذ والمسار الذاتي للهاتف
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      المحرك المستخدم: {lastResult.modelUsed} • وقت المعالجة: {lastResult.executionTimeMs}ms
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRawJson(!showRawJson)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Code className="w-3.5 h-3.5" />
                    {showRawJson ? "إخفاء كود الـ JSON" : "عرض كود JSON الموجه للهاتف"}
                  </button>

                  <button
                    type="button"
                    onClick={copyActionPayload}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedPayload ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        تم النسخ
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        نسخ الـ JSON
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Action Schema Pills */}
              {lastResult.actionPayload && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 block mb-1">نوع الإجراء (Action Type):</span>
                    <span className="text-sm font-bold text-emerald-400 font-mono">
                      {lastResult.actionPayload.action}
                    </span>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 block mb-1">الهدف (Target):</span>
                    <span className="text-sm font-semibold text-slate-200 font-mono truncate block" title={lastResult.actionPayload.target}>
                      {lastResult.actionPayload.target || "النظام الداخلي"}
                    </span>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 block mb-1">التحقق البصري المطلوب:</span>
                    <span className="text-xs font-medium text-slate-300">
                      {lastResult.actionPayload.args?.verification || "تم التأكيد الفوري"}
                    </span>
                  </div>
                </div>
              )}

              {/* Execution Steps Breakdown */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  خطوات التنفيذ المتسلسلة على واجهة الهاتف (Step-by-Step Execution):
                </h4>
                <div className="space-y-2">
                  {lastResult.executionSteps.map((step) => (
                    <div
                      key={step.stepNumber}
                      className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 flex items-start gap-3"
                    >
                      <span className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {step.stepNumber}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-white">{step.title}</p>
                          <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                            {step.status === "completed" ? "جاهز للتنفيذ" : step.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{step.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Explanation Text */}
              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800">
                <p className="text-xs text-slate-400 mb-1 font-semibold">تفسير الوكيل وخلاصة الإجراء للمستخدم:</p>
                <p className="text-sm text-slate-200 leading-relaxed font-medium">
                  {lastResult.executedResult}
                </p>
              </div>

              {/* Raw JSON Code Block */}
              {showRawJson && lastResult.actionPayload && (
                <div className="relative">
                  <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed">
                    {JSON.stringify(lastResult.actionPayload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: System Prompt */}
      {activeTab === "prompt" && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-slate-800 text-emerald-400 border border-slate-700">
                <Terminal className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">
                  البروتوكول التشغيلي المعتمد (Mindo Autonomous Executive Agent)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  هذا هو البرومبت الرسمي المعتمد الذي يقود وكيل الوضع الأونلاين للتحكم والتنفيذ الكامل للهاتف.
                </p>
              </div>
            </div>

            {saveSuccess && (
              <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" />
                تم حفظ البرومبت واعتماده بنجاح!
              </span>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>نص البرومبت التشغيلي (System Prompt):</span>
              <span>{promptText.length} حرف</span>
            </div>

            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={14}
              className="w-full px-4 py-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-xs leading-relaxed font-mono transition-colors"
            />

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleResetToDefaultPrompt}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  استعادة البرومبت الرسمي المعتمد
                </button>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleSavePrompt()}
                  disabled={isSaving}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 transition-colors flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-500/20"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? "جاري الحفظ..." : "حفظ التعديلات واعتمادها"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: API & Mobile Integration Docs */}
      {activeTab === "docs" && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-800/80 pb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Code className="w-5 h-5 text-emerald-400" />
              دليل الربط التلقائي بين تطبيق الهاتف وموقع ميندو
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              كيف يرسل تطبيق الأندرويد الطلبات غير المتوقعة إلى هذا القسم وكيف ينفذ الخطوات واحدة تلو الأخرى.
            </p>
          </div>

          <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <h4 className="text-sm font-bold text-emerald-400 mb-2">1. التوجيه التلقائي عبر المنفذ العام (/api/v1/mindo/execute):</h4>
              <p className="text-slate-400 mb-3">
                يقوم تطبيق الهاتف بإرسال الطلب مع تحديد الحقل <code className="text-emerald-300 bg-slate-900 px-1 py-0.5 rounded">section: &quot;online_tasks&quot;</code> في البودي:
              </p>
              <pre className="bg-slate-900 p-3 rounded-lg text-emerald-300 font-mono text-[11px] overflow-x-auto">
{`POST /api/v1/mindo/execute
Content-Type: application/json

{
  "section": "online_tasks",
  "task": "افتح متجر جوجل بلاي وحمل تطبيق واتساب",
  "deviceModel": "Samsung Galaxy S24",
  "androidVersion": "Android 15",
  "currentApp": "com.android.launcher",
  "currentUrl": "",
  "uiElements": ["زر التطبيقات", "شريط البحث"],
  "executionHistory": [],
  "verificationFailed": false
}`}
              </pre>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <h4 className="text-sm font-bold text-emerald-400 mb-2">2. حلقة التحقق البصري وإعادة المحاولة التلقائية (Verification Loop):</h4>
              <p className="text-slate-400 mb-2">
                عند تنفيذ أي خطوة على الهاتف، يفحص التطبيق عناصر الشاشة:
              </p>
              <ul className="list-disc list-inside space-y-1.5 text-slate-400">
                <li>إذا وصل الهاتف للوجهة المطلوبة بنجاح: يُنهي المهمة ويُعلم المستخدم صوتياً.</li>
                <li>إذا فتح الهاتف شاشة خاطئة أو ظهرت نافذة غير متوقعة (مثل إعلان أو تسجيل دخول): يُرسل التطبيق نفس الطلب مع <code className="text-amber-300 bg-slate-900 px-1 py-0.5 rounded">&quot;verificationFailed&quot;: true</code> والعناصر الجديدة، فيقوم الوكيل فوراً بتوليد خطوة بديلة لتخطي العائق.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
