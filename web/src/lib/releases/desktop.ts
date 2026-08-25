export type DesktopPlatform = "windows" | "macos" | "linux"
export type DesktopArchitecture = "x64" | "arm64" | "universal"
export type DesktopInstallerFormat = "NSIS" | "MSI" | "DMG" | "AppImage" | "DEB" | "RPM"

export type DesktopInstaller = {
  name: string
  url: string
  size: number
  platform: DesktopPlatform
  architecture: DesktopArchitecture
  format: DesktopInstallerFormat
}

export type DesktopRelease = {
  tag: string
  name: string
  url: string
  publishedAt: string
  prerelease: boolean
  installers: DesktopInstaller[]
}

type GitHubReleaseAsset = { name: string; size: number; browser_download_url: string }
type GitHubRelease = { tag_name: string; name: string | null; html_url: string; published_at: string | null; prerelease: boolean; draft: boolean; assets: GitHubReleaseAsset[] }

const RELEASES_URL = "https://api.github.com/repos/mewisme/discloud/releases?per_page=20"

export async function getDesktopRelease(): Promise<DesktopRelease | null> {
  try {
    const response = await fetch(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "DisCloud-Web", "X-GitHub-Api-Version": "2022-11-28" },
      next: { revalidate: 900 },
    })
    if (!response.ok) return null
    return selectDesktopRelease(await response.json() as GitHubRelease[])
  } catch {
    return null
  }
}

export function selectDesktopRelease(releases: GitHubRelease[]): DesktopRelease | null {
  const parsed = releases.filter((release) => !release.draft).map(parseRelease)
  const withInstallers = parsed.filter((release) => release.installers.length > 0)
  return withInstallers.find((release) => !release.prerelease) ?? withInstallers[0] ?? parsed.find((release) => !release.prerelease) ?? parsed[0] ?? null
}

export function parseDesktopInstaller(asset: GitHubReleaseAsset): DesktopInstaller | null {
  const lower = asset.name.toLowerCase()
  let platform: DesktopPlatform
  let format: DesktopInstallerFormat
  if (lower.endsWith("-setup.exe") || lower.endsWith(".exe")) { platform = "windows"; format = "NSIS" }
  else if (lower.endsWith(".msi")) { platform = "windows"; format = "MSI" }
  else if (lower.endsWith(".dmg")) { platform = "macos"; format = "DMG" }
  else if (lower.endsWith(".appimage")) { platform = "linux"; format = "AppImage" }
  else if (lower.endsWith(".deb")) { platform = "linux"; format = "DEB" }
  else if (lower.endsWith(".rpm")) { platform = "linux"; format = "RPM" }
  else return null

  return { name: asset.name, url: asset.browser_download_url, size: asset.size, platform, architecture: installerArchitecture(lower), format }
}

function parseRelease(release: GitHubRelease): DesktopRelease {
  return {
    tag: release.tag_name,
    name: release.name || release.tag_name,
    url: release.html_url,
    publishedAt: release.published_at ?? "",
    prerelease: release.prerelease,
    installers: release.assets.map(parseDesktopInstaller).filter((installer): installer is DesktopInstaller => installer !== null),
  }
}

function installerArchitecture(name: string): DesktopArchitecture {
  if (/aarch64|arm64/.test(name)) return "arm64"
  if (/x86_64|x64|amd64/.test(name)) return "x64"
  return "universal"
}