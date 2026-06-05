'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing reset token. Please request a new password reset link.');
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await api.post('/auth/reset-password', {
        token,
        password,
      });

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
            <KeyRound className="h-6 w-6 text-[#111827]" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[#111827]">Set new password</h2>
          <p className="mt-2 text-sm text-[#6B7280]">
            Please enter your new password below.
          </p>
        </div>

        {success ? (
          <div className="text-center space-y-6 mt-8">
            <div className="rounded-xl bg-[#ECFDF5] p-4 text-sm text-[#065F46] ring-1 ring-[#059669]/20">
              <p className="font-medium">Password reset successfully!</p>
              <p className="mt-1">You can now sign in with your new password.</p>
            </div>
            <Link href="/login" className="w-full">
              <button className="w-full rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all duration-150 h-11 group flex items-center justify-center">
                Go to login
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
            </Link>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-xl bg-[#FEF2F2] p-4 text-sm text-[#991B1B] ring-1 ring-[#DC2626]/20">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-[#374151]">
                  New password
                </label>
                <div className="mt-1">
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    disabled={!token}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full appearance-none rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-[#111827] placeholder-[#9CA3AF] focus:border-[#111827] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#111827] transition-all sm:text-sm disabled:opacity-50"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-[#374151]">
                  Confirm new password
                </label>
                <div className="mt-1">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    required
                    disabled={!token}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="block w-full appearance-none rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-[#111827] placeholder-[#9CA3AF] focus:border-[#111827] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#111827] transition-all sm:text-sm disabled:opacity-50"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !token}
              className="w-full rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all duration-150 h-11"
            >
              {loading ? 'Resetting...' : 'Reset password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
