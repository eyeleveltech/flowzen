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
    return [
      {
        source: '/api/:path*',
        destination: process.env.NEXT_PUBLIC_API_URL 
          ? `${process.env.NEXT_PUBLIC_API_URL}/:path*`
          : 'http://localhost:4000/api/:path*',
      },
    ];
  },
};

export default nextConfig;
