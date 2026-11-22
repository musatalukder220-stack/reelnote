// Talking to the local ReelNote server. Every call carries this session's token.
type Boot = { token: string; role: "owner" | "reviewer"; version: string; project: string; lang: "en" | "bn"; buildError: string | null };
export const boot = (window as unknown as { __RN: Boot }).__RN;

export const api = async <T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
  const r = await fetch(`/__rn/api/${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", "x-reelnote-token": boot.token },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
  return data as T;
};

export const fileUrl = (rel: string, bust?: string | number) => `/__rn/files/${rel}${bust !== undefined ? `?v=${bust}` : ""}`;

export const events = () => (window as unknown as { __rnEvents: EventSource }).__rnEvents;

export const on = <T,>(name: string, fn: (data: T) => void) => {
  const handler = (e: MessageEvent) => fn(JSON.parse(e.data) as T);
  events().addEventListener(name, handler as EventListener);
  return () => events().removeEventListener(name, handler as EventListener);
};

export const isReviewer = boot.role === "reviewer";

// a reviewer's name, remembered in this browser when it allows
export const savedName = () => {
  try {
    return localStorage.getItem("reelnote-name") ?? "";
  } catch {
    return "";
  }
};
export const saveName = (n: string) => {
  try {
    localStorage.setItem("reelnote-name", n);
  } catch {
    /* storage blocked: the name lasts this visit */
  }
};
