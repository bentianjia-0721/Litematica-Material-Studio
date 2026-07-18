import type { ProcessingStage } from "../app/types";
import type { LitematicParseResult } from "../lib/litematic";

export interface ParseWorkerRequest {
  type: "parse";
  buffer: ArrayBuffer;
  projectId: string;
  fileName: string;
  fileSize: number;
}

export interface CancelWorkerRequest {
  type: "cancel";
}

export type WorkerRequest = ParseWorkerRequest | CancelWorkerRequest;

export interface ParseProgressResponse {
  type: "progress";
  stage: ProcessingStage;
  progress: number;
  detail?: string;
}

export interface ParseResultResponse {
  type: "result";
  result: LitematicParseResult;
  versionMatch: unknown;
  materials: unknown[];
}

/** Buffers transferred with a parse result so preview data is not cloned. */
export function parseResultTransferables(result: LitematicParseResult): Transferable[] {
  return [
    result.preview.positions.buffer as ArrayBuffer,
    result.preview.stateIndices.buffer as ArrayBuffer,
  ];
}

export interface ParseErrorResponse {
  type: "error";
  message: string;
  stack?: string;
}

export type WorkerResponse = ParseProgressResponse | ParseResultResponse | ParseErrorResponse;
