import { describe, expect, it } from "vitest"

import type { LocalRuntimeSnapshot } from "#lib/local-runtime"

import { advanceLocalProvisioningStage, getLocalProvisioningStage } from "./local-server-provisioning"

function runtimeSnapshot(status: LocalRuntimeSnapshot["status"]): LocalRuntimeSnapshot {
  return {
    status,
    paths: null,
    manifest: null,
    postgresql: { installed: false, initialized: false, running: false, version: null, port: null },
    backend: { installed: false, desiredInstalled: false, running: false, version: null, desiredVersion: "0.0.1", previousVersion: null, port: null },
    web: { enabled: true, installed: false, desiredInstalled: false, running: false, version: null, desiredVersion: "0.0.1", previousVersion: null, port: null, url: null, error: null },
    error: null,
  }
}

describe("local provisioning stages", () => {
  it("maps native runtime lifecycle states to provisioning stages", () => {
    expect(getLocalProvisioningStage(runtimeSnapshot("installing"), true)).toBe("postgresqlRuntime")
    expect(getLocalProvisioningStage(runtimeSnapshot("downloading"), true)).toBe("postgresqlRuntime")
    expect(getLocalProvisioningStage(runtimeSnapshot("initializingDatabase"), true)).toBe("database")
    expect(getLocalProvisioningStage(runtimeSnapshot("startingBackend"), true)).toBe("backend")
    expect(getLocalProvisioningStage(runtimeSnapshot("startingWeb"), true)).toBe("web")
    expect(getLocalProvisioningStage(runtimeSnapshot("ready"), true)).toBe("connect")
  })

  it("identifies later runtime preparation from component snapshots", () => {
    const backend = runtimeSnapshot("installing")
    backend.postgresql = { installed: true, initialized: true, running: true, version: "18.6.0", port: 27832 }
    expect(getLocalProvisioningStage(backend, true)).toBe("backend")

    const web = runtimeSnapshot("downloading")
    web.postgresql = { installed: true, initialized: true, running: true, version: "18.6.0", port: 27832 }
    web.backend = { installed: true, desiredInstalled: true, running: true, version: "0.0.1", desiredVersion: "0.0.1", previousVersion: null, port: 27831 }
    expect(getLocalProvisioningStage(web, true)).toBe("web")
  })

  it("never regresses an already reached provisioning stage", () => {
    expect(advanceLocalProvisioningStage("backend", "database")).toBe("backend")
    expect(advanceLocalProvisioningStage("backend", "web")).toBe("web")
  })
})
