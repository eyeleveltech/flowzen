'use client';

import { useState } from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/auth/request-reset', { email });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA] p-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-8 shadow-xl shadow-black/5 ring-1 ring-[#E5E7EB]">
        
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#F3F4F6] mb-4">
            <Mail className="h-6 w-6 text-[#111827]" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[#111827]">Reset password</h2>
          <p className="mt-2 text-sm text-[#6B7280]">
            Enter your email address and we'll send you a link to reset your password.
          </p>
        </div>

        {success ? (
          <div className="rounded-xl bg-[#ECFDF5] p-4 text-sm text-[#065F46] ring-1 ring-[#059669]/20">
            <p className="font-medium text-center">Check your email!</p>
            <p className="mt-1 text-center text-[#047857]">
              If an account exists for {email}, a password reset link has been sent.
            </p>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-xl bg-[#FEF2F2] p-4 text-sm text-[#991B1B] ring-1 ring-[#DC2626]/20">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[#374151]">
                Email address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full appearance-none rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-[#111827] placeholder-[#9CA3AF] focus:border-[#111827] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#111827] transition-all sm:text-sm"
                  placeholder="you@company.com"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all duration-150 h-11"
            >
              {loading ? 'Sending link...' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <Link href="/login" className="inline-flex items-center text-sm font-medium text-[#6B7280] hover:text-[#111827] transition-colors">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
