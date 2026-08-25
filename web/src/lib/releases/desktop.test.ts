import { describe, expect, it } from "vitest"

import { parseDesktopInstaller, selectDesktopRelease } from "./desktop"

const asset = (name: string) => ({ name, size: 1024, browser_download_url: `https://example.test/${name}` })
const release = (tag: string, prerelease: boolean, assets: ReturnType<typeof asset>[]) => ({ tag_name: tag, name: tag, html_url: `https://example.test/${tag}`, published_at: "2026-08-25T00:00:00Z", prerelease, draft: false, assets })

describe("desktop release installers", () => {
  it("classifies user-facing Tauri installers", () => {
    expect(parseDesktopInstaller(asset("DisCloud_1.0.0_x64-setup.exe"))).toMatchObject({ platform: "windows", architecture: "x64", format: "NSIS" })
    expect(parseDesktopInstaller(asset("DisCloud_1.0.0_x64_en-US.msi"))).toMatchObject({ platform: "windows", architecture: "x64", format: "MSI" })
    expect(parseDesktopInstaller(asset("DisCloud_1.0.0_aarch64.dmg"))).toMatchObject({ platform: "macos", architecture: "arm64", format: "DMG" })
    expect(parseDesktopInstaller(asset("DisCloud_1.0.0_amd64.AppImage"))).toMatchObject({ platform: "linux", architecture: "x64", format: "AppImage" })
    expect(parseDesktopInstaller(asset("DisCloud_1.0.0_amd64.deb"))).toMatchObject({ platform: "linux", architecture: "x64", format: "DEB" })
    expect(parseDesktopInstaller(asset("DisCloud-1.0.0-1.x86_64.rpm"))).toMatchObject({ platform: "linux", architecture: "x64", format: "RPM" })
  })

  it("does not expose backend archives or updater artifacts as installers", () => {
    expect(parseDesktopInstaller(asset("discloud_1.0.0_windows_amd64.zip"))).toBeNull()
    expect(parseDesktopInstaller(asset("discloud_1.0.0_darwin_arm64.tar.gz"))).toBeNull()
    expect(parseDesktopInstaller(asset("latest.json"))).toBeNull()
    expect(parseDesktopInstaller(asset("DisCloud.AppImage.sig"))).toBeNull()
  })

  it("prefers a stable release with installers and otherwise falls back to the newest prerelease with installers", () => {
    const beta = release("v1.1.0-beta.1", true, [asset("DisCloud_1.1.0_amd64.AppImage")])
    const stable = release("v1.0.0", false, [asset("DisCloud_1.0.0_x64-setup.exe")])
    expect(selectDesktopRelease([beta, stable])?.tag).toBe("v1.0.0")
    expect(selectDesktopRelease([beta])?.tag).toBe("v1.1.0-beta.1")
  })

  it("keeps release metadata when no desktop installers have been published yet", () => {
    expect(selectDesktopRelease([release("v0.0.1-beta.9", true, [asset("discloud_0.0.1-beta.9_windows_amd64.zip")])])).toMatchObject({ tag: "v0.0.1-beta.9", installers: [] })
  })
})