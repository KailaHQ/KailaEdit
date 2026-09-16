'use strict'

/**
 * Pre-build release initialization script for GitHub Releases.
 *
 * Runs once in the verify job before the parallel build matrix starts.
 * This guarantees a single GitHub Release (draft or published) exists
 * with the correct tag before electron-builder runs on any runner.
 *
 * Without this upfront creation, multiple matrix jobs running concurrently
 * (windows-x64, macos, linux-x64, linux-arm64) race to create the release,
 * resulting in duplicate draft releases and split/orphaned assets.
 */

const { execSync } = require('child_process')

const tagName = process.env.GITHUB_REF_NAME || process.argv[2] || ''
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const repo = process.env.GITHUB_REPOSITORY || 'KailaHQ/KailaEdit'

if (!token) {
  console.error('[init-release] No GH_TOKEN provided; cannot initialize release.')
  process.exit(1)
}

if (!tagName) {
  console.error('[init-release] Missing GITHUB_REF_NAME; cannot initialize release.')
  process.exit(1)
}

async function githubRequest(url, method = 'GET', body = null) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'komfyedit-release-init',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API ${method} ${url} failed (${res.status}): ${text}`)
  }
  return res.json()
}

function isLiveRelease(tag) {
  try {
    const message = execSync(`git tag -l --format="%(contents)" "${tag}"`, { encoding: 'utf8' })
    return message.includes('[live]')
  } catch {
    return false
  }
}

async function run() {
  console.log(`[init-release] Checking release for tag "${tagName}" in ${repo}...`)

  // 1. Check if release already exists (including drafts)
  const releases = await githubRequest(`https://api.github.com/repos/${repo}/releases?per_page=100`)
  const existing = Array.isArray(releases) ? releases.find(r => r.tag_name === tagName) : null

  if (existing) {
    console.log(
      `[init-release] Release already exists for tag "${tagName}" (ID: ${existing.id}, draft: ${existing.draft}).`,
    )
    return
  }

  // 2. Determine if draft or live
  const isLive = isLiveRelease(tagName)
  const draft = !isLive
  const version = tagName.replace(/^v/, '')

  console.log(
    `[init-release] Creating initial release for tag "${tagName}" (version: ${version}, draft: ${draft})...`,
  )

  const created = await githubRequest(`https://api.github.com/repos/${repo}/releases`, 'POST', {
    tag_name: tagName,
    name: version,
    draft,
    prerelease: false,
  })

  console.log(`[init-release] Successfully created release ID ${created.id} (draft: ${created.draft}).`)
}

run().catch(err => {
  console.error('[init-release] Error:', err.message)
  process.exit(1)
})
