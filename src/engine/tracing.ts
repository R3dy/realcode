import { trace, context, propagation, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

let sdk: NodeSDK | null = null;

export function initTracing(serviceName: string = "realcode", collectorUrl?: string) {
  const exporter = new OTLPTraceExporter({
    url: collectorUrl || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:6006/v1/traces",
  });

  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    }),
    traceExporter: exporter,
  });

  sdk.start();
  return sdk;
}

export function shutdownTracing() {
  return sdk?.shutdown();
}

export interface SpanResult<T> {
  result: T;
  spanId: string;
  traceId: string;
}

export function startRunSpan(runId: string, idea: string) {
  const tracer = trace.getTracer("realcode");
  return tracer.startSpan(`run:${runId}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "realcode.run_id": runId,
      "realcode.idea": idea,
      "realcode.span_type": "run",
    },
  });
}

export function startStageSpan(runId: string, stageId: string, model: string) {
  const tracer = trace.getTracer("realcode");
  return tracer.startSpan(`stage:${stageId}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "realcode.run_id": runId,
      "realcode.stage": stageId,
      "realcode.model": model,
      "realcode.span_type": "stage",
    },
  });
}

export function startTurnSpan(runId: string, stageId: string, turnIndex: number, agent: string, model: string) {
  const tracer = trace.getTracer("realcode");
  return tracer.startSpan(`turn:${stageId}:${turnIndex}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "realcode.run_id": runId,
      "realcode.stage": stageId,
      "realcode.turn": turnIndex,
      "realcode.agent": agent,
      "realcode.model": model,
      "realcode.span_type": "turn",
    },
  });
}

export function recordTokenUsage(span: ReturnType<typeof startTurnSpan>, tokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated_cost_usd: number }) {
  span.setAttributes({
    "realcode.tokens.prompt": tokens.prompt_tokens,
    "realcode.tokens.completion": tokens.completion_tokens,
    "realcode.tokens.total": tokens.total_tokens,
    "realcode.cost.usd": tokens.estimated_cost_usd,
  });
}

export function injectTraceparent(): string {
  const ctx = context.active();
  const carrier: Record<string, string> = {};
  propagation.inject(ctx, carrier);
  return carrier.traceparent || "";
}

export function endSpan(span: ReturnType<typeof startRunSpan>, success: boolean, error?: string) {
  if (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error });
    span.setAttribute("error.message", error);
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}
