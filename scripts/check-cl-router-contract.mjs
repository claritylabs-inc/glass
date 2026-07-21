import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const CONTRACT_DIR = fileURLToPath(
  new URL("../contracts/cl-router/", import.meta.url),
);
const OPENAPI_PATH = `${CONTRACT_DIR}/openapi.v1.json`;
const FIXTURES_PATH = `${CONTRACT_DIR}/fixtures.v1.json`;
const SOURCE_PATH = `${CONTRACT_DIR}/source.json`;
const REQUIRED_OPERATION_KEYS = [
  "get /health",
  "post /v1/generate",
  "post /v1/generate/stream",
  "post /v1/embed",
  "post /v1/transcribe",
  "post /v1/feedback",
  "post /admin/freeze",
  "post /admin/pin",
  "post /admin/calibration-seeds/import",
  "get /admin/policy",
  "get /admin/rollups",
  "post /admin/score",
];
const REQUIRED_FIXTURE_SCHEMAS = [
  "GenerateRequest",
  "GenerateResponse",
  "StreamEvent",
  "EmbedRequest",
  "EmbedResponse",
  "TranscribeMetadata",
  "TranscribeResponse",
  "FeedbackRequest",
  "FeedbackResponse",
  "HealthResponse",
  "FreezeRequest",
  "FreezeResponse",
  "PinRequest",
  "PinResponse",
  "CalibrationSeedImportRequest",
  "CalibrationSeedImportResponse",
  "ScoreRequest",
  "AdminPolicyResponse",
  "AdminRollupResponse",
  "AdminScoreResponse",
];

function fail(message) {
  throw new Error(`cl-router contract check failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(path, label) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    fail(`could not read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return { source, value: JSON.parse(source) };
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function schemaId(name) {
  return `https://glass.local/contracts/cl-router/v1/schemas/${encodeURIComponent(name)}`;
}

function rewriteComponentRefs(value) {
  if (Array.isArray(value)) return value.map(rewriteComponentRefs);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (
        key === "$ref"
        && typeof item === "string"
        && item.startsWith("#/components/schemas/")
      ) {
        return [key, schemaId(item.slice("#/components/schemas/".length))];
      }
      return [key, rewriteComponentRefs(item)];
    }),
  );
}

function formatValidationErrors(errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function compileSchemas(openapi) {
  const schemas = openapi.components?.schemas;
  assert(isRecord(schemas), "components.schemas is missing");

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: false,
  });
  for (const [name, schema] of Object.entries(schemas)) {
    assert(isRecord(schema), `schema ${name} is not an object`);
    ajv.addSchema({
      ...rewriteComponentRefs(schema),
      $id: schemaId(name),
    });
  }

  const validators = new Map();
  for (const name of Object.keys(schemas)) {
    let validator;
    try {
      validator = ajv.getSchema(schemaId(name));
    } catch (error) {
      fail(`schema ${name} does not compile: ${error instanceof Error ? error.message : String(error)}`);
    }
    assert(validator, `schema ${name} could not be compiled`);
    validators.set(name, validator);
  }
  return validators;
}

function expectedRef(schema) {
  return `#/components/schemas/${schema}`;
}

function checkOperationBindings(openapi, operations) {
  assert(Array.isArray(operations) && operations.length > 0, "operation bindings are missing");
  const operationKeys = new Set(
    operations.map((operation) => `${operation.method} ${operation.path}`),
  );
  assert(operationKeys.size === operations.length, "operation fixtures contain duplicates");
  for (const key of REQUIRED_OPERATION_KEYS) {
    assert(operationKeys.has(key), `required operation fixture ${key} is missing`);
  }
  for (const contract of operations) {
    const operation = openapi.paths?.[contract.path]?.[contract.method];
    assert(operation, `${contract.method.toUpperCase()} ${contract.path} is missing`);
    assert(
      Array.isArray(contract.responses) && contract.responses.length > 0,
      `${contract.name} must declare a response binding`,
    );
    if (contract.method === "post") {
      assert(contract.request, `${contract.name} must declare a request binding`);
    }

    if (contract.request) {
      const requestBody = operation.requestBody;
      assert(isRecord(requestBody), `${contract.name} request body is missing`);
      if (contract.request.required === true) {
        assert(requestBody.required === true, `${contract.name} request body must be required`);
      }
      const requestSchema = requestBody.content?.[contract.request.mediaType]?.schema;
      assert(isRecord(requestSchema), `${contract.name} ${contract.request.mediaType} request schema is missing`);
      if (contract.request.schema) {
        assert(
          requestSchema.$ref === expectedRef(contract.request.schema),
          `${contract.name} request must reference ${contract.request.schema}`,
        );
      }
      if (contract.request.requiredFields) {
        for (const field of contract.request.requiredFields) {
          assert(
            requestSchema.required?.includes(field),
            `${contract.name} multipart request must require ${field}`,
          );
        }
      }
    }

    for (const response of contract.responses ?? []) {
      assert(typeof response.schema === "string", `${contract.name} response schema is missing`);
      const responseSchema = operation.responses?.[response.status]?.content?.[response.mediaType]?.schema;
      assert(
        isRecord(responseSchema),
        `${contract.name} ${response.status} ${response.mediaType} response schema is missing`,
      );
      assert(
        responseSchema.$ref === expectedRef(response.schema),
        `${contract.name} ${response.status} response must reference ${response.schema}`,
      );
    }
  }

  const calibrationImport = operations.find(
    (operation) => operation.method === "post" && operation.path === "/admin/calibration-seeds/import",
  );
  assert(
    calibrationImport?.request?.schema === "CalibrationSeedImportRequest",
    "admin calibration seed import must bind CalibrationSeedImportRequest",
  );
  assert(
    calibrationImport.responses?.some(
      (response) => response.status === "200"
        && response.mediaType === "application/json"
        && response.schema === "CalibrationSeedImportResponse",
    ),
    "admin calibration seed import must bind the 200 CalibrationSeedImportResponse",
  );
}

