// Tiny bounded-concurrency map. Inline so we don't pull in p-limit; the
// scheduler is just N workers each draining a shared cursor. Shared between
// tools that fan out per-calendar osascript queries.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let i = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) {
        return;
      }
      const item = items[idx];
      // noUncheckedIndexedAccess: idx is < items.length, so item is defined.
      // The `if` keeps the type checker happy without a non-null assertion.
      if (item === undefined) {
        continue;
      }
      results[idx] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}
