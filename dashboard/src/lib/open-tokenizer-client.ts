import { OPEN_MODEL_PROFILES } from "./open-model-profiles";
import type { TokenizationResult } from "./tokenizer";

type WorkerFamily = "huggingface" | "llama" | "sentencepiece";

interface WorkerResponse {
  id: number;
  results?: TokenizationResult[];
  error?: string;
}

interface PendingRequest {
  family: WorkerFamily;
  resolve: (results: TokenizationResult[]) => void;
  reject: (error: Error) => void;
}

const workers = new Map<WorkerFamily, Worker>();
const pendingRequests = new Map<number, PendingRequest>();
let nextRequestId = 0;

function familyForProfile(profileId: string): WorkerFamily | null {
  const profile = OPEN_MODEL_PROFILES.find((candidate) => candidate.id === profileId);
  if (!profile) return null;
  if (profile.decoder === "tiktoken") return "llama";
  if (profile.decoder === "native_sentencepiece") return "sentencepiece";
  return "huggingface";
}

function createWorker(family: WorkerFamily): Worker {
  if (family === "llama") {
    return new Worker(new URL("./open-tokenizer-llama.worker.ts", import.meta.url), {
      type: "module",
    });
  }
  if (family === "sentencepiece") {
    return new Worker(
      new URL("./open-tokenizer-sentencepiece.worker.ts", import.meta.url),
      { type: "module" },
    );
  }
  return new Worker(
    new URL("./open-tokenizer-huggingface.worker.ts", import.meta.url),
    { type: "module" },
  );
}

function getWorker(family: WorkerFamily): Worker {
  const existing = workers.get(family);
  if (existing) return existing;

  const worker = createWorker(family);
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const pending = pendingRequests.get(event.data.id);
    if (!pending) return;
    pendingRequests.delete(event.data.id);
    if (event.data.results) pending.resolve(event.data.results);
    else pending.reject(new Error(event.data.error ?? "Could not tokenize text."));
  };
  worker.onerror = () => {
    for (const [id, pending] of pendingRequests) {
      if (pending.family !== family) continue;
      pending.reject(new Error("The tokenizer worker stopped unexpectedly."));
      pendingRequests.delete(id);
    }
    workers.delete(family);
  };
  workers.set(family, worker);
  return worker;
}

function tokenizeFamily(
  family: WorkerFamily,
  text: string,
  profileIds: readonly string[],
): Promise<TokenizationResult[]> {
  const id = ++nextRequestId;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { family, resolve, reject });
    getWorker(family).postMessage({ id, text, profileIds: [...profileIds] });
  });
}

export async function tokenizeOpenModelsInWorker(
  text: string,
  profileIds: readonly string[],
): Promise<TokenizationResult[]> {
  const idsByFamily = new Map<WorkerFamily, string[]>();
  for (const profileId of profileIds) {
    const family = familyForProfile(profileId);
    if (!family) continue;
    const ids = idsByFamily.get(family) ?? [];
    ids.push(profileId);
    idsByFamily.set(family, ids);
  }
  if (idsByFamily.size === 0) return [];

  const groups = await Promise.all(
    Array.from(idsByFamily, ([family, ids]) => tokenizeFamily(family, text, ids)),
  );
  const byId = new Map(
    groups.flat().map((result) => [result.profile.id, result]),
  );
  return profileIds.flatMap((profileId) => {
    const result = byId.get(profileId);
    return result ? [result] : [];
  });
}
