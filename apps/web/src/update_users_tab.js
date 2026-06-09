const fs = require('fs');
const path = require('path');

const file = 'c:\\Users\\Harish\\Documents\\Eyelevel\\Saas\\apps\\web\\src\\components\\settings\\UsersTab.tsx';
let content = fs.readFileSync(file, 'utf-8');

// The replacement logic:
const newModals = `      <AnimatePresence>
        {showInvite && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm" onClick={() => setShowInvite(false)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-[101] w-full max-w-md bg-white border-l border-[#E5E7EB] shadow-2xl shadow-black/10 overflow-y-auto flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB] bg-[#FAFAFA] sticky top-0 z-10 shrink-0">
                <h3 className="text-base font-semibold text-[#111827]">Invite Member</h3>
                <button type="button" onClick={() => setShowInvite(false)} className="text-[#6B7280] hover:text-[#111827] p-1 rounded-md hover:bg-[#E5E7EB] transition-colors"><X className="h-5 w-5" /></button>
              </div>
              <form onSubmit={handleInvite} className="p-6 space-y-4 flex-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Full Name</label>
                  <input required value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} className="w-full bg-white border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm font-medium text-[#111827] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] outline-none transition-all" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Email Address</label>
                  <input required type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} className="w-full bg-white border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm font-medium text-[#111827] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] outline-none transition-all" />
                </div>
                <div className="space-y-1.5 z-20 relative">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Role</label>
                  <Select value={inviteForm.role} onChange={(val) => setInviteForm({ ...inviteForm, role: val })} options={roleOptions} />
                </div>
                <div className="space-y-1.5 z-10 relative">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Department (Optional)</label>
                  <Select 
                    value={inviteForm.department || ''} 
                    onChange={(val) => setInviteForm({ ...inviteForm, department: val })} 
                    options={[{ label: 'None', value: '' }, ...(teams?.map(t => ({ label: t.name, value: t.name })) || [])]} 
                  />
                </div>
                <div className="pt-8 flex gap-3">
                  <button type="button" onClick={() => setShowInvite(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-[#E5E7EB] text-[#374151] font-medium hover:bg-[#FAFAFA] transition-colors">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-[#111827] text-white px-4 py-2.5 rounded-xl font-medium hover:bg-black transition-colors disabled:opacity-50">
                    {saving ? 'Sending...' : 'Send Invite'}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingUser && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm" onClick={() => setEditingUser(null)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-[101] w-full max-w-md bg-white border-l border-[#E5E7EB] shadow-2xl shadow-black/10 overflow-y-auto flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB] bg-[#FAFAFA] sticky top-0 z-10 shrink-0">
                <h3 className="text-base font-semibold text-[#111827]">Edit User</h3>
                <button type="button" onClick={() => setEditingUser(null)} className="text-[#6B7280] hover:text-[#111827] p-1 rounded-md hover:bg-[#E5E7EB] transition-colors"><X className="h-5 w-5" /></button>
              </div>
              <form onSubmit={handleUpdateUser} className="p-6 space-y-4 flex-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Full Name</label>
                  <input required value={editingUser.name} onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} className="w-full bg-white border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm font-medium text-[#111827] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] outline-none transition-all" />
                </div>
                <div className="space-y-1.5 z-30 relative">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Role</label>
                  <Select value={editingUser.role} onChange={(val) => setEditingUser({ ...editingUser, role: val })} options={roleOptions} disabled={editingUser.role === 'SUPER_ADMIN'} />
                </div>
                <div className="space-y-1.5 z-20 relative">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Department (Optional)</label>
                  <Select 
                    value={editingUser.department || ''} 
                    onChange={(val) => setEditingUser({ ...editingUser, department: val })} 
                    options={[{ label: 'None', value: '' }, ...(teams?.map(t => ({ label: t.name, value: t.name })) || [])]} 
                  />
                </div>
                <div className="space-y-1.5 z-10 relative">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Status</label>
                  <Select value={editingUser.status} onChange={(val) => setEditingUser({ ...editingUser, status: val })} options={[{label: 'Active', value: 'ACTIVE'}, {label: 'Pending', value: 'PENDING'}, {label: 'Inactive', value: 'INACTIVE'}]} />
                </div>
                <div className="pt-8 flex gap-3">
                  <button type="button" onClick={() => setEditingUser(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-[#E5E7EB] text-[#374151] font-medium hover:bg-[#FAFAFA] transition-colors">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-[#111827] text-white px-4 py-2.5 rounded-xl font-medium hover:bg-black transition-colors disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
`;

// Just slice off everything starting from the first AnimatePresence and append the new modals.
const animatePresenceIndex = content.indexOf('<AnimatePresence>');
if (animatePresenceIndex !== -1) {
  content = content.substring(0, animatePresenceIndex) + newModals;
  fs.writeFileSync(file, content, 'utf-8');
  console.log('Successfully updated UsersTab modals.');
} else {
  console.error('Could not find <AnimatePresence> in UsersTab.tsx');
}
