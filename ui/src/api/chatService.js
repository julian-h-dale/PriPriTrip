import client from './client';

export async function sendChatMessage(payload) {
  const { data } = await client.post('/chat/reply', payload);
  return data;
}

export async function listChatMessages(tripId, workflowName) {
  const { data } = await client.get(`/chat/trips/${tripId}`, {
    params: { workflowName },
  });
  return data;
}
