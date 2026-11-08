import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { readMultipartIngressDiagnostics } from "../../../../lib/multipartIngressDiagnostics";
import { parseMultipartFormData } from "../../../../lib/multipartFormData";
import { probeExtractImageUpload } from "../../../../lib/reportExtractImageProbe";
import {
  buildExtractDiagnosticResponse,
  classifyExtractProviderFailure,
  createReportExtractRequestId,
  extractDiagnosticResponseHeaders,
  logReportExtractTrace,
  readExtractAttemptFromRequest,
  sanitizeExtractSentryExtra,
  type ReportExtractImageMeta,
} from "../../../../lib/reportExtractDiagnostics";
import {
  extractReportFromImage,
  ExtractProviderError,
} from "../../../../lib/reportExtractProvider";

export const runtime = "nodejs";

function jsonWithDiagnostic(
  body: Record<string, unknown>,
  status: number,
  requestId: string,
): NextResponse {
  const res = NextResponse.json(body, { status });
  for (const [key, value] of Object.entries(
    extractDiagnosticResponseHeaders(requestId),
  )) {
    res.headers.set(key, value);
  }
  return res;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const requestId = createReportExtractRequestId();
  let { attemptId, vercelRequestId } = readExtractAttemptFromRequest(
    req,
    requestId,
  );

  logReportExtractTrace({
    event: "report_extract_trace",
    attemptId,
    requestId,
    vercelRequestId,
    phase: "entry",
    durationMs: 0,
  });

  const diagnosticBase = { attemptId, requestId };

  try {
    const multipartStartedAt = Date.now();
    logReportExtractTrace({
      event: "report_extract_trace",
      attemptId,
      requestId,
      vercelRequestId,
      phase: "multipart_start",
      durationMs: Date.now() - startedAt,
    });

    const uploadIngress = readMultipartIngressDiagnostics(req);
    const parsedForm = await parseMultipartFormData(req);
    if (!parsedForm.ok) {
      const httpStatus = parsedForm.status;
      logReportExtractTrace({
        event: "report_extract_trace",
        attemptId,
        requestId,
        vercelRequestId,
        phase: "multipart_fail",
        outcome: "error",
        durationMs: Date.now() - startedAt,
        stageDurationMs: Date.now() - multipartStartedAt,
        httpStatus,
        errorClass: "multipart_rejected",
        errorCode: parsedForm.error,
        uploadIngress,
      });
      return jsonWithDiagnostic(
        {
          error: parsedForm.error,
          message: parsedForm.message,
          diagnostic: buildExtractDiagnosticResponse({
            ...diagnosticBase,
            errorClass: "multipart_rejected",
          }),
        },
        httpStatus,
        requestId,
      );
    }

    logReportExtractTrace({
      event: "report_extract_trace",
      attemptId,
      requestId,
      vercelRequestId,
      phase: "multipart_ok",
      durationMs: Date.now() - startedAt,
      stageDurationMs: Date.now() - multipartStartedAt,
    });

    const formAttemptField = parsedForm.form.get("extractAttemptId");
    const formAttempt =
      typeof formAttemptField === "string" ? formAttemptField : null;
    const resolvedAttempt = readExtractAttemptFromRequest(
      req,
      requestId,
      formAttempt,
    );
    attemptId = resolvedAttempt.attemptId;
    vercelRequestId = resolvedAttempt.vercelRequestId ?? vercelRequestId;

    const file = parsedForm.form.get("image") as File | null;
    if (!file) {
      logReportExtractTrace({
        event: "report_extract_trace",
        attemptId,
        requestId,
        vercelRequestId,
        phase: "multipart_fail",
        outcome: "error",
        durationMs: Date.now() - startedAt,
        httpStatus: 400,
        errorClass: "image_missing",
        errorCode: "image_required",
      });
      return jsonWithDiagnostic(
        {
          error: "image_required",
          message: "Geen afbeelding ontvangen.",
          diagnostic: buildExtractDiagnosticResponse({
            ...diagnosticBase,
            errorClass: "image_missing",
          }),
        },
        400,
        requestId,
      );
    }

    const preprocessStartedAt = Date.now();
    logReportExtractTrace({
      event: "report_extract_trace",
      attemptId,
      requestId,
      vercelRequestId,
      phase: "preprocess_start",
      durationMs: Date.now() - startedAt,
    });

    const probe = await probeExtractImageUpload(file);
    let imageMeta: ReportExtractImageMeta = {
      mimeType: probe.mimeType,
      bytes: probe.bytes,
    };

    if (!probe.ok) {
      logReportExtractTrace({
        event: "report_extract_trace",
        attemptId,
        requestId,
        vercelRequestId,
        phase: "preprocess_fail",
        outcome: "error",
        durationMs: Date.now() - startedAt,
        stageDurationMs: Date.now() - preprocessStartedAt,
        httpStatus: 422,
        errorClass: probe.errorClass,
        errorCode: "preprocess_unreadable",
        image: imageMeta,
      });
      return jsonWithDiagnostic(
        {
          error: "preprocess_unreadable",
          message:
            "De afbeelding kon niet worden ingelezen. Probeer een JPEG- of PNG-export.",
          diagnostic: buildExtractDiagnosticResponse({
            ...diagnosticBase,
            errorClass: probe.errorClass,
          }),
        },
        422,
        requestId,
      );
    }

    imageMeta = {
      mimeType: probe.mimeType,
      bytes: probe.bytes,
      width: probe.width,
      height: probe.height,
      visionResizePlanned: probe.visionResizePlanned,
      outputMimeType: probe.outputMimeType,
      outputWidth: probe.outputWidth,
      outputHeight: probe.outputHeight,
    };

    logReportExtractTrace({
      event: "report_extract_trace",
      attemptId,
      requestId,
      vercelRequestId,
      phase: "preprocess_ok",
      durationMs: Date.now() - startedAt,
      stageDurationMs: Date.now() - preprocessStartedAt,
      image: imageMeta,
    });

    const providerStartedAt = Date.now();
    logReportExtractTrace({
      event: "report_extract_trace",
      attemptId,
      requestId,
      vercelRequestId,
      phase: "provider_start",
      durationMs: Date.now() - startedAt,
      image: imageMeta,
    });

    const extracted = await extractReportFromImage(file, {
      flowId: attemptId,
      onStage: (stage) => {
        if (stage.phase === "vision_preprocess") {
          logReportExtractTrace({
            event: "report_extract_trace",
            attemptId,
            requestId,
            vercelRequestId,
            phase: "preprocess_ok",
            durationMs: Date.now() - startedAt,
            image: {
              ...imageMeta,
              outputBytes: stage.outputBytes,
              outputMimeType: stage.outputMimeType,
              outputWidth: stage.outputWidth,
              outputHeight: stage.outputHeight,
              visionResizePlanned: stage.resized,
            },
          });
        }
        if (stage.phase === "provider_done") {
          logReportExtractTrace({
            event: "report_extract_trace",
            attemptId,
            requestId,
            vercelRequestId,
            phase: "provider_ok",
            durationMs: Date.now() - startedAt,
            stageDurationMs: Date.now() - providerStartedAt,
            provider: {
              providerUsed: stage.providerUsed,
            },
          });
        }
      },
    });

    logReportExtractTrace({
      event: "report_extract_trace",
      attemptId,
      requestId,
      vercelRequestId,
      phase: "completed",
      outcome: "success",
      durationMs: Date.now() - startedAt,
      stageDurationMs: Date.now() - providerStartedAt,
      httpStatus: 200,
      provider: {
        providerUsed: extracted.providerUsed,
        model: extracted.model,
        fallbackUsed: extracted.fallbackUsed,
      },
    });

    console.info("report_extract_completed", {
      attemptId,
      requestId,
      vercelRequestId,
      providerUsed: extracted.providerUsed,
      model: extracted.model,
      openAiModelSubstitutedFrom: extracted.openAiModelSubstitutedFrom,
      fallbackUsed: extracted.fallbackUsed,
      latencyMs: extracted.latencyMs,
      durationMs: Date.now() - startedAt,
    });

    const res = jsonWithDiagnostic(
      {
        result: extracted.result,
        raw_text: extracted.rawText,
        meta: {
          providerUsed: extracted.providerUsed,
          model: extracted.model,
          fallbackUsed: extracted.fallbackUsed,
        },
        diagnostic: buildExtractDiagnosticResponse(diagnosticBase),
      },
      200,
      requestId,
    );
    return res;
  } catch (error: unknown) {
    const latencyMs = Date.now() - startedAt;
    if (error instanceof ExtractProviderError) {
      const errorClass = classifyExtractProviderFailure({
        info: error.info,
        providerTelemetry: error.providerTelemetry,
      });
      logReportExtractTrace({
        event: "report_extract_trace",
        attemptId,
        requestId,
        vercelRequestId,
        phase: "provider_fail",
        outcome: "error",
        durationMs: latencyMs,
        httpStatus: error.status,
        upstreamHttpStatus: error.providerTelemetry?.upstreamHttpStatus,
        errorClass,
        errorCode: error.code,
        provider: {
          providerUsed: error.providerUsed,
          model: error.model,
          fallbackUsed: error.fallbackUsed,
        },
        providerTelemetry: error.providerTelemetry,
      });
      Sentry.captureException(error, {
        tags: {
          module: "report_extract",
          provider: error.providerUsed || error.provider || "unknown",
          operation: "extract",
          error_class: errorClass,
          sdk_error: error.providerTelemetry?.sdkErrorName ?? "unknown",
          failure_kind: error.providerTelemetry?.failureKind ?? "unknown",
        },
        extra: sanitizeExtractSentryExtra({
          attemptId,
          requestId,
          vercelRequestId,
          flowId: attemptId,
          code: error.code,
          appHttpStatus: error.status,
          upstreamHttpStatus: error.providerTelemetry?.upstreamHttpStatus,
          model: error.model,
          fallbackUsed: error.fallbackUsed,
          latencyMs,
          providerTelemetry: error.providerTelemetry,
        }),
      });
      return jsonWithDiagnostic(
        {
          error: error.code,
          message: error.message,
          diagnostic: buildExtractDiagnosticResponse({
            ...diagnosticBase,
            errorClass,
          }),
        },
        error.status,
        requestId,
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    logReportExtractTrace({
      event: "report_extract_trace",
      attemptId,
      requestId,
      vercelRequestId,
      phase: "failed",
      outcome: "error",
      durationMs: latencyMs,
      httpStatus: 500,
      errorClass: "unexpected",
      errorCode: "failed",
    });
    Sentry.captureException(error, {
      tags: {
        module: "report_extract",
        operation: "extract",
        error_class: "unexpected",
      },
      extra: sanitizeExtractSentryExtra({
        attemptId,
        requestId,
        vercelRequestId,
        latencyMs,
      }),
    });
    return jsonWithDiagnostic(
      {
        error: "failed",
        message: "Screenshot verwerken mislukt.",
        diagnostic: buildExtractDiagnosticResponse({
          ...diagnosticBase,
          errorClass: "unexpected",
        }),
      },
      500,
      requestId,
    );
  }
}
