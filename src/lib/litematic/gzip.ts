import { Inflate } from "pako";

const DEFAULT_MAX_COMPRESSED_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
const INFLATE_CHUNK_BYTES = 64 * 1024;

export interface GzipLimits {
  readonly maxCompressedBytes?: number;
  readonly maxOutputBytes?: number;
}

export class GzipError extends Error {
  readonly code: "INVALID_GZIP" | "COMPRESSED_SIZE_LIMIT" | "DECOMPRESSED_SIZE_LIMIT";

  constructor(code: GzipError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GzipError";
    this.code = code;
  }
}

function validatePositiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }

  return value;
}

/**
 * Decompresses a gzip stream with pako while bounding both compressed and
 * inflated data. Output chunks are collected incrementally so a zip bomb can
 * be rejected before one giant output buffer is allocated.
 */
export function decompressGzip(
  input: Uint8Array | ArrayBuffer,
  limits: GzipLimits = {},
): Uint8Array {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxCompressedBytes = validatePositiveLimit(
    limits.maxCompressedBytes ?? DEFAULT_MAX_COMPRESSED_BYTES,
    "maxCompressedBytes",
  );
  const maxOutputBytes = validatePositiveLimit(
    limits.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    "maxOutputBytes",
  );

  if (bytes.byteLength > maxCompressedBytes) {
    throw new GzipError(
      "COMPRESSED_SIZE_LIMIT",
      `Compressed input is ${bytes.byteLength} bytes; limit is ${maxCompressedBytes}`,
    );
  }

  // pako's inflate() also accepts zlib streams. A .litematic is specifically
  // gzip NBT, so reject other wrappers up front and give a useful error.
  if (bytes.byteLength < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new GzipError("INVALID_GZIP", "Input does not have a gzip header");
  }

  const chunks: Uint8Array[] = [];
  let outputLength = 0;
  const inflator = new Inflate({ chunkSize: INFLATE_CHUNK_BYTES });

  inflator.onData = (chunk): void => {
    const output = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    outputLength += output.byteLength;

    if (outputLength > maxOutputBytes) {
      throw new GzipError(
        "DECOMPRESSED_SIZE_LIMIT",
        `Decompressed input exceeds ${maxOutputBytes} bytes`,
      );
    }

    // pako may reuse its output buffer between callbacks.
    chunks.push(output.slice());
  };

  try {
    for (let offset = 0; offset < bytes.byteLength; offset += INFLATE_CHUNK_BYTES) {
      const end = Math.min(offset + INFLATE_CHUNK_BYTES, bytes.byteLength);
      const isLast = end === bytes.byteLength;
      const ok = inflator.push(bytes.subarray(offset, end), isLast);

      if (!ok || inflator.err !== 0) {
        throw new GzipError(
          "INVALID_GZIP",
          inflator.msg || "The gzip stream is corrupt or incomplete",
        );
      }
    }
  } catch (error) {
    if (error instanceof GzipError) {
      throw error;
    }

    throw new GzipError(
      "INVALID_GZIP",
      error instanceof Error
        ? `Unable to decompress gzip data: ${error.message}`
        : "Unable to decompress gzip data",
      error instanceof Error ? { cause: error } : undefined,
    );
  }

  const result = new Uint8Array(outputLength);
  let resultOffset = 0;

  for (const chunk of chunks) {
    result.set(chunk, resultOffset);
    resultOffset += chunk.byteLength;
  }

  return result;
}
