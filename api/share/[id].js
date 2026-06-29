import { kv } from '@vercel/kv';
import { applyApiHeaders } from '../../server/services/apiResponses.js';

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

    const data = await kv.get(`share:${id}`);

    if (!data) {
      return res.status(404).json({ error: 'Share not found' });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Share fetch error:', error);
    return res.status(500).json({ error: 'Failed to retrieve shared analysis' });
  }
}
