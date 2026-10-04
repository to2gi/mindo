import React, { useState, useRef } from "react";
import {
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { EngineNode, TaskLogEntry } from "../types";

interface MindoSimulatorViewProps {
  engines: EngineNode[];
  latestLog: TaskLogEntry | null;
  isExecuting: boolean;
  onExecuteCommand: (
    query: string,
    preferredEngine: string,
    speakOut: boolean
  ) => Promise<void>;
  initialCommand?: string;
}

const PRESET_COMMANDS = [
  {
    category: "حسابات مالية + أسعار صرف حية الآن",
    command:
      "احسب الجذر التربيعي لـ 15625 ضرب 24 وحول الناتج من الدولار الأمريكي إلى الريال السعودي والدرهم الإماراتي بسعر اليوم",
  },
  {
    category: "سؤال علمي عميق + بحث جوجل الحي",
    command:
      "اشرح لي بدقة كيف تعمل الحوسبة الكمومية وما الفرق الجوهري بين الكيوبت والبت التقليدي في معالجة الخوارزميات؟",
  },
  {
    category: "حالة الطقس المباشرة + أمر هاتف مركب",
    command:
      "ما هي درجة الحرارة وحالة الطقس الآن في الرياض وافتح تطبيق الخرائط",
  },
  {
    category: "معادلة رياضية فورية (محرك الخادم المباشر)",
    command: "احسب (4850 + 7150) مقسوم على 25 مضافاً إليه 16 أس 2",
  },
];

export const MindoSimulatorView: React.FC<MindoSimulatorViewProps> = ({
  engines,
  latestLog,
  isExecuting,
  onExecuteCommand,
  initialCommand = "",
}) => {
  const [commandInput, setCommandInput] = useState(
    initialCommand || PRESET_COMMANDS[0].command
  );
  const [preferredEngine, setPreferredEngine] = useState<string>("auto");
  const [speakOutLoud, setSpeakOutLoud] = useState<boolean>(true);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  React.useEffect(() => {
    if (initialCommand) {
      setCommandInput(initialCommand);
    }
  }, [initialCommand]);

  const toggleVoiceInput = () => {
    setSpeechError(null);
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechError(
        "المتصفح الحالي لا يدعم الالتقاط الصوتي المباشر، يمكنك كتابة السؤال مباشرة في الحقل أدناه."
      );
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "ar-SA";
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setCommandInput(transcript);
          onExecuteCommand(transcript, preferredEngine, speakOutLoud);
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
        setSpeechError(
          "تعذر الوصول للميكروفون، تأكد من منح الإذن أو اكتب السؤال مباشرة."
        );
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
      setSpeechError("تعذر تشغيل الميكروفون في هذه النافذة.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim() || isExecuting) return;
    await onExecuteCommand(commandInput, preferredEngine, speakOutLoud);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Right Column (in RTL): Live API Execution Gateway */}
      <div className="lg:col-span-5 border border-slate-800 bg-slate-900/60 rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              بوابة التنفيذ الفعلي للمهام (Live API Console)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              تتصل مباشرة بنقطة النهاية الحقيقية{" "}
              <span className="font-mono-tabular text-emerald-400">
                POST /api/v1/mindo/execute
              </span>{" "}
              وبمفتاح Gemini الفعلي المضاف
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSpeakOutLoud(!speakOutLoud)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
              speakOutLoud
                ? "bg-emerald-950/60 border-emerald-700/60 text-emerald-300"
                : "bg-slate-950 border-slate-800 text-slate-400"
            }`}
            title="نطق الإجابة صوتياً"
          >
            {speakOutLoud ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
            <span>{speakOutLoud ? "النطق الصوتي مفعّل" : "النطق الصوتي صامت"}</span>
          </button>
        </div>

        {/* Preset Heavy Questions */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-slate-400">
            اضغط لتنفيذ سؤال قوي فعلي عبر الخادم الآن:
          </div>
          <div className="grid grid-cols-1 gap-2">
            {PRESET_COMMANDS.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setCommandInput(item.command);
                  onExecuteCommand(item.command, preferredEngine, speakOutLoud);
                }}
                disabled={isExecuting}
                className="text-right p-3 rounded-lg bg-slate-950/90 hover:bg-slate-800/80 border border-slate-800/90 transition-colors cursor-pointer group disabled:opacity-50"
              >
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span className="text-emerald-400 font-medium">
                    {item.category}
                  </span>
                  <span className="group-hover:text-slate-200 transition-colors">
                    تنفيذ حي ←
                  </span>
                </div>
                <div className="text-xs text-slate-200 leading-relaxed line-clamp-2">
                  &quot;{item.command}&quot;
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Live Question & Voice Form */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4 pt-2 border-t border-slate-800"
        >
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-2">
              اكتب أي سؤال معقد أو مسألة حسابية أو أمر صوتي لإرساله للخادم:
            </label>
            <textarea
              rows={3}
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="اكتب أي سؤال علمي، رياضي، أو بحثي هنا..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors leading-relaxed"
            />
          </div>

          {speechError && (
            <p className="text-xs text-amber-400 leading-relaxed">
              {speechError}
            </p>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">
                النموذج السحابي المنفذ:
              </label>
              <select
                value={preferredEngine}
                onChange={(e) => setPreferredEngine(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="auto">
                  توجيه ذكي تلقائي (Gemini 3.8 + أدوات حية)
                </option>
                {engines
                  .filter((e) => e.enabled)
                  .map((eng) => (
                    <option key={eng.id} value={eng.id}>
                      {eng.name} ({eng.requiresKey ? "سحابي بمفتاح" : "مفتوح بدون مفتاح"})
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-2 pt-4 sm:pt-5">
              <button
                type="button"
                onClick={toggleVoiceInput}
                className={`p-2.5 rounded-lg border transition-colors cursor-pointer ${
                  isListening
                    ? "bg-red-600 border-red-500 text-white animate-pulse"
                    : "bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800"
                }`}
                title="إدخال صوتي عبر الميكروفون"
              >
                {isListening ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>

              <button
                type="submit"
                disabled={isExecuting || !commandInput.trim()}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                {isExecuting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>جاري الاتصال الفعلي...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>تنفيذ فعلي الآن</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Left Column (in RTL): Real Server Output & JSON Payload */}
      <div className="lg:col-span-7 border border-slate-800 bg-slate-900/60 rounded-xl p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              الإجابة الحقيقية المستخرجة من الخادم والمرسلة لتطبيق الهاتف
            </h2>
            {latestLog && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
                <span className="font-mono-tabular text-emerald-400">
                  {latestLog.id}
                </span>
                <span aria-hidden="true">·</span>
                <span>{latestLog.intentLabelAr}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  زمن التنفيذ الفعلي: {latestLog.latencyMs} ms
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  حجم الرد: {latestLog.mobilePayloadBytes} B
                </span>
              </div>
            )}
          </div>
        </div>

        {!latestLog ? (
          <div className="py-16 text-center space-y-3">
            <p className="text-sm text-slate-300 font-medium">
              الخادم جاهز تماماً لاستقبال الأسئلة الحقيقية!
            </p>
            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
              اضغط على زر &quot;تنفيذ فعلي الآن&quot; أو اختر أحد الأسئلة من القائمة الجانبية ليقوم مفتاح Gemini الفعلي والمحركات الحية بالإجابة فوراً.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Spoken Reply for Mindo Voice Assistant */}
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-5 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>الرد الصوتي المباشر لتطبيق ميندو (spokenReply)</span>
                <span className="text-emerald-400 font-medium">
                  {latestLog.selectedEngineName}
                </span>
              </div>
              <p className="text-base font-medium text-white leading-relaxed">
                &quot;{latestLog.spokenReply}&quot;
              </p>
            </div>

            {/* Detailed Answer (Full Deep Explanation) */}
            {latestLog.detailedAnswer &&
              latestLog.detailedAnswer !== latestLog.spokenReply && (
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-5 space-y-2">
                  <div className="text-xs text-slate-400">
                    الإجابة التفصيلية الكاملة للأسئلة القوية (detailedAnswer)
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-line">
                    {latestLog.detailedAnswer}
                  </p>
                </div>
              )}

            {/* Computed Value & Device Action */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-1.5">
                <div className="text-xs text-slate-400">
                  النتيجة الرقمية / الخلاصة الفورية (computedResult)
                </div>
                <div className="font-mono-tabular text-sm font-semibold text-emerald-400 break-words">
                  {latestLog.structuredData.computedResult ||
                    "تمت المعالجة واستخراج الإجابة الكاملة"}
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-1.5">
                <div className="text-xs text-slate-400">
                  أمر التنفيذ المرافق للهاتف (deviceAction Intent)
                </div>
                {latestLog.structuredData.deviceAction &&
                latestLog.structuredData.deviceAction.actionType !== "NONE" ? (
                  <div className="font-mono-tabular text-xs text-amber-300 space-y-1">
                    <div>
                      {latestLog.structuredData.deviceAction.actionType} →{" "}
                      {latestLog.structuredData.deviceAction.targetApp}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">
                    سؤال معلوماتي/حسابي مباشر (لا يتطلب فتح تطبيق آخر)
                  </div>
                )}
              </div>
            </div>

            {/* Key Facts */}
            {latestLog.structuredData.keyFacts &&
              latestLog.structuredData.keyFacts.length > 0 && (
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
                  <div className="text-xs text-slate-400">
                    الحقائق والخطوات المستخلصة:
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-200 list-disc list-inside">
                    {latestLog.structuredData.keyFacts.map((fact, i) => (
                      <li key={i} className="leading-relaxed">
                        {fact}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {/* Grounding Sources */}
            {latestLog.sources && latestLog.sources.length > 0 && (
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
                <div className="text-xs text-slate-400">
                  المصادر الحقيقية الموثقة (Google Search & Live APIs):
                </div>
                <div className="flex flex-col gap-1.5">
                  {latestLog.sources.map((src, i) => (
                    <a
                      key={i}
                      href={src.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between text-xs text-emerald-400 hover:underline py-1"
                    >
                      <span className="truncate">{src.title}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0 ms-2" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Raw JSON Payload */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>حزمة JSON الحقيقية التي يستلمها تطبيق ميندو على الهاتف</span>
                <span className="font-mono-tabular">
                  {latestLog.mobilePayloadBytes} Bytes
                </span>
              </div>
              <div
                className="bg-slate-950 border border-slate-800 rounded-lg p-4 overflow-x-auto"
                dir="ltr"
              >
                <pre className="text-xs font-mono-tabular text-slate-300 leading-relaxed">
                  <code>
                    {JSON.stringify(
                      {
                        status: "ok",
                        requestId: latestLog.id,
                        spokenReply: latestLog.spokenReply,
                        detailedAnswer: latestLog.detailedAnswer,
                        structuredData: latestLog.structuredData,
                        sources: latestLog.sources,
                      },
                      null,
                      2
                    )}
                  </code>
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
