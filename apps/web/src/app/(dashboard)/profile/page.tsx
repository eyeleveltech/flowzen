'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores';
import { api } from '@/lib/api';
import { User, KeyRound, Save, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { Select } from '@/components/ui/select';
import { useTeams, useMembers } from '@/hooks/useQueries';
import { useQueryClient } from '@tanstack/react-query';

export default function ProfilePage() {
  const { user, setAuth } = useAuthStore();
  const queryClient = useQueryClient();
  const { data: teams = [] } = useTeams();
  const { data: members = [] } = useMembers();
  const designationOptions = Array.from(new Set((members as any[]).map((m) => m.designation).filter(Boolean))) as string[];

  const [profileForm, setProfileForm] = useState({
    name: '',
    designation: '',
  });
  
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setProfileForm({
        name: user.name || '',
        designation: user.designation || '',
      });
    }
  }, [user]);

  // The cached session can be stale (e.g. designation changed later via
  // Settings → Users), so pull the latest profile from the server on open and
  // sync it back into the auth store.
  useEffect(() => {
    api.get('/profile').then((fresh: any) => {
      setProfileForm({
        name: fresh.name || '',
        designation: fresh.designation || '',
      });
      setAuth(fresh);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const updatedUser = await api.put('/profile', profileForm);
      // Update local store with new data
      setAuth(updatedUser as any);
      // Refresh the shared member/team caches so the new designation
      // shows in assignee dropdowns and member lists everywhere.
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      toast.success('Profile updated successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmNewPassword) {
      toast.error('New passwords do not match');
      return;
    }
    
    if (passwordForm.newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }

    setSavingPassword(true);
    try {
      await api.put('/profile/password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      toast.success('Password updated successfully');
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: '',
      });
    } catch (error: any) {
      toast.error(error.message || 'Failed to update password');
    } finally {
      setSavingPassword(false);
    }
  };

  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 sm:space-y-8 p-3 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-primary">My Profile</h1>
        <p className="mt-1 sm:mt-2 text-xs sm:text-sm text-secondary">
          Manage your personal information and security settings.
        </p>
      </div>

      <div className="space-y-6">
        {/* Personal Information Section */}
        <section className="rounded-2xl border border-border bg-white shadow-sm">
          <div className="border-b border-border px-4 sm:px-6 py-4 sm:py-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F3F4F6] shrink-0">
              <User className="h-5 w-5 text-secondary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-primary">Personal Information</h2>
              <p className="text-xs sm:text-sm text-secondary">Update your name and department details.</p>
            </div>
          </div>
          <div className="p-4 sm:p-6">
            <form onSubmit={handleProfileSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="profile-name" className="text-sm font-medium text-[#374151]">Full Name</label>
                  <input
                    id="profile-name"
                    type="text"
                    required
                    value={profileForm.name}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                    className="w-full rounded-xl border border-border px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="profile-email" className="text-sm font-medium text-[#374151]">Email Address</label>
                  <input
                    id="profile-email"
                    type="email"
                    disabled
                    value={user.email}
                    className="w-full rounded-xl border border-border bg-[#F9FAFB] px-4 py-2.5 text-sm text-muted cursor-not-allowed"
                    title="Email cannot be changed"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="profile-designation" className="text-sm font-medium text-[#374151]">Designation (Job Title)</label>
                  <input
                    id="profile-designation"
                    type="text"
                    list="designation-options"
                    placeholder="Select or type a designation…"
                    value={profileForm.designation}
                    onChange={(e) => setProfileForm({ ...profileForm, designation: e.target.value })}
                    className="w-full rounded-xl border border-border px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  />
                  <datalist id="designation-options">
                    {designationOptions.map((d) => <option key={d} value={d} />)}
                  </datalist>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-sm font-medium text-[#374151]">Department</label>
                  <p className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary">
                    {user.team?.name || '—'}
                  </p>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all"
                >
                  <Save className="h-4 w-4" />
                  {savingProfile ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* Security Section */}
        <section className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="border-b border-border px-4 sm:px-6 py-4 sm:py-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F3F4F6] shrink-0">
              <KeyRound className="h-5 w-5 text-secondary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-primary">Security & Password</h2>
              <p className="text-xs sm:text-sm text-secondary">Update your password to keep your account secure.</p>
            </div>
          </div>
          <div className="p-4 sm:p-6">
            <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-md">
              <div className="space-y-1.5 relative">
                <label htmlFor="profile-current-password" className="text-sm font-medium text-[#374151]">Current Password</label>
                <div className="relative">
                  <input
                    id="profile-current-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                    className="w-full rounded-xl border border-border px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-secondary"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 relative">
                <label htmlFor="profile-new-password" className="text-sm font-medium text-[#374151]">New Password</label>
                <div className="relative">
                  <input
                    id="profile-new-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                    className="w-full rounded-xl border border-border px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  />
                </div>
              </div>
              <div className="space-y-1.5 relative">
                <label htmlFor="profile-confirm-password" className="text-sm font-medium text-[#374151]">Confirm New Password</label>
                <div className="relative">
                  <input
                    id="profile-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={passwordForm.confirmNewPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmNewPassword: e.target.value })}
                    className="w-full rounded-xl border border-border px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  />
                </div>
              </div>
              <div className="flex pt-2">
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all"
                >
                  <Save className="h-4 w-4" />
                  {savingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
