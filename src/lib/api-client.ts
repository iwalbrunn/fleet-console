export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
  }
  if (data === null) throw new Error('Invalid server response')
  return data as T
}
