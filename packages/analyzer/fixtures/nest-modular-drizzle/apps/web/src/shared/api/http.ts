export async function request(path: string, init: RequestInit = {}) {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
