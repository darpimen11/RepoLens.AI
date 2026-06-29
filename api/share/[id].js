import { Redis } from '@upstash/redis';
import { applyApiHeaders } from '../../server/services/apiResponses.js';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  applyApiHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;

    const raw = await redis.get(`share:${id}`);

    if (!raw) {
      return res.status(404).json({ error: 'Share not found' });
    }

    // @upstash/redis auto-parses JSON strings; handle both cases
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

    return res.status(200).json(data);
  } catch (error) {
    console.error('Share fetch error:', error);
    return res.status(500).json({ error: 'Failed to retrieve shared analysis' });
  }
}