function hasExactSecurityBinding(operation, schemeName) {
  return Array.isArray(operation.security)
    && operation.security.length === 1
    && isRecord(operation.security[0])
    && Object.keys(operation.security[0]).length === 1
    && Array.isArray(operation.security[0][schemeName])
    && operation.security[0][schemeName].length === 0;
}

function checkSecurityBindings(openapi) {
  const securitySchemes = openapi.components?.securitySchemes;
  assert(isRecord(securitySchemes), "components.securitySchemes is missing");
  for (const schemeName of ["inferenceBearerAuth", "adminBearerAuth"]) {
    const scheme = securitySchemes[schemeName];
    assert(
      isRecord(scheme) && scheme.type === "http" && scheme.scheme === "bearer",
      `${schemeName} must be an HTTP bearer security scheme`,
    );
  }

  const healthOperation = openapi.paths?.["/health"]?.get;
  assert(isRecord(healthOperation), "GET /health is missing");
  assert(
    Array.isArray(healthOperation.security) && healthOperation.security.length === 0,
    "GET /health must be explicitly public",
  );

  for (const [path, pathItem] of Object.entries(openapi.paths ?? {})) {
    if (!path.startsWith("/v1/") && !path.startsWith("/admin/")) continue;
    assert(isRecord(pathItem), `${path} path item is malformed`);
    const schemeName = path.startsWith("/v1/")
      ? "inferenceBearerAuth"
      : "adminBearerAuth";
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!["get", "post", "put", "patch", "delete", "options", "head", "trace"].includes(method)) {
        continue;
      }
      assert(isRecord(operation), `${method.toUpperCase()} ${path} is malformed`);
      assert(
        hasExactSecurityBinding(operation, schemeName),
        `${method.toUpperCase()} ${path} must use only ${schemeName}`,
      );
    }
  }
}

function checkFixtures(validators, fixtures) {
  assert(Array.isArray(fixtures) && fixtures.length > 0, "schema fixtures are missing");
  const fixtureNames = new Set();
  const fixtureSchemas = new Set(fixtures.map((fixture) => fixture.schema));
  for (const schema of REQUIRED_FIXTURE_SCHEMAS) {
    assert(fixtureSchemas.has(schema), `required ${schema} fixture is missing`);
  }
  for (const fixture of fixtures) {
    assert(typeof fixture.name === "string" && fixture.name.length > 0, "fixture name is missing");
    assert(!fixtureNames.has(fixture.name), `fixture name ${fixture.name} is duplicated`);
    fixtureNames.add(fixture.name);
    const validator = validators.get(fixture.schema);
    assert(validator, `${fixture.name} references missing schema ${fixture.schema}`);
    if (!validator(fixture.value)) {
      fail(`${fixture.name} is invalid: ${formatValidationErrors(validator.errors)}`);
    }
  }
}

