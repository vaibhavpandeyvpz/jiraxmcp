import process from "node:process";

export function register(
  onShutdown: (signal: NodeJS.Signals) => Promise<void> | void,
): () => void {
  let handled = false;

  const handler = (signal: NodeJS.Signals) => {
    if (handled) {
      return;
    }

    handled = true;

    void Promise.resolve(onShutdown(signal))
      .catch(() => {
        // Ignore shutdown failures and still terminate.
      })
      .finally(() => {
        process.exitCode = signal === "SIGINT" ? 130 : 143;
        process.exit();
      });
  };

  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);

  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}
