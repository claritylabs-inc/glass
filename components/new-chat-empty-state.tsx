const EXAMPLE_PROMPTS = [
  {
    label: "List my active policies and key limits",
    prompt: "List my active policies and key limits",
  },
  {
    label: "Find the cancellation notice requirement",
    prompt: "Find the cancellation notice requirement in my policies",
  },
  {
    label: "Compare deductibles across my policies",
    prompt: "Compare deductibles across my active policies",
  },
  {
    label: "Draft a COI request email",
    prompt: "Draft an email requesting the details needed to generate a certificate of insurance",
  },
];

export function NewChatEmptyState({
  onSelectPrompt,
}: {
  onSelectPrompt: (prompt: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl pt-10 pb-8">
      <p className="mb-4 text-body-sm text-muted-foreground/60">Some ideas...</p>
      <div className="border-t border-foreground/10">
        {EXAMPLE_PROMPTS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => onSelectPrompt(item.prompt)}
            className="w-full border-b border-foreground/10 py-2.5 text-left text-body-sm leading-snug text-foreground/70 transition-colors hover:text-foreground"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
