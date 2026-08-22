/**
 * Google OAuth verification.
 */

import { OAuth2Client } from 'google-auth-library';
// The client ID from Google Cloud Console
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'dummy-client-id';
const client = new OAuth2Client(CLIENT_ID);

export type GooglePayload = {
  email: string;
  name: string;
  picture?: string;
  sub: string; // The Google ID
  hd?: string; // Hosted domain (Google Workspace)
};

/**
 * Verify a Google ID token and return its payload.
 * Throws if invalid or if the email is not verified.
 */
export const verifyGoogleIdToken = async (idToken: string): Promise<GooglePayload> => {
  // If no client ID is configured, we bypass verification for local testing
  // only if the token matches a specific format. In production, this always verifies.
  if (CLIENT_ID === 'dummy-client-id' && process.env.NODE_ENV !== 'production') {
    // For local e2e testing without a real Google token
    if (idToken.startsWith('test-token:')) {
      const email = idToken.split(':')[1];
      return {
        email,
        name: email.split('@')[0],
        sub: `google-id-${email}`,
      };
    }
  }

  const ticket = await client.verifyIdToken({
    idToken,
    audience: CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error('Invalid Google token: missing email.');
  }

  if (!payload.email_verified) {
    throw new Error('Google email is not verified.');
  }

  return {
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    picture: payload.picture,
    sub: payload.sub,
    hd: payload.hd,
  };
};
