export interface EngineNode {
  id: string;
  name: string;
  provider: string;
  modelIdentifier: string;
  category: "cloud_api" | "keyless_open" | "local_compute";
  requiresKey: boolean;
  keyConfigured?: boolean;
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

export interface KeepAliveState {
  enabled: boolean;
  intervalMinutes: number;
  targetUrl: string;
  totalHeartbeats: number;
  lastHeartbeatAt: string | null;
  lastHeartbeatStatus: "ok" | "pending" | "error";
  uptimeSeconds: number;
}

export interface MindoActionStep {
  type: "click" | "type" | "find" | "delete" | "autofill" | "wait" | "navigate";
  label?: string;
  text?: string;
  target?: string;
}

export interface MindoActionPayload {
  action:
    | "workflow"
    | "open_app"
    | "open_url"
    | "open_settings"
    | "call_contact"
    | "set_alarm"
    | "set_timer"
    | "toggle_flashlight"
    | "set_volume"
    | "click"
    | "type"
    | "video_download"
    | "search_and_download_book"
    | "search_and_download_image"
    | "none";
  target: string;
  args?: {
    steps?: MindoActionStep[];
    verification?: string;
    [key: string]: any;
  };
  explanation?: string;
}

export interface OnlineTaskResult {
  status: "ok" | "error";
  taskId: string;
  task: string;
  executedResult: string;
  actionPayload?: MindoActionPayload;
  executionSteps: Array<{ stepNumber: number; title: string; detail: string; status: "completed" | "in_progress" | "failed" }>;
  structuredOutput?: Record<string, any>;
  sources: Array<{ title: string; uri: string }>;
  modelUsed: string;
  telemetryEcho?: {
    deviceModel?: string;
    androidVersion?: string;
    currentApp?: string;
    verificationStatus?: string;
  };
  executionTimeMs: number;
  timestamp: string;
}

export interface OnlineTaskConfig {
  customSystemPrompt: string;
  defaultEngine: string;
  autoWebGrounding: boolean;
  maxExecutionSteps: number;
  timeoutSeconds: number;
  lastUpdated: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  modelUsed?: string;
  latencyMs?: number;
}

export interface ChatModelOption {
  id: string;
  name: string;
  provider: string;
  type: "fast" | "smart" | "keyless";
  contextWindow: string;
  allocatedQuota: string;
  descriptionAr: string;
  isRecommended?: boolean;
}

export interface OverviewData {
  systemStatus?: {
    isProductionReady: boolean;
    geminiKeyActive: boolean;
    groqKeyActive: boolean;
    publicEndpointUrl: string;
  };
  keepAlive?: KeepAliveState;
  metrics: {
    totalRequests: number;
    avgLatencyMs: number;
    totalSavedKB: number;
    successRate: number;
    activeEnginesCount: number;
    keylessEnginesCount: number;
  };
  engines: EngineNode[];
  routingConfig: RoutingConfig;
  recentLogs: TaskLogEntry[];
  onlineTaskConfig?: OnlineTaskConfig;
}
