'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores';
import { Zap, Eye, EyeOff } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api.post<{ user: any }>('/auth/register', {
        name, email, password, organizationName,
      });
      setAuth(data.user);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      <div className="flex flex-1 items-center justify-center px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <div className="flex items-center mb-10">
            <img src="/logo_flowzen.png" alt="Flowzen" className="h-10 w-auto object-contain" />
          </div>

          <h1 className="text-2xl font-bold text-[#111827] mb-1">Create your workspace</h1>
          <p className="text-sm text-[#6B7280] mb-8">Start managing projects like a pro</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-[#EF4444]"
              >
                {error}
              </motion.div>
            )}

            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Organization name</label>
              <input
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="Your company name"
                required
                className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Full name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                required
                className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  required
                  minLength={8}
                  className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 pr-10 text-sm text-[#111827] placeholder:text-[#9CA3AF] outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#6B7280]"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all duration-150"
            >
              {loading ? 'Creating workspace...' : 'Create workspace'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[#9CA3AF]">
            Already have an account?{' '}
            <a href="/login" className="text-[#111827] font-medium hover:underline">
              Sign in
            </a>
          </p>
        </motion.div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center bg-[#111827] relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-1/3 right-1/4 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
          <div className="absolute bottom-1/3 left-1/4 w-80 h-80 rounded-full bg-white/3 blur-3xl" />
        </div>
        <div className="relative text-center px-12">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}>
            <div className="flex items-center justify-center mx-auto mb-8">
              <img src="/logo_flowzen.png" alt="Flowzen" className="h-16 w-auto object-contain brightness-0 invert opacity-90" />
            </div>
            <h2 className="text-3xl font-bold text-white mb-3">Built for agencies</h2>
            <p className="text-base text-white/60 max-w-sm mx-auto leading-relaxed">
              Everything your team needs to deliver exceptional projects, on time and on budget.
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
