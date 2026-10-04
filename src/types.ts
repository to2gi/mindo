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
}
