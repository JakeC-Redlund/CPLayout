/** Pending read ownership is separate from the generation of the committed project. */
export function createProjectOpenRequestGuard() {
  let latest: { owner?: object } | null = null;
  return {
    invalidate(owner?: object): void {
      if (owner === undefined || latest?.owner === owner) latest = null;
    },
    async open<T>(read: () => Promise<T | null>, commit: (value: T) => void, owner?: object): Promise<void> {
      const request = { owner };
      latest = request;
      let value: T | null;
      try {
        value = await read();
      } catch (error) {
        if (latest !== request) return;
        latest = null;
        throw error;
      }
      if (latest !== request) return;
      latest = null;
      if (value !== null) commit(value);
    },
  };
}
