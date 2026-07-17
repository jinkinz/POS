export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = "backoffice.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch("/api" + path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    setToken(null);
    location.reload();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray((data as { message?: unknown }).message)
      ? (data as { message: string[] }).message.join(", ")
      : ((data as { message?: string }).message ?? res.statusText);
    throw new ApiError(res.status, message);
  }
  return data as T;
}
