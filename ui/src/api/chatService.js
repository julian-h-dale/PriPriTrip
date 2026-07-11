import client from './client';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

function parseSseFrame(frame) {
  let event = 'message';
  const dataLines = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

function chatError(detail) {
  const err = new Error(detail);
  err.detail = detail;
  return err;
}

/**
 * POST /chat/reply and consume the SSE response.
 *
 * `onStatus({tool, label})` fires for each interim tool-call status;
 * `onDelta(text)` fires for each streamed chunk of the assistant message.
 * Resolves with the `done` payload (same shape the old JSON endpoint returned).
 */
export async function sendChatMessage(payload, { onStatus, onDelta } = {}) {
  const token = localStorage.getItem('token');
  const resp = await fetch(`${API_BASE}/chat/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (resp.status === 401) {
    // Mirror the axios client's 401 handling (client.js).
    localStorage.removeItem('token');
    window.location.href = '/login';
    throw chatError('Not authenticated.');
  }
  if (!resp.ok || !resp.body) {
    let detail = 'Could not send message.';
    try {
      detail = (await resp.json())?.detail ?? detail;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw chatError(detail);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = null;

  for (;;) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const parsed = parseSseFrame(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
      if (!parsed) continue;
      if (parsed.event === 'status') onStatus?.(parsed.data);
      else if (parsed.event === 'delta') onDelta?.(parsed.data.text);
      else if (parsed.event === 'done') done = parsed.data;
      else if (parsed.event === 'error') throw chatError(parsed.data?.detail ?? 'Chat request failed.');
    }
  }

  if (!done) throw chatError('Chat stream ended unexpectedly.');
  return done;
}

export async function listChatMessages(tripId, workflowName) {
  const { data } = await client.get(`/chat/trips/${tripId}`, {
    params: { workflowName },
  });
  return data;
}
