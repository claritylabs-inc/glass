export type AgentToolAudit = {
  usedTools: string[];
  toolCalls: Array<{ name: string; input?: string; output?: string }>;
  workflowOutcomes: unknown[];
};

function serializeToolAuditValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

export function collectToolAudit(result: unknown): AgentToolAudit {
  const usedTools: string[] = [];
  const toolCalls: AgentToolAudit["toolCalls"] = [];
  const workflowOutcomes: unknown[] = [];
  const seen = new Set<string>();

  const addUsedTool = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    usedTools.push(name);
  };

  const addToolCall = (call: Record<string, unknown>) => {
    const name = call.toolName ?? call.name;
    if (typeof name !== "string" || !name) return;
    addUsedTool(name);
    const input = call.input ?? call.args ?? call.parameters;
    toolCalls.push({
      name,
      input: serializeToolAuditValue(input),
    });
  };

  const addToolResult = (resultPart: Record<string, unknown>) => {
    const name = resultPart.toolName ?? resultPart.name;
    if (typeof name !== "string" || !name) return;
    addUsedTool(name);
    const output =
      resultPart.output ?? resultPart.result ?? resultPart.value ?? undefined;
    if (output && typeof output === "object" && "workflowOutcome" in output) {
      workflowOutcomes.push((output as Record<string, unknown>).workflowOutcome);
    }
    const target = [...toolCalls]
      .reverse()
      .find((candidate) => candidate.name === name && !candidate.output);
    if (target) {
      target.output = serializeToolAuditValue(output);
    }
  };

  const addStepAudit = (step: unknown) => {
    if (!step || typeof step !== "object") return;
    const stepRecord = step as Record<string, unknown>;
    const calls = Array.isArray(stepRecord.toolCalls)
      ? stepRecord.toolCalls
      : [];
    for (const call of calls) {
      if (call && typeof call === "object") {
        addToolCall(call as Record<string, unknown>);
      }
    }
    const results = Array.isArray(stepRecord.toolResults)
      ? stepRecord.toolResults
      : [];
    for (const toolResult of results) {
      if (toolResult && typeof toolResult === "object") {
        addToolResult(toolResult as Record<string, unknown>);
      }
    }
  };

  const root = result as Record<string, unknown>;
  addStepAudit(root);

  const steps = Array.isArray(root.steps) ? root.steps : [];
  for (const step of steps) {
    addStepAudit(step);
  }

  return { usedTools, toolCalls, workflowOutcomes };
}
