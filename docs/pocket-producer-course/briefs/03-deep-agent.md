# Module 3: The Deep Agent Producer

### Teaching Arc
- **Metaphor:** A film director working from a locked soundstage: free to choose the shot plan, unable to rebuild the theater.
- **Opening hook:** Natural-language direction becomes a small validated arrangement plan, not arbitrary code or raw notes.
- **Key insight:** The model chooses musical intent inside a narrow contract; deterministic code owns timing, rendering, budgets, and commits.
- **Why should I care?:** This is how to ask for creative AI without giving it unsafe authority or confusing its proposal with truth.

### Code Snippets (pre-extracted)

File: packages/core/src/agent/producer.ts (`produceArrangement`)
```ts
  const accounting = new AccountedOpenAICalls(input.job, config.OPENAI_MODEL, operationHash);
  try {
    const model = new ChatOpenAI({
      model: config.OPENAI_MODEL,
      apiKey: config.OPENAI_API_KEY,
      useResponsesApi: true,
      reasoning: { effort: "low" },
      maxTokens: 900,
      maxRetries: 0,
      timeout: Math.min(60_000, Math.max(1_000, new Date(input.job.deadlineAt).getTime() - Date.now()))
    });
    const agent = createDeepAgent({
      name: "pocket-producer",
      model,
      tools: [paletteTool],
      responseFormat: providerStrategy(arrangementPlanSchema),
      checkpointer: await checkpoint(),
      skills: ["/skills/"],
      permissions: [
        { operations: ["read"], paths: ["/"] },
        { operations: ["read"], paths: ["/skills/**", "/workspace/**"] },
        { operations: ["write"], paths: ["/**"], mode: "deny" },
        { operations: ["read"], paths: ["/**"], mode: "deny" }
      ],
      systemPrompt: "You are Pocket Producer's main producer. Read /skills/arrange-short-instrumental/SKILL.md and /workspace/brief.md, call list_supported_palettes once, then immediately return one valid compact arrangement plan. Do not list the filesystem. Never claim to hear audio. Do not create raw timeline events; deterministic application code compiles the plan."
    });
    const agentInput = { messages: [{ role: "user", content: "Plan this supported instrumental now. Use the source only when its typed descriptors and the direction support a real role." }], files: await runtimeFiles(input.direction, input.source) };
    const result = await agent.invoke(
      agentInput as never,
      { configurable: { thread_id: input.job.id }, recursionLimit: 8, callbacks: [accounting], ...(input.signal ? { signal: input.signal } : {}) }
    );
```

File: packages/core/src/domain/composition.ts (lines 64-73)
```ts
export const arrangementPlanSchema = z.object({
  title: z.string().min(1).max(80),
  tempoBpm: z.number().int().min(78).max(112),
  energy: z.number().min(0.15).max(0.9),
  drumDensity: z.number().min(0.2).max(1),
  bassMotion: z.number().min(0.1).max(1),
  melodyContour: z.enum(["falling", "rising", "wave"]),
  sourceRole: z.enum(["percussion", "texture", "none"]),
  rationale: z.string().min(1).max(400)
});
```

### Interactive Elements
- [x] Code↔English translation of the agent construction.
- [x] Quiz: 3 architecture scenarios about tool permission, schema failure, and fallback mode.
- [x] Architecture diagram: brief/skills + palette tool + OpenAI model + Postgres checkpointer → Zod plan → compiler.
- [x] Permission badges for read-only workspace, no raw events, one palette, spend limit.

### Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks, Interactive Architecture Diagram, Multiple-Choice Quizzes, Permission/Config Badges, Glossary Tooltips
- `references/design-system.md` → Module Structure, Responsive Breakpoints
- `references/content-philosophy.md` → all content rules
- `references/gotchas.md` → full checklist

### Connections
- Previous: durable worker claims a planning job.
- Next: canonical compiler and renderer turn the plan into audio.
- Tone/style: clearly distinguish Deep Agents framework, LangGraph checkpointer, OpenAI model, runtime skill files, and the one palette tool.
