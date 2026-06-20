import { useState } from 'react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { Building2, Globe, Briefcase, Users, Phone, MapPin } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { useAuthStore } from '@/stores';

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
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/settings/organization', data);
      toast.success('Organization settings saved');
      // Refresh the parent's cached org data (so switching tabs doesn't revert),
      // and keep the auth store's org name in sync for anywhere it's shown.
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
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-primary">Organization Profile</h2>
        <p className="text-sm text-secondary">Manage your company details and branding.</p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5" /> Organization Name
            </label>
            <input
              type="text"
              value={data.name}
              onChange={(e) => setData({ ...data, name: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide flex items-center gap-2">
              <Globe className="h-3.5 w-3.5" /> Website
            </label>
            <input
              type="url"
              value={data.website}
              onChange={(e) => setData({ ...data, website: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              placeholder="https://"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide flex items-center gap-2">
              <Briefcase className="h-3.5 w-3.5" /> Industry
            </label>
            <input
              type="text"
              value={data.industry}
              onChange={(e) => setData({ ...data, industry: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              placeholder="e.g. Marketing, Software"
            />
          </div>
          <div className="space-y-1.5 z-20">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide flex items-center gap-2">
              <Users className="h-3.5 w-3.5" /> Company Size
            </label>
            <Select
              value={data.companySize}
              onChange={(val) => setData({ ...data, companySize: val })}
              options={sizeOptions}
              placeholder="Select size..."
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide flex items-center gap-2">
              <Phone className="h-3.5 w-3.5" /> Phone Number
            </label>
            <input
              type="tel"
              value={data.phone}
              onChange={(e) => setData({ ...data, phone: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-secondary uppercase tracking-wide flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5" /> Headquarter Address
          </label>
          <textarea
            value={data.address}
            onChange={(e) => setData({ ...data, address: e.target.value })}
            rows={2}
            className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all resize-none"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-secondary uppercase tracking-wide flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5" /> Description
          </label>
          <textarea
            value={data.description}
            onChange={(e) => setData({ ...data, description: e.target.value })}
            rows={3}
            className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all resize-none"
          />
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t border-border">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-black transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
