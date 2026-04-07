import { internalMutation } from "../_generated/server";

/**
 * Move policies with documentType === "quote" to the new quotes table.
 * Creates a quote record, updates agent conversations, and soft-deletes the old policy.
 */
export const migrateQuotesToTable = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allPolicies = await ctx.db.query("policies").collect();
    const quotePolicies = allPolicies.filter(
      (p) => p.documentType === "quote" && !p.deletedAt
    );

    let migrated = 0;
    let skipped = 0;

    for (const p of quotePolicies) {
      // Map policy coverages to quote coverages
      const coverages = p.coverages.map((c) => ({
        name: c.name,
        proposedLimit: c.limit ?? "N/A",
        proposedDeductible: c.deductible,
        pageNumber: c.pageNumber,
        sectionRef: c.sectionRef,
      }));

      // Create quote record
      const quoteId = await ctx.db.insert("quotes", {
        userId: p.userId,
        orgId: p.orgId,
        emailId: p.emailId,
        fileId: p.fileId,
        fileName: p.fileName,
        carrier: p.carrier,
        security: p.security,
        underwriter: p.underwriter,
        mga: p.mga,
        broker: p.broker,
        quoteNumber: p.policyNumber,
        policyTypes: p.policyTypes,
        quoteYear: p.policyYear,
        proposedEffectiveDate: p.effectiveDate !== "Unknown" ? p.effectiveDate : undefined,
        proposedExpirationDate: p.expirationDate !== "Unknown" ? p.expirationDate : undefined,
        isRenewal: p.isRenewal,
        coverages,
        premium: p.premium,
        insuredName: p.insuredName,
        summary: p.summary,
        metadataSource: p.metadataSource ? {
          carrierPage: p.metadataSource.carrierPage,
          quoteNumberPage: p.metadataSource.policyNumberPage,
          premiumPage: p.metadataSource.premiumPage,
          effectiveDatePage: p.metadataSource.effectiveDatePage,
        } : undefined,
        document: p.document ? { sections: p.document.sections } : undefined,
        extractionStatus: p.extractionStatus as any,
        extractionError: p.extractionError,
        extractionLog: p.extractionLog,
        rawExtractionResponse: p.rawExtractionResponse,
        rawMetadataResponse: p.rawMetadataResponse,
        isDemo: p.isDemo,
      });

      // Update agent conversations referencing this policy
      const conversations = await ctx.db
        .query("agentConversations")
        .collect();
      for (const conv of conversations) {
        if (conv.referencedPolicyIds?.includes(p._id)) {
          const updatedPolicyIds = conv.referencedPolicyIds.filter(
            (id) => id !== p._id
          );
          const existingQuoteIds = conv.referencedQuoteIds ?? [];
          await ctx.db.patch(conv._id, {
            referencedPolicyIds: updatedPolicyIds.length > 0 ? updatedPolicyIds : undefined,
            referencedQuoteIds: [...existingQuoteIds, quoteId],
          });
        }
      }

      // Update audit log entries
      const auditEntries = await ctx.db
        .query("policyAuditLog")
        .withIndex("by_policyId", (q) => q.eq("policyId", p._id))
        .collect();
      for (const entry of auditEntries) {
        await ctx.db.patch(entry._id, {
          policyId: undefined,
          quoteId: quoteId,
        });
      }

      // Soft-delete the old policy record
      await ctx.db.patch(p._id, { deletedAt: Date.now() });

      migrated++;
    }

    // Verification
    const remainingQuotes = (await ctx.db.query("policies").collect()).filter(
      (p) => p.documentType === "quote" && !p.deletedAt
    );

    return {
      migrated,
      skipped,
      remainingQuotePolicies: remainingQuotes.length,
    };
  },
});
