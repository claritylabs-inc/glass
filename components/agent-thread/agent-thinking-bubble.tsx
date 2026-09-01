export function AgentThinkingBubble() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Spot is thinking"
      className="inline-flex h-9 items-center gap-1 rounded-lg bg-foreground/[0.03] px-3"
    >
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          aria-hidden
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/45 motion-reduce:animate-none"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}
