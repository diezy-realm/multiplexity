import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import bcrypt from 'bcrypt';
import { currentUserId } from '@/lib/user';
import { getDb } from '@/lib/db';
import { newChallenge, createGrant } from '@/lib/account';
import { isLocalDevelopment, hasLocalWebAccess } from '@/lib/runtime';

export async function POST(request: Request) {
  const origin = process.env.NEXTAUTH_URL;
  if ((process.env.DESKTOP_MODE !== '1' && !(isLocalDevelopment() && hasLocalWebAccess(request))) || !origin || new URL(origin).hostname !== 'localhost' || request.headers.get('origin') !== origin) return Response.json({ error: 'Windows Hello memerlukan desktop atau development lokal pada localhost.' }, { status: 403 });
  try {
    const body = await request.json();
    if (!body || typeof body.action !== 'string') throw new Error('Permintaan tidak valid.');
    const user = await currentUserId();
    if (body.action === 'register-options') {
      if (!user || typeof body.password !== 'string') throw new Error('Masukkan password akun saat ini.');
      const account = getDb().prepare('SELECT username,password_hash FROM users WHERE id = ?').get(user) as { username: string; password_hash: string };
      if (!await bcrypt.compare(body.password, account.password_hash)) throw new Error('Password akun salah.');
      const existing = getDb().prepare('SELECT id FROM passkeys WHERE user_id = ?').all(user) as { id: string }[];
      const options = await generateRegistrationOptions({ rpName: 'Multiplexity', rpID: 'localhost', userName: account.username, userID: new Uint8Array(Buffer.from(user)), attestationType: 'none', supportedAlgorithmIDs: [-7, -257], authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' }, excludeCredentials: existing.map(item => ({ id: item.id })) });
      return Response.json({ options, challengeId: newChallenge(user, 'register', options.challenge, origin) });
    }
    if (body.action === 'auth-options') {
      if (typeof body.username !== 'string' || body.username.length > 64) throw new Error('Username tidak valid.');
      const account = getDb().prepare('SELECT id FROM users WHERE username = ?').get(body.username) as { id: string } | undefined;
      const credentials = account ? getDb().prepare('SELECT id FROM passkeys WHERE user_id = ?').all(account.id) as { id: string }[] : [];
      if (!account || !credentials.length) throw new Error('Windows Hello belum diaktifkan untuk akun ini.');
      const options = await generateAuthenticationOptions({ rpID: 'localhost', userVerification: 'required', allowCredentials: credentials.map(item => ({ id: item.id, transports: ['internal'] })) });
      return Response.json({ options, challengeId: newChallenge(account.id, 'authenticate', options.challenge, origin) });
    }
    if (typeof body.challengeId !== 'string' || !body.response) throw new Error('Challenge tidak valid.');
    const challenge = getDb().prepare('SELECT * FROM auth_challenges WHERE id = ? AND expires > ?').get(body.challengeId, Date.now()) as { id: string; user_id: string; purpose: string; value: string; origin: string } | undefined;
    if (!challenge || challenge.origin !== origin) throw new Error('Challenge kedaluwarsa.');
    getDb().prepare('DELETE FROM auth_challenges WHERE id = ?').run(challenge.id);
    if (body.action === 'register-verify' && challenge.purpose === 'register' && challenge.user_id === user) {
      const result = await verifyRegistrationResponse({ response: body.response, expectedChallenge: challenge.value, expectedOrigin: origin, expectedRPID: 'localhost', requireUserVerification: true });
      if (!result.verified) throw new Error('Verifikasi Windows Hello gagal.');
      const credential = result.registrationInfo.credential;
      getDb().prepare('INSERT INTO passkeys (id,user_id,public_key,counter,transports) VALUES (?,?,?,?,?)').run(credential.id, user, Buffer.from(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? ['internal']));
      return Response.json({ success: true });
    }
    if (body.action === 'auth-verify' && challenge.purpose === 'authenticate') {
      const credential = getDb().prepare('SELECT * FROM passkeys WHERE id = ? AND user_id = ?').get(body.response.id, challenge.user_id) as { id: string; public_key: Buffer; counter: number; transports: string } | undefined;
      if (!credential) throw new Error('Credential tidak dikenal.');
      const result = await verifyAuthenticationResponse({ response: body.response, expectedChallenge: challenge.value, expectedOrigin: origin, expectedRPID: 'localhost', requireUserVerification: true, credential: { id: credential.id, publicKey: new Uint8Array(credential.public_key), counter: credential.counter } });
      if (!result.verified) throw new Error('Verifikasi Windows Hello gagal.');
      getDb().prepare('UPDATE passkeys SET counter = MAX(counter, ?) WHERE id = ?').run(result.authenticationInfo.newCounter, credential.id);
      return Response.json({ grant: createGrant(challenge.user_id) });
    }
    throw new Error('Permintaan tidak valid.');
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Windows Hello gagal.' }, { status: 400 }); }
}
