import type { ProcessingStage } from "../app/types";

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
  result: unknown;
  versionMatch: unknown;
  materials: unknown[];
}

export interface ParseErrorResponse {
  type: "error";
  message: string;
  stack?: string;
}

export type WorkerResponse = ParseProgressResponse | ParseResultResponse | ParseErrorResponse;
