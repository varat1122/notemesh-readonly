import {beforeEach} from "vitest";
// Unit fixtures deliberately host a new disposable instance per test in one
// worker process. Production has no reset API. Never reset within a scenario;
// cold-process and emitted-server probes exercise real lifetime boundaries.
beforeEach(()=>{delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.c1-pilot.identity.v1")];});
