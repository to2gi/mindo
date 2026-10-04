import React, { useEffect, useState, useCallback } from "react";
import {
  Send,
  RefreshCw,
  ArrowLeft,
  Volume2,
  Copy,
  Check,
} from "lucide-react";
import { OverviewData, RoutingConfig, TaskLogEntry } from "./types";
import { MindoSimulatorView } from "./components/MindoSimulatorView";
import { EnginesPoolView } from "./components/EnginesPoolView";
import { TaskLogsView } from "./components/TaskLogsView";
import { ApiIntegrationPanel } from "./components/ApiIntegrationPanel";

type ActiveTab = "overview" | "simulator" | "engines" | "logs" | "integration";

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [isVerifyingKey, setIsVerifyingKey] = useState<boolean>(false);
  const [liveVerificationResult, setLiveVerificationResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    message: string;
  } | null>(null);
  const [copiedEndpoint, setCopiedEndpoint] = useState<boolean>(false);

  const [quickCommand, setQuickCommand] = useState<string>(
    "احسب الجذر التربيعي لـ 15625 ضرب 24 وحول الناتج من الدولار إلى الريال السعودي بسعر الصرف اليوم"
  );
  const [simulatorPreset, setSimulatorPreset] = useState<string>("");
  const [latestExecutedLog, setLatestExecutedLog] =
    useState<TaskLogEntry | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/overview");
      if (!res.ok) throw new Error("Failed to load overview");
      const data: OverviewData = await res.json();
      setOverview(data);
      if (data.recentLogs.length > 0 && !latestExecutedLog) {
        setLatestExecutedLog(data.recentLogs[0]);
      }
    } catch (err: any) {
      setErrorBanner(err?.message || "تعذر الاتصال بخادم ميندو السحابي");
    } finally {
      setLoading(false);
    }
  }, [latestExecutedLog]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const speakArabicText = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ar-SA";
      utterance.rate = 1.02;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore speech synthesis errors on restricted browsers
    }
  };

  const handleVerifyLiveKey = async () => {
    setIsVerifyingKey(true);
    setLiveVerificationResult(null);
    try {
      const res = await fetch("/api/admin/verify-live", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setLiveVerificationResult({
          ok: true,
          latencyMs: data.latencyMs,
          message: data.message,
        });
        await fetchOverview();
      } else {
        setLiveVerificationResult({
          ok: false,
          message:
            data.error ||
            "يرجى التأكد من إضافة GEMINI_API_KEY في لوحة Secrets الخاصة بالتطبيق.",
        });
      }
    } catch (err: any) {
      setLiveVerificationResult({
        ok: false,
        message: err?.message || "تعذر إتمام الفحص الحي.",
      });
    } finally {
      setIsVerifyingKey(false);
    }
  };

  const handleExecuteCommand = async (
    query: string,
    preferredEngine: string = "auto",
    speakOut: boolean = false
  ) => {
    setIsExecuting(true);
    setErrorBanner(null);
    try {
      const res = await fetch("/api/v1/mindo/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          deviceId: "mindo-live-admin",
          deviceModel: "Mindo Production Admin Gateway",
          preferredEngine,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل معالجة الأمر في الخادم");
      }
      if (data.telemetry) {
        setLatestExecutedLog(data.telemetry);
      }
      if (speakOut && data.spokenReply) {
        speakArabicText(data.spokenReply);
      }
      await fetchOverview();
    } catch (err: any) {
      setErrorBanner(err?.message || "حدث خطأ أثناء إرسال المهمة للخادم");
    } finally {
      setIsExecuting(false);
    }
  };

  const handleToggleEngine = async (
    id: string,
    enabled: boolean,
    priority?: number
  ) => {
    try {
      const res = await fetch(`/api/admin/engines/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, priority }),
      });
      if (res.ok) {
        await fetchOverview();
      }
    } catch {
      setErrorBanner("تعذر تحديث حالة المحرك");
    }
  };

  const handlePingEngine = async (
    id: string
  ): Promise<{ latencyMs: number; sampleOutput: string } | null> => {
    try {
      const res = await fetch(`/api/admin/engines/${id}/ping`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        await fetchOverview();
        return { latencyMs: data.latencyMs, sampleOutput: data.sampleOutput };
      }
    } catch {
      // Ignore error
    }
    return null;
  };

  const handleUpdateRoutingConfig = async (
    partial: Partial<RoutingConfig>
  ) => {
    try {
      const res = await fetch("/api/admin/routing-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      if (res.ok) {
        await fetchOverview();
      }
    } catch {
      setErrorBanner("تعذر تحديث إعدادات التوجيه");
    }
  };

  const handleClearLogs = async () => {
    try {
      const res = await fetch("/api/admin/logs", { method: "DELETE" });
      if (res.ok) {
        setLatestExecutedLog(null);
        await fetchOverview();
      }
    } catch {
      setErrorBanner("تعذر مسح السجل");
    }
  };

  const handleUpdateKeepAlive = async (payload: {
    enabled?: boolean;
    targetUrl?: string;
    triggerNow?: boolean;
  }) => {
    try {
      const res = await fetch("/api/admin/keep-alive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await fetchOverview();
      }
    } catch {
      setErrorBanner("تعذر تحديث إعدادات منع السبات");
    }
  };

  const openSimulatorWithCommand = (cmd: string) => {
    setSimulatorPreset(cmd);
    setActiveTab("simulator");
    handleExecuteCommand(cmd, "auto", true);
  };

  const fullEndpointUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/v1/mindo/execute`
      : "/api/v1/mindo/execute";

  const copyLiveEndpoint = () => {
    navigator.clipboard.writeText(fullEndpointUrl);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-6 py-4 bg-[#090d16]/95 backdrop-blur border-b border-slate-800/90">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab("overview");
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap"
        >
          Mindo Cloud Brain
        </a>

        {/* Zone 2: 5 clean text navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`py-1 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === "overview"
                ? "text-white underline underline-offset-8 decoration-emerald-500 decoration-2"
                : "hover:text-slate-200"
            }`}
          >
            لوحة المراقبة الحية
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("simulator")}
            className={`py-1 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === "simulator"
                ? "text-white underline underline-offset-8 decoration-emerald-500 decoration-2"
                : "hover:text-slate-200"
            }`}
          >
            بوابة التنفيذ الحي
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("engines")}
            className={`py-1 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === "engines"
                ? "text-white underline underline-offset-8 decoration-emerald-500 decoration-2"
                : "hover:text-slate-200"
            }`}
          >
            النماذج والمحركات
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("logs")}
            className={`py-1 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === "logs"
                ? "text-white underline underline-offset-8 decoration-emerald-500 decoration-2"
                : "hover:text-slate-200"
            }`}
          >
            سجل المهام الفعلية
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("integration")}
            className={`py-1 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === "integration"
                ? "text-white underline underline-offset-8 decoration-emerald-500 decoration-2"
                : "hover:text-slate-200"
            }`}
          >
            النشر على Render وربط الهاتف
          </button>
        </nav>

        {/* Zone 3: Primary action */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleVerifyLiveKey}
            disabled={isVerifyingKey}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            {isVerifyingKey ? "جاري فحص المفتاح..." : "فحص اتصال Gemini الحي"}
          </button>
        </div>
      </header>

      {/* Mobile Navigation Bar */}
      <div className="md:hidden flex items-center gap-2 overflow-x-auto px-4 py-2.5 bg-slate-950 border-b border-slate-800 text-xs">
        {[
          { id: "overview", label: "لوحة المراقبة" },
          { id: "simulator", label: "التنفيذ الحي" },
          { id: "engines", label: "المحركات" },
          { id: "logs", label: "سجل المهام" },
          { id: "integration", label: "ربط الهاتف" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id as ActiveTab)}
            className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap ${
              activeTab === item.id
                ? "bg-slate-800 text-white"
                : "text-slate-400"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {errorBanner && (
          <div className="p-4 rounded-lg bg-red-950/50 border border-red-800 text-xs text-red-200 flex items-center justify-between">
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="text-red-300 hover:text-white underline ms-4 cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        )}

        {liveVerificationResult && (
          <div
            className={`p-4 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              liveVerificationResult.ok
                ? "bg-emerald-950/40 border-emerald-700/70 text-emerald-200"
                : "bg-amber-950/40 border-amber-700/70 text-amber-200"
            }`}
          >
            <div className="space-y-1">
              <div className="font-semibold text-sm text-white">
                {liveVerificationResult.ok
                  ? `المفتاح السحابي متصل ويعمل فعلياً (${liveVerificationResult.latencyMs} ms)`
                  : "تنبيه فحص المفتاح"}
              </div>
              <p className="leading-relaxed">{liveVerificationResult.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setLiveVerificationResult(null)}
              className="text-xs underline self-end sm:self-center shrink-0 cursor-pointer"
            >
              إخفاء
            </button>
          </div>
        )}

        {loading || !overview ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="h-28 rounded-xl bg-slate-900/50 border border-slate-800 animate-pulse"
                />
              ))}
            </div>
            <div className="h-96 rounded-xl bg-slate-900/50 border border-slate-800 animate-pulse" />
          </div>
        ) : (
          <>
            {/* OVERVIEW TAB */}
            {activeTab === "overview" && (
              <div className="space-y-8">
                {/* Production Server Status & Live Endpoint Header */}
                <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-6 space-y-5">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-2 max-w-3xl">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-emerald-400 font-semibold">
                          خادم إنتاجي فعلي (Live Production Backend)
                        </span>
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-300">
                          مفتاح Gemini:{" "}
                          {overview.systemStatus?.geminiKeyActive
                            ? "متصل ونشط"
                            : "جاهز للربط"}
                        </span>
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-300">
                          CORS مفعّل لاستقبال طلبات تطبيق الهاتف مباشرة
                        </span>
                      </div>
                      <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight text-balance">
                        خادم عقل ميندو السحابي (Mindo Cloud Brain Server)
                      </h1>
                      <p className="text-sm text-slate-300 leading-relaxed">
                        هذا الموقع يعمل كخادم خلفي حقيقي (Production API) متصل فعلياً بنماذج Gemini 3.8 Flash مع بحث جوجل الحي ومحركات الحساب والطقس والعملات وويكيبيديا. يمكنك ربط تطبيق الهاتف به فوراً عبر الرابط أدناه.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={copyLiveEndpoint}
                        className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        {copiedEndpoint ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {copiedEndpoint
                            ? "تم نسخ رابط API الفعلي"
                            : "نسخ رابط API لتطبيق الهاتف"}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveTab("integration")}
                        className="px-4 py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        أكواد الربط مع الهاتف
                      </button>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <span className="text-slate-400">
                      الرابط الفعلي لإرسال الأسئلة والأوامر الصوتية من تطبيق ميندو:
                    </span>
                    <code
                      dir="ltr"
                      className="font-mono-tabular text-emerald-400 bg-slate-950 px-3 py-1.5 rounded border border-slate-800 select-all"
                    >
                      POST {fullEndpointUrl}
                    </code>
                  </div>
                </div>

                {/* 4 Real Tabular Metric Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-5 space-y-2">
                    <div className="text-xs text-slate-400">
                      إجمالي المهام الفعلية المنفذة
                    </div>
                    <div className="text-2xl font-bold font-mono-tabular text-white">
                      {overview.metrics.totalRequests.toLocaleString("en-US")}
                    </div>
                    <div className="text-xs text-emerald-400">
                      محفوظة فعلياً في قاعدة بيانات الخادم
                    </div>
                  </div>

                  <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-5 space-y-2">
                    <div className="text-xs text-slate-400">
                      متوسط زمن الاستجابة الحقيقي
                    </div>
                    <div className="text-2xl font-bold font-mono-tabular text-white">
                      {overview.metrics.avgLatencyMs > 0
                        ? `${overview.metrics.avgLatencyMs} ms`
                        : "جاهز للقياس"}
                    </div>
                    <div className="text-xs text-slate-400">
                      يُقاس فعلياً مع كل طلب وارد للخادم
                    </div>
                  </div>

                  <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-5 space-y-2">
                    <div className="text-xs text-slate-400">
                      البيانات الفعلية الموفرة للهاتف
                    </div>
                    <div className="text-2xl font-bold font-mono-tabular text-emerald-400">
                      {overview.metrics.totalSavedKB.toLocaleString("en-US")} KB
                    </div>
                    <div className="text-xs text-slate-400">
                      ضغط نتائج البحث والحساب لحزمة JSON خفيفة
                    </div>
                  </div>

                  <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-5 space-y-2">
                    <div className="text-xs text-slate-400">
                      المحركات الحية المتصلة بالخادم
                    </div>
                    <div className="text-2xl font-bold font-mono-tabular text-white">
                      {overview.metrics.activeEnginesCount} /{" "}
                      {overview.engines.length}
                    </div>
                    <div className="text-xs text-slate-400">
                      تشمل Gemini 3.8 + {overview.metrics.keylessEnginesCount}{" "}
                      محركات مفتوحة حية
                    </div>
                  </div>
                </div>

                {/* Live Heavy Question Execution Bar */}
                <div className="border border-slate-800 bg-slate-900/60 rounded-xl p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-white">
                        اختبار حقيقي مباشر للإجابة على الأسئلة القوية والمعقدة
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        اكتب أي سؤال علمي أو رياضي أو بحثي أدناه؛ سيقوم الخادم بالاتصال الفعلي بمفتاح Gemini ومحركات الويب وإرجاع الإجابة الحقيقية فوراً.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("simulator")}
                      className="text-xs text-emerald-400 hover:underline flex items-center gap-1 self-start sm:self-auto cursor-pointer"
                    >
                      <span>فتح بوابة التنفيذ الصوتية الكاملة</span>
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (quickCommand.trim()) {
                        handleExecuteCommand(quickCommand, "auto", false);
                      }
                    }}
                    className="flex flex-col sm:flex-row gap-3"
                  >
                    <input
                      type="text"
                      value={quickCommand}
                      onChange={(e) => setQuickCommand(e.target.value)}
                      placeholder="اسأل أي سؤال قوي أو عملية حسابية أو معلومة حديثة..."
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      type="submit"
                      disabled={isExecuting || !quickCommand.trim()}
                      className="flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      {isExecuting ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>جاري التنفيذ الفعلي...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          <span>إرسال للخادم الآن</span>
                        </>
                      )}
                    </button>
                  </form>

                  {latestExecutedLog && (
                    <div className="pt-4 border-t border-slate-800/80 space-y-4">
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                        <div className="lg:col-span-8 space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span className="font-mono-tabular text-emerald-400">
                              {latestExecutedLog.id}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-emerald-400 font-medium">
                              {latestExecutedLog.selectedEngineName}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">
                              الزمن الفعلي: {latestExecutedLog.latencyMs} ms
                            </span>
                          </div>
                          <p className="text-sm font-medium text-white leading-relaxed">
                            &quot;{latestExecutedLog.spokenReply}&quot;
                          </p>
                          {latestExecutedLog.detailedAnswer &&
                            latestExecutedLog.detailedAnswer !==
                              latestExecutedLog.spokenReply && (
                              <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line pt-1">
                                {latestExecutedLog.detailedAnswer}
                              </p>
                            )}
                        </div>

                        <div className="lg:col-span-4 flex flex-wrap items-center justify-between lg:justify-end gap-3">
                          {latestExecutedLog.structuredData.computedResult && (
                            <div className="font-mono-tabular text-xs text-emerald-300 bg-slate-950 border border-slate-800 px-3 py-2 rounded-lg">
                              {latestExecutedLog.structuredData.computedResult}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              speakArabicText(latestExecutedLog.spokenReply)
                            }
                            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>سماع النطق</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Two-Column Split: Engine Pool Status & Real Executed Requests */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  {/* Active Engine Matrix */}
                  <div className="lg:col-span-5 border border-slate-800 bg-slate-900/50 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-white">
                        حالة المحركات السحابية والمفتوحة
                      </h2>
                      <button
                        type="button"
                        onClick={() => setActiveTab("engines")}
                        className="text-xs text-emerald-400 hover:underline cursor-pointer"
                      >
                        إدارة وفحص المحركات
                      </button>
                    </div>
                    <div className="divide-y divide-slate-800/70">
                      {overview.engines.map((eng) => (
                        <div
                          key={eng.id}
                          className="p-4 flex items-center justify-between gap-4 hover:bg-slate-900/80 transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-semibold text-slate-100 truncate">
                                {eng.name}
                              </span>
                              <span className="text-slate-600" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-slate-400 whitespace-nowrap">
                                {eng.requiresKey
                                  ? eng.keyConfigured
                                    ? "مفتاح الخادم متصل"
                                    : "توجيه احتياطي"
                                  : "مفتوح بدون مفتاح"}
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 mt-1 truncate">
                              {eng.capabilities.slice(0, 2).join(" · ")}
                            </div>
                          </div>

                          <div className="text-left font-mono-tabular shrink-0">
                            <div
                              className={`text-xs font-medium ${
                                eng.enabled
                                  ? "text-emerald-400"
                                  : "text-amber-400"
                              }`}
                            >
                              {eng.enabled
                                ? eng.avgLatencyMs > 0
                                  ? `${eng.avgLatencyMs} ms`
                                  : "نشط"
                                : "موقوف"}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {eng.totalCalls} مهمة منفذة
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Real Requests Stream */}
                  <div className="lg:col-span-7 border border-slate-800 bg-slate-900/50 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-white">
                        سجل المهام الفعلية المنفذة على الخادم
                      </h2>
                      <button
                        type="button"
                        onClick={() => setActiveTab("logs")}
                        className="text-xs text-emerald-400 hover:underline cursor-pointer"
                      >
                        عرض السجل الكامل ({overview.recentLogs.length})
                      </button>
                    </div>

                    {overview.recentLogs.length === 0 ? (
                      <div className="p-10 text-center space-y-3">
                        <p className="text-xs text-slate-300 font-medium">
                          السجل خالٍ من أي بيانات وهمية — يعرض فقط الطلبات الحقيقية التي تنفذها أنت أو تطبيق الهاتف!
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            handleExecuteCommand(quickCommand, "auto", false)
                          }
                          disabled={isExecuting}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                        >
                          تنفيذ أول مهمة حقيقية الآن
                        </button>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-right text-xs">
                          <thead>
                            <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                              <th className="py-3 px-4 font-medium">
                                السؤال / الأمر الفعلي
                              </th>
                              <th className="py-3 px-4 font-medium">
                                المحرك المنفذ
                              </th>
                              <th className="py-3 px-4 font-medium text-left">
                                الزمن / الحجم
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {overview.recentLogs.slice(0, 6).map((log) => (
                              <tr
                                key={log.id}
                                onClick={() => {
                                  setLatestExecutedLog(log);
                                  setActiveTab("simulator");
                                }}
                                className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                              >
                                <td className="py-3.5 px-4 align-top">
                                  <div className="text-slate-100 font-medium line-clamp-1">
                                    {log.voiceCommand}
                                  </div>
                                  <div className="text-slate-400 mt-1 flex items-center gap-1.5">
                                    <span className="font-mono-tabular text-emerald-400">
                                      {log.id}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span>{log.intentLabelAr}</span>
                                  </div>
                                </td>
                                <td className="py-3.5 px-4 align-top text-slate-300">
                                  <div>{log.selectedEngineName}</div>
                                  {log.sources.length > 0 && (
                                    <div className="text-slate-400 mt-0.5">
                                      مرفق بـ {log.sources.length} مصادر حية
                                    </div>
                                  )}
                                </td>
                                <td className="py-3.5 px-4 align-top text-left font-mono-tabular whitespace-nowrap">
                                  <div className="text-white font-medium">
                                    {log.latencyMs} ms
                                  </div>
                                  <div className="text-emerald-400 mt-0.5">
                                    {log.mobilePayloadBytes} B
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* LIVE EXECUTION GATEWAY TAB */}
            {activeTab === "simulator" && (
              <MindoSimulatorView
                engines={overview.engines}
                latestLog={
                  latestExecutedLog || overview.recentLogs[0] || null
                }
                isExecuting={isExecuting}
                onExecuteCommand={handleExecuteCommand}
                initialCommand={simulatorPreset}
              />
            )}

            {/* ENGINES POOL TAB */}
            {activeTab === "engines" && (
              <EnginesPoolView
                engines={overview.engines}
                routingConfig={overview.routingConfig}
                onToggleEngine={handleToggleEngine}
                onPingEngine={handlePingEngine}
                onUpdateRoutingConfig={handleUpdateRoutingConfig}
              />
            )}

            {/* LOGS TAB */}
            {activeTab === "logs" && (
              <TaskLogsView
                logs={overview.recentLogs}
                onClearLogs={handleClearLogs}
                onSelectLogForSimulator={openSimulatorWithCommand}
              />
            )}

            {/* MOBILE INTEGRATION & RENDER DEPLOY TAB */}
            {activeTab === "integration" && (
              <ApiIntegrationPanel
                keepAlive={overview.keepAlive}
                onUpdateKeepAlive={handleUpdateKeepAlive}
                onQuickTest={openSimulatorWithCommand}
              />
            )}
          </>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-800/80 py-5 px-6 text-xs text-slate-500">
        <div className="max-w-[1380px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            Mindo Cloud Brain — خادم معالجة وتوجيه الذكاء الاصطناعي الفعلي لتطبيق المساعد الصوتي ميندو
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveTab("integration")}
              className="hover:text-slate-300 transition-colors cursor-pointer"
            >
              توثيق نقطة النهاية API
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setActiveTab("engines")}
              className="hover:text-slate-300 transition-colors cursor-pointer"
            >
              إعدادات التوجيه السحابي
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
