export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch("/api" + path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join(", ")
      : (data.message ?? res.statusText);
    throw new ApiError(res.status, message);
  }
  return data as T;
}
