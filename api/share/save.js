import crypto from 'crypto';
import { Redis } from '@upstash/redis';
import { applyApiHeaders } from '../../server/services/apiResponses.js';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

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

    if (!repoUrl || typeof repoUrl !== 'string' || repoUrl.trim() === '') {
      return res.status(400).json({ error: 'Missing or invalid field: repoUrl' });
    }
    if (!analysisResult || typeof analysisResult !== 'string' || analysisResult.trim() === '') {
      return res.status(400).json({ error: 'Missing or invalid field: analysisResult' });
    }

    const id = crypto.randomUUID();

    await redis.set(`share:${id}`, JSON.stringify({
      repoUrl: repoUrl.trim(),
      analysisResult,
      summary: typeof summary === 'string' ? summary : '',
      strengths: typeof strengths === 'string' ? strengths : '',
      weaknesses: typeof weaknesses === 'string' ? weaknesses : '',
    }), { ex: SHARE_TTL });

    return res.status(200).json({ id, url: `/share/${id}` });
  } catch (error) {
    console.error('Share save error:', error);
    return res.status(500).json({ error: 'Failed to save shared analysis' });
  }
}
