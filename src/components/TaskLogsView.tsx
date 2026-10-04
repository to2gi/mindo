import React, { useState } from "react";
import { Search, Download, Trash2, ExternalLink } from "lucide-react";
import { TaskLogEntry } from "../types";

interface TaskLogsViewProps {
  logs: TaskLogEntry[];
  onClearLogs: () => Promise<void>;
  onSelectLogForSimulator: (command: string) => void;
}

export const TaskLogsView: React.FC<TaskLogsViewProps> = ({
  logs,
  onClearLogs,
  onSelectLogForSimulator,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [intentFilter, setIntentFilter] = useState<string>("all");
  const [selectedLog, setSelectedLog] = useState<TaskLogEntry | null>(logs[0] || null);

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.voiceCommand.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.spokenReply.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.deviceModel.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesIntent = intentFilter === "all" || log.detectedIntent === intentFilter;
    return matchesSearch && matchesIntent;
  });

  const handleExportJSON = () => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(filteredLogs, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `mindo-cloud-logs-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="space-y-6">
      {/* Filter & Search Bar */}
      <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
          {[
            { id: "all", label: "جميع المهام" },
            { id: "math_computation", label: "عمليات حسابية" },
            { id: "live_search", label: "بحث فوري" },
            { id: "hybrid_device_action", label: "أوامر هاتف مركبة" },
            { id: "deep_reasoning", label: "تحليل منطقي" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setIntentFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                intentFilter === tab.id
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ابحث في الأوامر الصوتية أو الأجهزة..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pr-9 pl-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <button
            type="button"
            onClick={handleExportJSON}
            disabled={filteredLogs.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>تصدير JSON</span>
          </button>

          <button
            type="button"
            onClick={onClearLogs}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-950 border border-slate-800 hover:border-red-800 hover:text-red-300 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>مسح السجل</span>
          </button>
        </div>
      </div>

      {/* Empty State or Master-Detail Grid */}
      {filteredLogs.length === 0 ? (
        <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-12 text-center space-y-4">
          <h3 className="text-base font-semibold text-white">
            لا توجد سجلات مطابقة في الوقت الحالي
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            بمجرد قيام مستخدمي تطبيق ميندو بإرسال أوامر صوتية ثقيلة أو إجراء اختبار من المحاكي، ستظهر تفاصيل المعالجة السحابية وحجم البيانات الموفرة هنا.
          </p>
          <button
            type="button"
            onClick={() =>
              onSelectLogForSimulator(
                "يا ميندو، احسب الجذر التربيعي لـ 15625 ضرب 18.5 وابحث عن سعر الريال اليوم"
              )
            }
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            تشغيل مهمة اختبارية الآن
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* High-Density Logs Table */}
          <div className="lg:col-span-7 border border-slate-800 bg-slate-900/50 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                    <th className="py-3 px-4 font-medium">المعرف / الجهاز</th>
                    <th className="py-3 px-4 font-medium">الأمر الصوتي المرسل من الهاتف</th>
                    <th className="py-3 px-4 font-medium">المحرك المنفذ</th>
                    <th className="py-3 px-4 font-medium text-left">الزمن / الحجم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredLogs.map((log) => {
                    const isSelected = selectedLog?.id === log.id;
                    return (
                      <tr
                        key={log.id}
                        onClick={() => setSelectedLog(log)}
                        className={`transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-emerald-950/25"
                            : "hover:bg-slate-800/40"
                        }`}
                      >
                        <td className="py-3.5 px-4 align-top whitespace-nowrap">
                          <div className="font-mono-tabular font-semibold text-emerald-400">
                            {log.id}
                          </div>
                          <div className="text-slate-400 mt-0.5 truncate max-w-[140px]">
                            {log.deviceModel}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 align-top">
                          <div className="text-slate-100 font-medium line-clamp-2 leading-relaxed">
                            {log.voiceCommand}
                          </div>
                          <div className="text-slate-400 mt-1 flex items-center gap-1.5">
                            <span>{log.intentLabelAr}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">
                              {new Date(log.timestamp).toLocaleTimeString("ar-SA")}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 align-top">
                          <div className="text-slate-200">{log.selectedEngineName}</div>
                          {log.keylessToolsUsed.length > 0 && (
                            <div className="text-slate-400 mt-0.5">
                              + {log.keylessToolsUsed.join(" / ")}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 align-top text-left font-mono-tabular whitespace-nowrap">
                          <div className="text-white font-medium">{log.latencyMs} ms</div>
                          <div className="text-emerald-400 mt-0.5">
                            {log.mobilePayloadBytes} B (-{log.bandwidthSavedPercent}%)
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detailed Inspector Panel */}
          <div className="lg:col-span-5 border border-slate-800 bg-slate-900/50 rounded-xl p-6 space-y-5">
            {selectedLog ? (
              <>
                <div className="border-b border-slate-800 pb-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono-tabular text-emerald-400 font-semibold">
                        {selectedLog.id}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{selectedLog.deviceModel}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-white mt-1 leading-relaxed">
                      &quot;{selectedLog.voiceCommand}&quot;
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectLogForSimulator(selectedLog.voiceCommand)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer shrink-0"
                  >
                    إعادة الاختبار
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-1.5">
                    <div className="text-slate-400">الرد الصوتي المرسل لتطبيق الهاتف:</div>
                    <p className="text-slate-100 text-sm leading-relaxed font-medium">
                      {selectedLog.spokenReply}
                    </p>
                  </div>

                  {selectedLog.structuredData.computedResult && (
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
                      <div className="text-slate-400">النتيجة الحسابية / الملخص المركز:</div>
                      <div className="font-mono-tabular text-emerald-400 font-semibold text-sm">
                        {selectedLog.structuredData.computedResult}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 font-mono-tabular">
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                      <div className="text-slate-400 font-sans">المعالجة السحابية الخام</div>
                      <div className="text-slate-200 text-sm mt-1">
                        {(selectedLog.rawProcessingBytes / 1024).toFixed(1)} KB
                      </div>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                      <div className="text-slate-400 font-sans">البيانات المرسلة للهاتف</div>
                      <div className="text-emerald-400 text-sm font-semibold mt-1">
                        {selectedLog.mobilePayloadBytes} Bytes
                      </div>
                    </div>
                  </div>

                  {selectedLog.sources.length > 0 && (
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1.5">
                      <div className="text-slate-400">المصادر الموثقة:</div>
                      {selectedLog.sources.map((s, idx) => (
                        <a
                          key={idx}
                          href={s.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between text-emerald-400 hover:underline py-0.5"
                        >
                          <span className="truncate">{s.title}</span>
                          <ExternalLink className="w-3.5 h-3.5 shrink-0 ms-2" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">
                اختر أي عملية من الجدول لمعاينة تفاصيل الحزمة المضغوطة.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
