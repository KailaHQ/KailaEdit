'use strict'

/**
 * Pre-packaging cleanup script for GitHub Releases.
 *
 * Prevents 422 Unprocessable Entity (already_exists) errors when electron-builder
 * uploads assets to a GitHub Release that already contains files from a previous run
 * or a re-run of a failed CI job.
 *
 * It paginates through all assets on the draft/published release matching the git tag,
 * and deletes only the assets that belong to the current runner's target platform.
 */

const targetPlatform = process.argv[2] || ''
const tagName = process.env.GITHUB_REF_NAME || process.argv[3] || ''
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const repo = process.env.GITHUB_REPOSITORY || 'KailaHQ/KailaEdit'

if (!token) {
  console.log('[clean-release-assets] No GH_TOKEN provided; skipping asset cleanup.')
  process.exit(0)
}

if (!tagName || !targetPlatform) {
  console.log('[clean-release-assets] Missing tagName or targetPlatform; skipping asset cleanup.')
  process.exit(0)
}

function shouldDeleteAsset(name, platform) {
  const lower = name.toLowerCase()
  if (platform.includes('macos')) {
    return lower === 'latest-mac.yml' || lower === 'latest-mac.json' || lower.includes('-mac-')
  }
  if (platform.includes('windows')) {
    return lower === 'latest.yml' || lower.includes('-win-')
  }
  if (platform.includes('linux-x64')) {
    return lower === 'latest-linux.yml' || (lower.includes('-linux-') && lower.includes('x64'))
  }
  if (platform.includes('linux-arm64')) {
    return lower === 'latest-linux-arm64.yml' || (lower.includes('-linux-') && lower.includes('arm64'))
  }
  return false
}

async function githubRequest(url, method = 'GET') {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'komfyedit-release-cleaner',
    },
  })
  if (method === 'DELETE') {
    return res.ok
  }
  if (!res.ok) {
    if (res.status === 404) return null
    const text = await res.text()
    throw new Error(`GitHub API ${method} ${url} failed (${res.status}): ${text}`)
  }
  return await res.json()
}

async function run() {
  console.log(`[clean-release-assets] Checking release for tag "${tagName}" and platform "${targetPlatform}"...`)

  // 1. Find the release object (including drafts)
  const releases = await githubRequest(`https://api.github.com/repos/${repo}/releases?per_page=100`)
  if (!releases || !Array.isArray(releases)) {
    console.log('[clean-release-assets] No releases found in repository.')
    return
  }

  const release = releases.find(r => r.tag_name === tagName)
  if (!release) {
    console.log(`[clean-release-assets] No release found matching tag "${tagName}". Clean slate.`)
    return
  }

  console.log(`[clean-release-assets] Found release ID ${release.id} (draft: ${release.draft}). Paginating assets...`)

  // 2. Fetch all assets with pagination
  let page = 1
  const allAssets = []
  while (true) {
    const assets = await githubRequest(
      `https://api.github.com/repos/${repo}/releases/${release.id}/assets?per_page=100&page=${page}`
    )
    if (!assets || assets.length === 0) break
    allAssets.push(...assets)
    if (assets.length < 100) break
    page++
  }

  console.log(`[clean-release-assets] Total assets found on release: ${allAssets.length}`)

  // 3. Filter and delete assets matching the current platform
  const toDelete = allAssets.filter(a => shouldDeleteAsset(a.name, targetPlatform))
  if (toDelete.length === 0) {
    console.log('[clean-release-assets] No conflicting assets found for this platform.')
    return
  }

  for (const asset of toDelete) {
    console.log(`[clean-release-assets] Deleting stale asset: ${asset.name} (ID: ${asset.id})...`)
    await githubRequest(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, 'DELETE')
    console.log(`[clean-release-assets] Successfully deleted ${asset.name}.`)
  }

  console.log(`[clean-release-assets] Cleaned ${toDelete.length} assets. Ready for electron-builder.`)
}

run().catch(err => {
  console.error('[clean-release-assets] Warning: Failed to clean release assets:', err.message)
  // Do not fail the build if cleanup encounters an error; allow electron-builder to attempt upload
})
