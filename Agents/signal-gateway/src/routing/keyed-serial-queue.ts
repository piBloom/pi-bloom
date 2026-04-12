export class KeyedSerialQueue {
  private chains = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();

    let resolveCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });

    const next = previous
      .catch(() => {
        // Keep the chain alive after failures.
      })
      .then(() => current);

    this.chains.set(key, next);

    try {
      await previous.catch(() => undefined);
      return await task();
    } finally {
      resolveCurrent();

      if (this.chains.get(key) === next) {
        this.chains.delete(key);
      }
    }
  }
}
