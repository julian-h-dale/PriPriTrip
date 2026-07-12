import client from './client';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// A turn can legitimately take 30-60s (the model runs tools before it speaks),
// so we can't cap total duration. What we can do is give up when the stream
// goes *silent* — no event at all for this long means it is wedged, not slow
// (review.md 2C-3: the old axios call had no timeout and no way to cancel).
const IDLE_TIMEOUT_MS = 90_000;

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
export async function sendChatMessage(payload, { onStatus, onDelta, signal } = {}) {
  const token = localStorage.getItem('token');

  // Abort on caller request (component unmount) or on an idle stream.
  const controller = new AbortController();
  let idleTimer = null;
  let timedOut = false;
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, IDLE_TIMEOUT_MS);
  };
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller);
  const cleanup = () => {
    clearTimeout(idleTimer);
    signal?.removeEventListener('abort', abortFromCaller);
  };

  let resp;
  try {
    resetIdleTimer();
    resp = await fetch(`${API_BASE}/chat/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    cleanup();
    if (timedOut) throw chatError('The assistant took too long to respond. Please try again.');
    throw err; // includes the caller's own abort
  }

  if (resp.status === 401) {
    // Mirror the axios client's 401 handling (client.js).
    cleanup();
    localStorage.removeItem('token');
    window.location.href = '/login';
    throw chatError('Not authenticated.');
  }
  if (!resp.ok || !resp.body) {
    cleanup();
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

  try {
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      resetIdleTimer(); // the stream is alive
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
  } catch (err) {
    if (timedOut) throw chatError('The assistant took too long to respond. Please try again.');
    throw err;
  } finally {
    cleanup();
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

/**
 * Submit a filled-in chat form (review.md 3F-2).
 *
 * Not a chat turn: the backend applies the values through the executor with no
 * model call, so this returns the usual reply payload immediately.
 */
export async function submitChatForm(payload) {
  const { data } = await client.post('/chat/forms/submit', payload);
  return data;
}

/**
 * Apply the place the user picked from a location choice (review.md 3F-5).
 * Like a form submit, this costs no model call.
 */
export async function submitChatChoice(payload) {
  const { data } = await client.post('/chat/choices/submit', payload);
  return data;
}

function uiPayloadFromMessage(message) {
  if (!message?.structureContent) return null;
  try {
    return JSON.parse(message.structureContent)?.uiPayload ?? null;
  } catch {
    return null;
  }
}

/** The form the assistant attached to a bot message, if any. */
export function formFromMessage(message) {
  const payload = uiPayloadFromMessage(message);
  return payload?.kind === 'form' ? payload.form : null;
}

/** The location choice the assistant attached to a bot message, if any. */
export function choiceFromMessage(message) {
  const payload = uiPayloadFromMessage(message);
  return payload?.kind === 'choice' ? payload.choice : null;
}
