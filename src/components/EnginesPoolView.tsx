import React, { useState } from "react";
import { RefreshCw, Power, Sliders, CheckCircle2, AlertTriangle } from "lucide-react";
import { EngineNode, RoutingConfig } from "../types";

interface EnginesPoolViewProps {
  engines: EngineNode[];
  routingConfig: RoutingConfig;
  onToggleEngine: (id: string, enabled: boolean, priority?: number) => Promise<void>;
  onPingEngine: (id: string) => Promise<{ latencyMs: number; sampleOutput: string } | null>;
  onUpdateRoutingConfig: (partial: Partial<RoutingConfig>) => Promise<void>;
}

export const EnginesPoolView: React.FC<EnginesPoolViewProps> = ({
  engines,
  routingConfig,
  onToggleEngine,
  onPingEngine,
  onUpdateRoutingConfig,
}) => {
  const [filterCategory, setFilterCategory] = useState<"all" | "cloud_api" | "keyless">("all");
  const [pingingId, setPingingId] = useState<string | null>(null);
  const [pingFeedback, setPingFeedback] = useState<Record<string, string>>({});

  const filteredEngines = engines.filter((eng) => {
    if (filterCategory === "cloud_api") return eng.requiresKey;
    if (filterCategory === "keyless") return !eng.requiresKey;
    return true;
  });

  const handlePing = async (id: string) => {
    setPingingId(id);
    const res = await onPingEngine(id);
    setPingingId(null);
    if (res) {
      setPingFeedback((prev) => ({
        ...prev,
        [id]: `استجابة ناجحة (${res.latencyMs} ms): ${res.sampleOutput}`,
      }));
    }
  };

  return (
    <div className="space-y-8">
      {/* Global Routing Strategy Bar */}
      <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              خوارزمية التوزيع والتبديل التلقائي (Multi-Engine Orchestration)
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              تحكم في كيفية اختيار الخادم للنموذج الأنسب لكل أمر صوتي قادم من تطبيق ميندو، مع التبديل الفوري للمحركات المجانية بدون مفاتيح عند الحاجة.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setFilterCategory("all")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                filterCategory === "all"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              جميع المحركات ({engines.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterCategory("cloud_api")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                filterCategory === "cloud_api"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              محركات سحابية ({engines.filter((e) => e.requiresKey).length})
            </button>
            <button
              type="button"
              onClick={() => setFilterCategory("keyless")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                filterCategory === "keyless"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              محركات بدون مفتاح ({engines.filter((e) => !e.requiresKey).length})
            </button>
          </div>
        </div>

        {/* Strategy Selector & Toggles */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              id: "smart_hybrid",
              title: "الوضع الهجين الذكي (موصى به)",
              desc: "يجمع بين المحرك الرياضي الفوري وبحث Gemini 3.8 Flash مع المصادر المفتوحة.",
            },
            {
              id: "keyless_first",
              title: "الأولوية للمحركات بدون مفاتيح",
              desc: "يعتمد أولاً على المعالجات المحلية وويكيبيديا والنماذج المفتوحة لتوفير الحصص.",
            },
            {
              id: "max_accuracy",
              title: "أقصى دقة مع إسناد بحث جوجل",
              desc: "يوجه جميع الاستعلامات المعقدة إلى Gemini 3.8 Flash مع التحقق المزدوج.",
            },
            {
              id: "ultra_fast",
              title: "أقصى سرعة للاستجابة الصوتية",
              desc: "يوجه الأوامر الصوتية السريعة إلى Gemini 3.1 Flash Lite بزمن أقل من 300ms.",
            },
          ].map((strat) => {
            const active = routingConfig.strategy === strat.id;
            return (
              <button
                key={strat.id}
                type="button"
                onClick={() =>
                  onUpdateRoutingConfig({
                    strategy: strat.id as RoutingConfig["strategy"],
                  })
                }
                className={`text-right p-4 rounded-lg border transition-colors cursor-pointer ${
                  active
                    ? "bg-emerald-950/30 border-emerald-600/80 text-white"
                    : "bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-white">{strat.title}</span>
                  <span className="text-xs font-mono-tabular text-emerald-400">
                    {active ? "نشط" : ""}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{strat.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Pipeline Switches */}
        <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-6 text-xs">
          <label className="flex items-center gap-2.5 cursor-pointer text-slate-300">
            <input
              type="checkbox"
              checked={routingConfig.enableKeylessPrecompute}
              onChange={(e) =>
                onUpdateRoutingConfig({ enableKeylessPrecompute: e.target.checked })
              }
              className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0"
            />
            <span>تفعيل المعالجة الحسابية والموسوعية المسبقة بدون مفتاح (Keyless Precompute)</span>
          </label>

          <label className="flex items-center gap-2.5 cursor-pointer text-slate-300">
            <input
              type="checkbox"
              checked={routingConfig.enableSearchGrounding}
              onChange={(e) =>
                onUpdateRoutingConfig({ enableSearchGrounding: e.target.checked })
              }
              className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0"
            />
            <span>تفعيل بحث جوجل الحي للمعلومات الحديثة (Google Search Grounding)</span>
          </label>

          <label className="flex items-center gap-2.5 cursor-pointer text-slate-300">
            <input
              type="checkbox"
              checked={routingConfig.enableAutoFallback}
              onChange={(e) =>
                onUpdateRoutingConfig({ enableAutoFallback: e.target.checked })
              }
              className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0"
            />
            <span>تفعيل التبديل التلقائي الفوري في حال انشغال أي نموذج (Zero-Downtime Fallback)</span>
          </label>
        </div>
      </div>

      {/* Engine Nodes Table / List */}
      <div className="border border-slate-800 bg-slate-900/50 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">
            حالة المحركات السحابية والمفتوحة المتصلة بالخادم
          </h3>
          <span className="text-xs text-slate-400">
            تُدار الأذونات والمفاتيح السحابية تلقائياً على الخادم الخلفي
          </span>
        </div>

        <div className="divide-y divide-slate-800/80">
          {filteredEngines.map((engine) => (
            <div
              key={engine.id}
              className="p-6 hover:bg-slate-900/80 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-6"
            >
              <div className="space-y-2 max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-white">{engine.name}</span>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span className="text-xs font-mono-tabular text-emerald-400">
                    {engine.modelIdentifier}
                  </span>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span className="text-xs text-slate-400">
                    {engine.requiresKey ? "محرك سحابي مدار بالخادم" : "محرك مفتوح مجاني بدون مفتاح"}
                  </span>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span
                    className={`text-xs font-medium ${
                      engine.enabled ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {engine.enabled ? "مفعّل في خط التوجيه" : "موقوف مؤقتاً"}
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{engine.descriptionAr}</p>

                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 pt-1">
                  <span>القدرات:</span>
                  {engine.capabilities.map((cap, i) => (
                    <React.Fragment key={i}>
                      <span className="text-slate-300">{cap}</span>
                      {i < engine.capabilities.length - 1 && (
                        <span className="text-slate-600" aria-hidden="true">
                          /
                        </span>
                      )}
                    </React.Fragment>
                  ))}
                </div>

                {pingFeedback[engine.id] && (
                  <div className="text-xs text-emerald-300 font-mono-tabular pt-1">
                    {pingFeedback[engine.id]}
                  </div>
                )}
              </div>

              {/* Right Controls & Telemetry */}
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-6 shrink-0 border-t lg:border-t-0 pt-4 lg:pt-0 border-slate-800">
                <div className="text-right">
                  <div className="text-xs text-slate-400">متوسط السرعة</div>
                  <div className="text-sm font-mono-tabular font-semibold text-white">
                    {engine.avgLatencyMs} ms
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-slate-400">معدل النجاح</div>
                  <div className="text-sm font-mono-tabular font-semibold text-emerald-400">
                    {engine.successRate}%
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-slate-400">الطلبات المنفذة</div>
                  <div className="text-sm font-mono-tabular font-semibold text-slate-200">
                    {engine.totalCalls}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePing(engine.id)}
                    disabled={pingingId === engine.id}
                    className="px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    {pingingId === engine.id ? "جاري الفحص..." : "فحص الاستجابة"}
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleEngine(engine.id, !engine.enabled)}
                    className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                      engine.enabled
                        ? "bg-slate-950 border-slate-800 text-slate-300 hover:border-red-800 hover:text-red-300"
                        : "bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-500"
                    }`}
                  >
                    {engine.enabled ? "إيقاف مؤقت" : "تفعيل المحرك"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
