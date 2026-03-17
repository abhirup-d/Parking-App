const { sql } = require('@vercel/postgres');

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      data JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `;
  // Insert default row if it doesn't exist
  await sql`
    INSERT INTO app_state (id, data)
    VALUES (1, '{"vehicles":[],"otpSessions":{},"invoiceCounter":1}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `;
}

module.exports = async function handler(req, res) {
  try {
    await ensureTable();

    if (req.method === 'GET') {
      const { rows } = await sql`SELECT data FROM app_state WHERE id = 1`;
      const state = rows.length > 0 ? rows[0].data : { vehicles: [], otpSessions: {}, invoiceCounter: 1 };
      return res.status(200).json(state);
    }

    if (req.method === 'POST') {
      const state = req.body;
      if (!state || typeof state !== 'object') {
        return res.status(400).json({ error: 'Invalid state data' });
      }
      const data = JSON.stringify(state);
      await sql`
        UPDATE app_state SET data = ${data}::jsonb WHERE id = 1
      `;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
