export interface FileReadResult {
  buffer: ArrayBuffer;
  cancel: () => void;
}

export function readFileAsArrayBuffer(
  file: File,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const onAbort = () => reader.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    reader.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.onabort = () => reject(new DOMException("解析已取消", "AbortError"));
    reader.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error("浏览器未返回有效的文件数据"));
        return;
      }
      onProgress(1);
      resolve(reader.result);
    };
    reader.readAsArrayBuffer(file);
  });
}
