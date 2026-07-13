import re

with open(r'c:\Users\naifb\Desktop\eyelevel intern\project\flowzen\apps\api\src\routes\crm.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# First replace: POST /api/crm/leads/:id/stage
post_stage_start = content.find("const updatedLead = await prisma.lead.update({\n      where: { id: leadId },\n      data: updateData,")
if post_stage_start == -1:
    print("Could not find POST stage start")
    exit(1)

post_stage_end_str = "    if (clientId) emitToOrganization(io, orgId, 'client:updated', { id: clientId });"
post_stage_end = content.find(post_stage_end_str, post_stage_start)
if post_stage_end == -1:
    print("Could not find POST stage end")
    exit(1)

post_stage_end += len(post_stage_end_str)

new_post_stage = """
    const { updatedLead, finalClientId, newClientId, deletedClientId } = await prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id: leadId },
        data: updateData,
        include: {
          client: true,
          assignedTo: { select: { id: true, name: true, avatar: true } }
        }
      });

      // Create Stage History
      await tx.stageHistory.create({
        data: {
          leadId,
          fromStage: previousStage,
          toStage: stage,
          notes: notes || null,
          changedById: req.user!.userId,
        }
      });

      // Upsert any dynamic fields passed
      if (fields && typeof fields === 'object') {
        for (const [key, value] of Object.entries(fields)) {
          const strValue = Array.isArray(value) ? value.join(', ') : (value ? String(value) : null);
          await tx.dealField.upsert({
            where: { leadId_fieldKey: { leadId, fieldKey: key } },
            update: { fieldValue: strValue },
            create: { leadId, fieldKey: key, fieldValue: strValue }
          });
        }
      }

      let currentClientId = existingLead.clientId;
      let outNewClientId = null;
      let outDeletedClientId = null;

      if (PURSUED_STAGES.includes(stage) && !currentClientId) {
        const newClient = await tx.client.create({
          data: {
            name: existingLead.companyName || existingLead.contactName || 'Unknown',
            company: existingLead.companyName || null,
            email: existingLead.contactEmail || null,
            phone: existingLead.contactPhone || null,
            status: 'PROSPECT',
            organizationId: orgId,
            ...(existingLead.contactName ? {
              contacts: { create: { name: existingLead.contactName, designation: existingLead.jobTitle || null, email: existingLead.contactEmail || null, phone: existingLead.contactPhone || null } }
            } : {})
          }
        });
        currentClientId = newClient.id;
        outNewClientId = newClient.id;
        await tx.lead.update({ where: { id: leadId }, data: { clientId: currentClientId } });
        updated.clientId = currentClientId;
      } else if (stage === 'NEW_LEAD' && currentClientId && existingLead.client?.status === 'PROSPECT') {
        await tx.lead.update({ where: { id: leadId }, data: { clientId: null } });
        try {
          await tx.client.delete({ where: { id: currentClientId } });
          outDeletedClientId = currentClientId;
        } catch (err) {
          console.warn(`Could not delete client ${currentClientId} during backward pipeline transition. It may have dependent records.`, err);
        }
        currentClientId = null;
        updated.clientId = null;
      }

      if (currentClientId) {
        let newStatus: 'PROSPECT' | 'ACTIVE' | 'PROJECT_COMPLETED' | 'CHURNED' | 'ONHOLD' | null = null;
        if (['NEW_LEAD', 'OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'CONTRACT'].includes(stage)) newStatus = 'PROSPECT';
        else if (['ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(stage)) newStatus = 'ACTIVE';
        else if (stage === 'ON_HOLD') newStatus = 'ONHOLD';
        else if (stage === 'PROJECT_COMPLETED') newStatus = 'PROJECT_COMPLETED';
        else if (stage === 'CHURNED') newStatus = 'CHURNED';
        if (newStatus) {
          await tx.client.update({ where: { id: currentClientId }, data: { status: newStatus } });
        }
      }

      // --- Revenue Sync Automation ---
      if (currentClientId) {
        if (stage === 'ACTIVE_RETAINER' && previousStage !== 'ACTIVE_RETAINER') {
          const freq = contractType === 'RETAINER' ? (fields?.billingFrequency || 'MONTHLY') : 'MONTHLY';
          const start = contractStartDate ? new Date(contractStartDate) : new Date();
          await tx.subscription.create({
            data: {
              organizationId: orgId,
              clientId: currentClientId,
              amount: dealValue || 0,
              billingFrequency: freq,
              startDate: start,
              nextBillingDate: start,
              status: 'ACTIVE',
              notes: 'Auto-created from CRM Won & Closed gate',
            }
          });
        } else if (stage === 'ACTIVE_PROJECT' && previousStage !== 'ACTIVE_PROJECT') {
          const start = contractStartDate ? new Date(contractStartDate) : new Date();
          const end = contractEndDate ? new Date(contractEndDate) : null;
          await tx.contract.create({
            data: {
              organizationId: orgId,
              clientId: currentClientId,
              title: `${existingLead.companyName || existingLead.contactName} Project`,
              value: dealValue || 0,
              billingFrequency: 'ONE_TIME',
              startDate: start,
              endDate: end,
              status: 'ACTIVE',
              notes: 'Auto-created from CRM Won & Closed gate',
            }
          });
        }
      }
      // -------------------------------

      const reasonLabel = lostReason ? String(lostReason).replace(/_/g, ' ') : null;
      const stageMsg = stage === 'CONTRACT' ? 'signed the contract 🎉'
        : stage === 'CHURNED' ? 'marked this deal as Churned'
        : `moved this lead to ${stage.replace(/_/g, ' ')}`;
      
      await tx.activity.create({
        data: {
          type: 'STAGE_CHANGED',
          message: stageMsg,
          entityType: 'LEAD',
          entityId: leadId,
          userId: req.user!.userId,
          leadId,
          body: [stage === 'CHURNED' && reasonLabel ? `Reason: ${reasonLabel}` : null, notes || null].filter(Boolean).join(' — ') || null,
          metadata: { from: previousStage, to: stage },
        }
      });

      return { updatedLead: updated, finalClientId: currentClientId, newClientId: outNewClientId, deletedClientId: outDeletedClientId };
    }, {
      isolationLevel: 'ReadCommitted' // Keeps transaction short while preventing dirty reads
    });

    const io = req.app.get('io');
    
    // Log Activity socket emit manually since we bypassed logActivity function
    io.to(orgId).emit('activity:new', { leadId });
    
    emitToOrganization(io, orgId, 'lead:updated', updatedLead);
    if (finalClientId) emitToOrganization(io, orgId, 'client:updated', { id: finalClientId });
    if (newClientId) emitToOrganization(io, orgId, 'client:created', { id: newClientId });
    if (deletedClientId) emitToOrganization(io, orgId, 'client:deleted', { id: deletedClientId });"""

content = content[:post_stage_start] + new_post_stage.strip() + content[post_stage_end:]


# Second replace: PATCH /api/crm/leads/:id
patch_stage_start = content.find("if (stage !== undefined && existingLead.stage !== stage) {\n      updateData.stage = stage;")
if patch_stage_start == -1:
    print("Could not find PATCH stage start")
    exit(1)

patch_stage_end_str = "await logActivity({ leadId, type: ActivityType.STAGE_CHANGED, message: `moved this lead to ${stage.replace(/_/g, ' ')}`, userId: req.user!.userId, metadata: { from: existingLead.stage, to: stage }, io: req.app.get('io'), orgId });\n    }"
patch_stage_end = content.find(patch_stage_end_str, patch_stage_start)
if patch_stage_end == -1:
    print("Could not find PATCH stage end")
    exit(1)

patch_stage_end += len(patch_stage_end_str)

new_patch_stage = """const { updatedLead, finalClientId, newClientId, deletedClientId } = await prisma.$transaction(async (tx) => {
      let currentClientId = existingLead.clientId;
      let outNewClientId = null;
      let outDeletedClientId = null;

      if (stage !== undefined && existingLead.stage !== stage) {
        updateData.stage = stage;
        if (stage === 'CHURNED') updateData.renewalStatus = 'CHURNED';
        
        if (PURSUED_STAGES.includes(stage) && !currentClientId) {
          const newClient = await tx.client.create({
            data: {
              name: existingLead.companyName || existingLead.contactName || 'Unknown',
              company: existingLead.companyName || null,
              email: existingLead.contactEmail || null,
              phone: existingLead.contactPhone || null,
              status: 'PROSPECT',
              contractValue: existingLead.dealValue || null,
              organizationId: orgId,
              ...(existingLead.contactName ? {
                contacts: { create: { name: existingLead.contactName, designation: existingLead.jobTitle || null, email: existingLead.contactEmail || null, phone: existingLead.contactPhone || null } }
              } : {})
            }
          });
          currentClientId = newClient.id;
          outNewClientId = newClient.id;
          updateData.clientId = currentClientId;
        } else if (stage === 'NEW_LEAD' && currentClientId && existingLead.client?.status === 'PROSPECT') {
          updateData.clientId = null;
          await tx.client.delete({ where: { id: currentClientId } });
          outDeletedClientId = currentClientId;
          currentClientId = null;
        }

        if (currentClientId) {
          let newStatus: 'ACTIVE' | 'PROJECT_COMPLETED' | 'CHURNED' | null = null;
          if (['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(stage)) newStatus = 'ACTIVE';
          else if (stage === 'PROJECT_COMPLETED') newStatus = 'PROJECT_COMPLETED';
          else if (stage === 'CHURNED') newStatus = 'CHURNED';
          if (newStatus) {
            await tx.client.update({
              where: { id: currentClientId },
              data: {
                status: newStatus,
                contractValue: existingLead.dealValue || undefined
              }
            });
            
            // --- REVENUE MODULE AUTOMATION (5.7) ---
            const fields = req.body.fields || {};
            const billingFreq = String(fields['Billing Frequency'] || fields['billingFrequency'] || 'MONTHLY').toUpperCase();
            const startDateRaw = fields['Start Date Confirmed'] || fields['startDate'];
            const startDate = startDateRaw ? new Date(startDateRaw) : new Date();
            const agreedValue = existingLead.dealValue || 0;

            if (stage === 'ACTIVE_RETAINER') {
               await tx.subscription.create({
                 data: {
                   organizationId: orgId,
                   clientId: currentClientId,
                   amount: agreedValue,
                   billingFrequency: billingFreq === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
                   startDate: startDate,
                   notes: 'Auto-created from CRM'
                 }
               });
            } else if (stage === 'ACTIVE_PROJECT' || stage === 'CONTRACT') {
               await tx.contract.create({
                 data: {
                   organizationId: orgId,
                   clientId: currentClientId,
                   title: `${existingLead.companyName || existingLead.contactName} - Contract`,
                   value: agreedValue,
                   billingFrequency: billingFreq === 'MONTHLY' ? 'MONTHLY' : 'ONE_TIME',
                   startDate: startDate,
                   notes: 'Auto-created from CRM'
                 }
               });
            }
          }
        }
      }

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: updateData,
        include: {
          client: true,
          assignedTo: { select: { id: true, name: true, avatar: true } },
          dealFields: true,
        }
      });

      if (currentClientId && dealValue !== undefined) {
        await tx.client.update({
          where: { id: currentClientId },
          data: { contractValue: dealValue || null }
        });
      }

      if (changes.length > 0) {
        await tx.activity.create({
          data: {
            type: 'LEAD_UPDATED',
            message: changes.join(', '),
            entityType: 'LEAD',
            entityId: leadId,
            userId: req.user!.userId,
            leadId: leadId,
          }
        });
      }

      if (stage !== undefined && existingLead.stage !== stage) {
        await tx.stageHistory.create({ data: { leadId, fromStage: existingLead.stage, toStage: stage, notes: null, changedById: req.user!.userId } });
        await tx.activity.create({
          data: {
            type: 'STAGE_CHANGED',
            message: `moved this lead to ${stage.replace(/_/g, ' ')}`,
            entityType: 'LEAD',
            entityId: leadId,
            userId: req.user!.userId,
            leadId: leadId,
            metadata: { from: existingLead.stage, to: stage },
          }
        });
      }

      return { updatedLead: updated, finalClientId: currentClientId, newClientId: outNewClientId, deletedClientId: outDeletedClientId };
    }, {
      isolationLevel: 'ReadCommitted' // Keeps transaction short while preventing dirty reads
    });

    // Upsert Deal Fields outside the main complex transaction to keep lock time low, or inside if needed.
    // They don't typically affect business risk if slightly out of sync. But we will do it here.
    if (fields && typeof fields === 'object' && Object.keys(fields).length > 0) {
      for (const [key, value] of Object.entries(fields)) {
        const strValue = Array.isArray(value) ? value.join(', ') : (value ? String(value) : null);
        await prisma.dealField.upsert({
          where: { leadId_fieldKey: { leadId, fieldKey: key } },
          update: { fieldValue: strValue },
          create: { leadId, fieldKey: key, fieldValue: strValue }
        });
      }
    }"""

content = content[:patch_stage_start] + new_patch_stage.strip() + content[patch_stage_end:]

with open(r'c:\Users\naifb\Desktop\eyelevel intern\project\flowzen\apps\api\src\routes\crm.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done scripts")
