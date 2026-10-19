import type { TokenizationResult } from "./tokenizer";

interface WorkerResponse {
  id: number;
  results?: TokenizationResult[];
  error?: string;
}

interface PendingRequest {
  resolve: (results: TokenizationResult[]) => void;
  reject: (error: Error) => void;
}

let worker: Worker | undefined;
let nextRequestId = 0;
const pendingRequests = new Map<number, PendingRequest>();

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("./open-tokenizer.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const pending = pendingRequests.get(event.data.id);
    if (!pending) return;
    pendingRequests.delete(event.data.id);

    if (event.data.results) pending.resolve(event.data.results);
    else pending.reject(new Error(event.data.error ?? "Could not tokenize text."));
  };
  worker.onerror = () => {
    for (const pending of pendingRequests.values()) {
      pending.reject(new Error("The tokenizer worker stopped unexpectedly."));
    }
    pendingRequests.clear();
    worker = undefined;
  };

  return worker;
}

export function tokenizeOpenModelsInWorker(
  text: string,
  profileIds: readonly string[],
): Promise<TokenizationResult[]> {
  const id = ++nextRequestId;

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    getWorker().postMessage({ id, text, profileIds: [...profileIds] });
  });
}

