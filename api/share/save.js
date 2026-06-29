import crypto from 'crypto';
import { kv } from '@vercel/kv';
import { applyApiHeaders } from '../../server/services/apiResponses.js';

const SHARE_TTL = 2592000; // 30 days in seconds

export default async function handler(req, res) {
  applyApiHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { repoUrl, analysisResult, summary, strengths, weaknesses } = req.body || {};

    const requiredFields = { repoUrl, analysisResult, summary, strengths, weaknesses };
    for (const [key, value] of Object.entries(requiredFields)) {
      if (!value || typeof value !== 'string' || value.trim() === '') {
        return res.status(400).json({ error: `Missing or invalid field: ${key}` });
      }
    }

    const id = crypto.randomUUID();

    await kv.set(`share:${id}`, { repoUrl, analysisResult, summary, strengths, weaknesses }, { ex: SHARE_TTL });

    return res.status(200).json({ id, url: `/share/${id}` });
  } catch (error) {
    console.error('Share save error:', error);
    return res.status(500).json({ error: 'Failed to save shared analysis' });
  }
}
