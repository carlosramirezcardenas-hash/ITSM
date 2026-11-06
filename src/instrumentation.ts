export async function register() {
  // Condición literal para que el bundle de edge excluya el código de Node
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
