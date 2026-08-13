import * as fs from "fs";
import * as path from "path";
import { conductorJsonSchema } from "../src/schemas/conductor.js";
import { frameJsonSchema } from "../src/schemas/frame.js";
import { discoverJsonSchema } from "../src/schemas/discover.js";
import { planJsonSchema } from "../src/schemas/plan.js";
import { specJsonSchema } from "../src/schemas/spec.js";
import { buildJsonSchema } from "../src/schemas/build.js";
import { shipJsonSchema } from "../src/schemas/ship.js";
import { changeJsonSchema } from "../src/schemas/change.js";
import { workerJsonSchema } from "../src/schemas/worker.js";
import { validatorJsonSchema } from "../src/schemas/validator.js";

const outDir = path.resolve(process.cwd(), "schemas");
fs.mkdirSync(outDir, { recursive: true });

const schemas = {
  "conductor.schema.json": conductorJsonSchema,
  "frame.schema.json": frameJsonSchema,
  "discover.schema.json": discoverJsonSchema,
  "plan.schema.json": planJsonSchema,
  "spec.schema.json": specJsonSchema,
  "build.schema.json": buildJsonSchema,
  "ship.schema.json": shipJsonSchema,
  "change.schema.json": changeJsonSchema,
  "worker.schema.json": workerJsonSchema,
  "validator.schema.json": validatorJsonSchema,
};

for (const [file, schema] of Object.entries(schemas)) {
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(schema, null, 2));
  console.log(`wrote schemas/${file}`);
}
