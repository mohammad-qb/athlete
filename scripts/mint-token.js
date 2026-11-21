/**
 * Mints a session token for local exploration, using the same HMAC scheme the API
 * verifies. Development convenience only -- production tokens are issued by the auth
 * library against stored credentials.
 *
 *   SESSION_SECRET=... node scripts/mint-token.js <academyId> [role] [userId]
 */
const { createHmac } = require('node:crypto');

const secret = process.env.SESSION_SECRET;
if (!secret) {
  console.error('SESSION_SECRET is required (must match the API).');
  process.exit(1);
}

const [academyId, role = 'academy_admin', userId = '33333333-3333-3333-3333-333333333333'] =
  process.argv.slice(2);

if (!academyId) {
  console.error('usage: node scripts/mint-token.js <academyId> [role] [userId]');
  process.exit(1);
}

const payload = {
  sub: userId,
  aid: academyId,
  roles: [role],
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
process.stdout.write(body + '.' + createHmac('sha256', secret).update(body).digest('base64url'));
