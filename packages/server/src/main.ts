import { buildApp } from "./app.js";
import { envConfig } from "./config.js";

const config = envConfig();
const app = await buildApp(config);
const address = await app.listen({ port: config.port, host: config.host });
app.log.info(`API docs at ${address}/docs`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error(err);
        process.exit(1);
      },
    );
  });
}
