const { put, list } = require('@vercel/blob');

const BLOB_PATH = 'parkease-state.json';
const DEFAULT_STATE = { vehicles: [], otpSessions: {}, invoiceCounter: 1 };

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { blobs } = await list({ prefix: BLOB_PATH });
      if (blobs.length > 0) {
        const response = await fetch(blobs[0].url);
        const state = await response.json();
        return res.status(200).json(state);
      }
      return res.status(200).json(DEFAULT_STATE);
    }

    if (req.method === 'POST') {
      const state = req.body;
      if (!state || typeof state !== 'object') {
        return res.status(400).json({ error: 'Invalid state data' });
      }
      await put(BLOB_PATH, JSON.stringify(state), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json',
      });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
