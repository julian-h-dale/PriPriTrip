import client from './client';

export async function getProfile() {
  const { data } = await client.get('/profile');
  return data;
}

export async function updateProfile(payload) {
  const { data } = await client.put('/profile', payload);
  return data;
}

export async function lookupTimezone(lat, lng) {
  const { data } = await client.post('/profile/timezone', { lat, lng });
  return data?.timezoneId ?? null;
}
