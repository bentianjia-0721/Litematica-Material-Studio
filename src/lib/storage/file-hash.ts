export type HashableFileContent = ArrayBuffer | ArrayBufferView | Blob | string;

async function toBytes(content: HashableFileContent): Promise<Uint8Array> {
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (content instanceof Blob) return new Uint8Array(await content.arrayBuffer());
  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  }
  return new Uint8Array(content);
}

function hexadecimal(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fnv1a64(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

export async function fileHash(content: HashableFileContent): Promise<string> {
  const bytes = await toBytes(content);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const isolated = Uint8Array.from(bytes);
    const digest = await subtle.digest("SHA-256", isolated);
    return `sha256-${hexadecimal(new Uint8Array(digest))}`;
  }
  return `fnv1a64-${fnv1a64(bytes)}`;
}

export const hashFileContent = fileHash;