function checkCalibrationFixture(fixtures) {
  const fixture = fixtures.find(
    (candidate) => candidate.schema === "CalibrationSeedImportRequest",
  );
  assert(fixture, "CalibrationSeedImportRequest fixture is missing");
  const seed = fixture.value?.seed;
  assert(isRecord(seed), "calibration fixture seed is missing");
  const qualificationSpec = seed.qualificationSpec;
  assert(isRecord(qualificationSpec), "calibration fixture qualification spec is missing");
  assert(
    qualificationSpec.id === "glass-policy-extraction-source-tree@1"
      && qualificationSpec.task === "extraction"
      && qualificationSpec.taskFamily === "extraction_source_tree",
    "calibration fixture must use the reviewed Glass policy extraction qualification spec",
  );
  assert(
    qualificationSpec.classification === "proxy_benchmark"
      && qualificationSpec.activationEligibility === "benchmark_only"
      && qualificationSpec.runtimeContract === null,
    "calibration fixture must classify the current extraction spec as a benchmark-only proxy",
  );
  for (const field of [
    "promptContractId",
    "schemaContractId",
    "validationContractId",
    "scorerContractId",
  ]) {
    assert(
      typeof qualificationSpec[field] === "string"
        && /#sha256=[a-f0-9]{64}$/.test(qualificationSpec[field]),
      `calibration fixture ${field} must be bound to content-addressed reviewed artifacts`,
    );
  }
  assert(
    Array.isArray(qualificationSpec.requiredOpenBenchmarks)
      && qualificationSpec.requiredOpenBenchmarks.length > 0,
    "calibration fixture qualification spec must require open benchmarks",
  );

  const corpusEvidence = seed.corpusEvidence;
  assert(
    Array.isArray(corpusEvidence) && corpusEvidence.length > 0,
    "calibration fixture corpus evidence is missing",
  );
  const corpusIds = new Set();
  for (const corpus of corpusEvidence) {
    assert(isRecord(corpus), "calibration fixture corpus evidence is malformed");
    assert(!corpusIds.has(corpus.corpusId), `calibration corpus ${corpus.corpusId} is duplicated`);
    corpusIds.add(corpus.corpusId);
    assert(
      seed.corpusVersions?.[corpus.corpusId] === corpus.corpusVersion,
      `calibration corpus ${corpus.corpusId} version does not match corpusVersions`,
    );
    assert(
      corpus.qualificationSpecId === qualificationSpec.id,
      `calibration corpus ${corpus.corpusId} is not bound to the qualification spec`,
    );
    assert(
      corpus.caseCount === corpus.documents?.length,
      `calibration corpus ${corpus.corpusId} case count does not match its document evidence`,
    );
    const documentIds = new Set();
    const documentHashes = new Set();
    for (const document of corpus.documents) {
      assert(!documentIds.has(document.id), `calibration corpus ${corpus.corpusId} document IDs are duplicated`);
      assert(
        !documentHashes.has(document.documentSha256),
        `calibration corpus ${corpus.corpusId} document hashes are duplicated`,
      );
      documentIds.add(document.id);
      documentHashes.add(document.documentSha256);
      const expectedDocumentHash = sha256(JSON.stringify({
        id: document.id,
        assetSha256: document.assetSha256,
        labelsSha256: document.labelsSha256,
      }));
      assert(
        document.documentSha256 === expectedDocumentHash,
        `calibration corpus ${corpus.corpusId} document ${document.id} integrity hash is invalid`,
      );
    }
    const expectedCorpusHash = sha256(JSON.stringify(
      corpus.documents.toSorted((left, right) => left.id.localeCompare(right.id)),
    ));
    assert(
      corpus.corpusSha256 === expectedCorpusHash,
      `calibration corpus ${corpus.corpusId} integrity hash is invalid`,
    );
  }
  assert(
    Object.keys(seed.corpusVersions ?? {}).length === corpusIds.size,
    "calibration corpusVersions must exactly match corpus evidence",
  );

  const productionReview = seed.productionReview;
  assert(isRecord(productionReview), "calibration fixture production review is missing");
  assert(
    !corpusEvidence.some((corpus) => corpus.purpose === "synthetic_smoke"),
    "calibration fixture cannot use synthetic smoke evidence for activation",
  );
  const inHouseCorpora = corpusEvidence.filter((corpus) => corpus.benchmark === "in_house");
  assert(inHouseCorpora.length === 1, "calibration fixture must contain one in-house corpus");
  const privateCorpus = inHouseCorpora[0];
  assert(
    privateCorpus.purpose === "production_qualification"
      && privateCorpus.sourceKind === "private_bucket",
    "calibration in-house corpus must be private production qualification evidence",
  );
  assert(
    privateCorpus.corpusId === productionReview.privateCorpusId,
    "calibration production review must identify the private production corpus",
  );
  assert(
    privateCorpus.documents.length >= 20,
    "calibration private production corpus must contain at least 20 documents",
  );
  const privateDocumentHashes = new Set(
    privateCorpus.documents.map((document) => document.documentSha256),
  );
  for (const [coverageClass, hashes] of Object.entries(
    productionReview.coverageDocumentHashes ?? {},
  )) {
    assert(
      hashes.every((hash) => privateDocumentHashes.has(hash)),
      `calibration coverage ${coverageClass} must reference private corpus documents`,
    );
  }

  for (const benchmark of qualificationSpec.requiredOpenBenchmarks) {
    const matchingCorpora = corpusEvidence.filter(
      (corpus) => corpus.benchmark === benchmark && corpus.purpose === "open_benchmark",
    );
    assert(
      matchingCorpora.length === 1,
      `calibration fixture must contain exactly one ${benchmark} open benchmark corpus`,
    );
  }
  const requiredOpenBenchmarks = new Set(qualificationSpec.requiredOpenBenchmarks);
  for (const corpus of corpusEvidence.filter((item) => item.purpose === "open_benchmark")) {
    assert(
      requiredOpenBenchmarks.has(corpus.benchmark),
      `calibration fixture contains unexpected open benchmark ${corpus.benchmark}`,
    );
  }

  const totalCases = corpusEvidence.reduce((sum, corpus) => sum + corpus.caseCount, 0);
  const expectedCallsByBenchmark = new Map();
  for (const corpus of corpusEvidence) {
    expectedCallsByBenchmark.set(
      corpus.benchmark,
      (expectedCallsByBenchmark.get(corpus.benchmark) ?? 0)
        + corpus.caseCount * seed.replicateCount,
    );
  }
  for (const candidate of seed.candidates ?? []) {
    assert(
      candidate.qualificationSpecId === qualificationSpec.id,
      `calibration candidate ${candidate.candidateId} is not bound to the qualification spec`,
    );
    assert(
      candidate.task === qualificationSpec.task
        && candidate.taskFamily === qualificationSpec.taskFamily,
      `calibration candidate ${candidate.candidateId} does not match the qualification task`,
    );
    assert(
      candidate.successfulCalls === totalCases * seed.replicateCount,
      `calibration candidate ${candidate.candidateId} does not cover every corpus replicate`,
    );
    const benchmarkRows = new Map();
    for (const row of candidate.byBenchmark) {
      assert(
        !benchmarkRows.has(row.benchmark),
        `calibration candidate ${candidate.candidateId} duplicates ${row.benchmark} results`,
      );
      benchmarkRows.set(row.benchmark, row);
      assert(
        row.callCount === expectedCallsByBenchmark.get(row.benchmark),
        `calibration candidate ${candidate.candidateId} ${row.benchmark} calls do not match corpus evidence`,
      );
    }
    assert(
      benchmarkRows.size === expectedCallsByBenchmark.size,
      `calibration candidate ${candidate.candidateId} benchmark results are incomplete`,
    );
  }
}

