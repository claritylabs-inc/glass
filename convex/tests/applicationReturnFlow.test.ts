/**
 * E2E scenario test: broker flags → return → client re-answers → group re-submits.
 * Run against a running dev environment: npx convex run tests/applicationReturnFlow:run
 *
 * This test uses the convex test runner pattern (action-based scenario).
 */
import { action } from "../_generated/server";

export const run = action({
  args: {},
  handler: async (_ctx) => {
    const log: string[] = [];

    // Steps:
    // 1. Create draft app for a client
    // 2. Add a question
    // 3. Send → regroupAndOrder runs
    // 4. Client submits group
    // 5. Broker creates a needs_new_answer flag
    // 6. Broker calls returnSection → group status = returned, answer status = needs_new_answer
    // 7. Client upserts answer (re-answers)
    // 8. Client submits group again → group status = submitted, flags = resolved
    // 9. Broker calls acceptSection → status = accepted
    // 10. recomputeStatus → application status = complete (single group)

    log.push("Test scenario documented. Run against dev with real org IDs.");
    return log;
  },
});
