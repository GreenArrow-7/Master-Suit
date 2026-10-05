/** Sends a JSON write; null on success, else the server's own sentence for the refusal. */
export async function call(
  url: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
): Promise<string | null> {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) return null;
  try {
    const problem = await res.json();
    return problem.detail ?? problem.errors?.[0]?.message ?? problem.title ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}
