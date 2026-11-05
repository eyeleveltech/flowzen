import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  /*
   * Images only from the app itself, or inline (security fixes plan, H7).
   *
   * Text people type reaches the screen in many places — Zen's answers above
   * all — and an image is the one thing a browser fetches without a click,
   * carrying whatever was put in its address. Every image this app shows is
   * its own file (/public) or a data: URI (signatures, the PDF logo), so this
   * costs nothing and closes the door everywhere at once.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "img-src 'self' data: blob:" }],
      },
    ];
  },
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
    return [
      {
        source: '/api/:path*',
        destination: `${api}/:path*`,
      },
      /*
       * OAuth discovery for "Sign in with Flowzen" (API Plan 2). Claude.ai and
       * ChatGPT read these at the site's root, which is this app's; the API
       * answers them under /api/.well-known, so they are passed through here
       * and no proxy in front needs a new rule.
       */
      { source: '/.well-known/oauth-authorization-server', destination: `${api}/.well-known/oauth-authorization-server` },
      { source: '/.well-known/oauth-protected-resource', destination: `${api}/.well-known/oauth-protected-resource` },
      { source: '/.well-known/oauth-protected-resource/:path*', destination: `${api}/.well-known/oauth-protected-resource/:path*` },
    ];
  },
};

export default nextConfig;
