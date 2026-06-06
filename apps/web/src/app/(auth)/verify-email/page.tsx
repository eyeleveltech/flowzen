'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const hasAttempted = useRef(false);

  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setStatus('error');
        setErrorMessage('Missing verification token. Please check your email link.');
        return;
      }

      if (hasAttempted.current) return;
      hasAttempted.current = true;

      try {
        await api.post('/auth/verify-email', { token });
        setStatus('success');
        
        // Refresh AuthContext or let the dashboard fetch updated user profile
        setTimeout(() => {
          router.push('/dashboard');
        }, 2000);

      } catch (err: any) {
        setStatus('error');
        setErrorMessage(err.message);
      }
    };

    verifyToken();
  }, [token, router]);

  return (
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-8 shadow-xl shadow-black/5 ring-1 ring-[#E5E7EB] text-center">
        
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-12 w-12 text-[#111827] animate-spin mb-4" />
            <h2 className="text-xl font-semibold text-[#111827]">Verifying your email</h2>
            <p className="mt-2 text-sm text-[#6B7280]">Please wait a moment...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="h-16 w-16 rounded-full bg-[#ECFDF5] flex items-center justify-center mb-6">
              <CheckCircle2 className="h-8 w-8 text-[#059669]" />
            </div>
            <h2 className="text-2xl font-bold text-[#111827]">Email Verified!</h2>
            <p className="mt-2 text-sm text-[#6B7280]">
              Thank you for verifying your email address.
              <br />Redirecting you to the dashboard...
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="h-16 w-16 rounded-full bg-[#FEF2F2] flex items-center justify-center mb-6">
              <XCircle className="h-8 w-8 text-[#DC2626]" />
            </div>
            <h2 className="text-2xl font-bold text-[#111827]">Verification Failed</h2>
            <p className="mt-2 text-sm text-[#6B7280] mb-8">{errorMessage}</p>
            
            <Link href="/dashboard" className="w-full">
              <button className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-medium text-[#111827] hover:bg-[#F9FAFB] transition-all duration-150 h-11 flex items-center justify-center">
                Go to Dashboard
              </button>
            </Link>
          </div>
        )}
      </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA] p-4">
      <Suspense fallback={
        <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-8 shadow-xl shadow-black/5 ring-1 ring-[#E5E7EB] text-center">
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-12 w-12 text-[#111827] animate-spin mb-4" />
            <h2 className="text-xl font-semibold text-[#111827]">Loading...</h2>
            <p className="mt-2 text-sm text-[#6B7280]">Please wait a moment...</p>
          </div>
        </div>
      }>
        <VerifyEmailContent />
      </Suspense>
    </div>
  );
}
