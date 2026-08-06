import { useState } from 'react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { Building2, Globe, Briefcase, Users, Phone, MapPin, Info, Coins } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { CurrencySelect } from '@/components/ui/currency-select';
import { useAuthStore } from '@/stores';
import { Icon } from '@/components/ui/icon';

export function OrganizationTab({ initialData, onSaved }: { initialData: any, onSaved?: () => void }) {
  const { user, setAuth } = useAuthStore();
  const [data, setData] = useState({
    name: initialData?.name || '',
    website: initialData?.website || '',
    industry: initialData?.industry || '',
    companySize: initialData?.companySize || '',
    phone: initialData?.phone || '',
    address: initialData?.address || '',
    description: initialData?.description || '',
    currency: initialData?.currency || 'INR',
  });
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  const handleSave = async () => {
    setNameError('');
    if (!data.name.trim() || data.name.trim().length < 2) {
      setNameError('Organization name must be at least 2 characters.');
      return;
    }

    setSaving(true);
    try {
      await api.put('/settings/organization', data);
      toast.success('Organization settings saved');
      // Refresh parent cached org data and update store
      onSaved?.();
      if (user?.organization) {
        setAuth({ ...user, organization: { ...user.organization, name: data.name } });
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const sizeOptions = [
    { label: '1–10 employees', value: '1-10' },
    { label: '11–50 employees', value: '11-50' },
    { label: '51–200 employees', value: '51-200' },
    { label: '200+ employees', value: '200+' },
  ];

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-primary">Organization Profile</h2>
        <p className="text-sm text-secondary">Manage your company details and branding.</p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="org-name" className="text-sm font-medium text-body flex items-center gap-2">
              <Icon as={Building2} size="sm" className="text-secondary" /> Organization Name <span className="text-red-500">*</span>
            </label>
            <input
              id="org-name"
              type="text"
              required
              minLength={2}
              value={data.name}
              onChange={(e) => { setData({ ...data, name: e.target.value }); setNameError(''); }}
              className={`w-full bg-white border ${nameError ? 'border-red-500' : 'border-border'} rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 outline-none transition-colors duration-150 motion-reduce:transition-none`}
            />
            {nameError && <p className="text-xs text-red-600 font-medium">{nameError}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="org-website" className="text-sm font-medium text-body flex items-center gap-2">
              <Icon as={Globe} size="sm" className="text-secondary" /> Website
            </label>
            <input
              id="org-website"
              type="url"
              value={data.website}
              onChange={(e) => setData({ ...data, website: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 outline-none transition-colors duration-150 motion-reduce:transition-none"
              placeholder="https://"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="org-industry" className="text-sm font-medium text-body flex items-center gap-2">
              <Icon as={Briefcase} size="sm" className="text-secondary" /> Industry
            </label>
            <input
              id="org-industry"
              type="text"
              value={data.industry}
              onChange={(e) => setData({ ...data, industry: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 outline-none transition-colors duration-150 motion-reduce:transition-none"
              placeholder="e.g. Marketing, Software"
            />
          </div>
          <div className="space-y-1.5 z-20">
            <label htmlFor="org-size" className="text-sm font-medium text-body flex items-center gap-2">
              <Icon as={Users} size="sm" className="text-secondary" /> Company Size
            </label>
            <Select
              id="org-size"
              ariaLabel="Company Size"
              value={data.companySize}
              onChange={(val) => setData({ ...data, companySize: val })}
              options={sizeOptions}
              placeholder="Select size..."
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="org-phone" className="text-sm font-medium text-body flex items-center gap-2">
              <Icon as={Phone} size="sm" className="text-secondary" /> Phone Number
            </label>
            <input
              id="org-phone"
              type="tel"
              value={data.phone}
              onChange={(e) => setData({ ...data, phone: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 outline-none transition-colors duration-150 motion-reduce:transition-none"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="org-currency" className="text-sm font-medium text-body flex items-center gap-2">
              <Icon as={Coins} size="sm" className="text-secondary" /> Default Currency
            </label>
            <CurrencySelect
              value={data.currency}
              onChange={(val) => setData({ ...data, currency: val })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="org-address" className="text-sm font-medium text-body flex items-center gap-2">
            <Icon as={MapPin} size="sm" className="text-secondary" /> Headquarter Address
          </label>
          <textarea
            id="org-address"
            value={data.address}
            onChange={(e) => setData({ ...data, address: e.target.value })}
            rows={2}
            className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 outline-none transition-colors duration-150 motion-reduce:transition-none resize-none"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="org-description" className="text-sm font-medium text-body flex items-center gap-2">
            <Icon as={Building2} size="sm" className="text-secondary" /> Description
          </label>
          <textarea
            id="org-description"
            value={data.description}
            onChange={(e) => setData({ ...data, description: e.target.value })}
            rows={3}
            className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 outline-none transition-colors duration-150 motion-reduce:transition-none resize-none"
          />
        </div>
      </div>

      <div className="pt-4 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-secondary">
          <Icon as={Info} size="sm" className="shrink-0 text-secondary" />
          <span>Saving updates your organization details and syncs company name on your Internal Client entity.</span>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="bg-primary text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-black transition-colors disabled:opacity-50 shrink-0"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