const [{ source: openapiSource, value: openapi }, { value: fixtureFile }, { value: provenance }] =
  await Promise.all([
    readJson(OPENAPI_PATH, "OpenAPI snapshot"),
    readJson(FIXTURES_PATH, "contract fixtures"),
    readJson(SOURCE_PATH, "snapshot provenance"),
  ]);

assert(openapi.openapi === "3.1.0", `expected OpenAPI 3.1.0, received ${openapi.openapi ?? "missing"}`);
assert(openapi.info?.version === "1.0.0", `expected API version 1.0.0, received ${openapi.info?.version ?? "missing"}`);
assert(provenance.sourceRepository === "claritylabs-inc/cl-router", "source repository is not cl-router");
assert(typeof provenance.sourcePath === "string" && provenance.sourcePath.length > 0, "source path is missing");
assert(
  typeof provenance.sourceRevision === "string"
    && /^[a-f0-9]{40}$/.test(provenance.sourceRevision),
  "source revision must be a full lowercase 40-character Git commit SHA",
);
assert(
  provenance.sourceWorktreeDirty === false,
  "released contract snapshots must come from a clean source worktree",
);
assert(
  typeof provenance.sha256 === "string" && /^[a-f0-9]{64}$/.test(provenance.sha256),
  "snapshot SHA-256 is missing or malformed",
);
const actualDigest = sha256(openapiSource);
assert(
  actualDigest === provenance.sha256,
  `snapshot digest drifted (expected ${provenance.sha256}, received ${actualDigest})`,
);

const validators = compileSchemas(openapi);
checkOperationBindings(openapi, fixtureFile.operations);
checkSecurityBindings(openapi);
checkFixtures(validators, fixtureFile.fixtures);
checkCalibrationFixture(fixtureFile.fixtures);

console.log(
  `cl-router contract OK: ${fixtureFile.fixtures.length} fixtures, ${fixtureFile.operations.length} operations, sha256 ${actualDigest.slice(0, 12)}`,
);
