'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Zap, Eye, EyeOff } from 'lucide-react';
import { Icon } from '@/components/ui/icon';

export default function LoginPage() {
  usePageTitle('Login');
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api.post<{ user: any }>('/auth/login', { email, password });
      setAuth(data.user);
      router.push('/modules');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left - Form */}
      <div className="flex flex-1 items-center justify-center px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <div className="flex items-center mb-10">
            <img src="/logo_flowzen.png" alt="Flowzen" className="h-12 w-auto object-contain" />
          </div>

          <h1 className="text-2xl font-bold text-primary mb-1">Welcome back</h1>
          <p className="text-sm text-secondary mb-8">Sign in to your workspace</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-danger"
              >
                {error}
              </motion.div>
            )}

            <div>
              <label className="block text-sm font-medium text-body mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-primary placeholder:text-secondary outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 transition-colors duration-150 motion-reduce:transition-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-body">Password</label>
                <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full rounded-xl border border-border bg-white px-4 py-2.5 pr-10 text-sm text-primary placeholder:text-secondary outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 transition-colors duration-150 motion-reduce:transition-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary hover:text-primary"
                >
                  {showPassword ? <Icon as={EyeOff} size="md" /> : <Icon as={Eye} size="md" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 transition-colors duration-150 motion-reduce:transition-none"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Signing in...
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-secondary">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-primary font-medium hover:underline">
              Create workspace
            </Link>
          </p>
        </motion.div>
      </div>

      {/* Right - Branding */}
      <div className="hidden lg:flex flex-1 items-center justify-center bg-primary relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 h-80 w-80 rounded-full bg-white/3 blur-3xl" />
        </div>
        <div className="relative text-center px-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className="flex items-center justify-center mx-auto mb-8">
              <img src="/logo_flowzen.png" alt="Flowzen" className="h-20 w-auto object-contain brightness-0 invert opacity-90" />
            </div>
            <h2 className="text-3xl font-bold text-white mb-3">Manage with precision</h2>
            <p className="text-base text-white/60 max-w-sm mx-auto leading-relaxed">
              The premium project management platform built for agencies that demand excellence.
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
