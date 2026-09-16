'use strict'

/**
 * Puts the composed release body onto the GitHub Release for the current tag.
 *
 * Not `gh release edit`: releases here are created as drafts by default, and
 * the tag lookup `gh` reaches for (`/releases/tags/{tag}`) does not return
 * drafts — the note would land on nothing, or fail, exactly on the releases
 * that need it most. Listing releases and matching `tag_name` sees drafts,
 * which is the same route scripts/clean-platform-release-assets.cjs already
 * takes for the same reason.
 */

const { execFileSync } = require('child_process')
const path = require('path')

const tagName = process.env.GITHUB_REF_NAME || process.argv[2] || ''
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const repo = process.env.GITHUB_REPOSITORY || 'KailaHQ/KailaEdit'

async function githubRequest(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'komfyedit-release-notes',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${url} failed (${res.status}): ${await res.text()}`)
  }
  return res.json()
}

async function run() {
  if (!token) throw new Error('[release-notes] No GH_TOKEN; cannot reach the Releases API')
  if (!tagName) throw new Error('[release-notes] No tag name; expected GITHUB_REF_NAME')

  const version = tagName.replace(/^v/, '')
  // Reuse the one composer, so what CI publishes is byte for byte what
  // `pnpm run release:notes <version>` prints on your machine.
  const body = execFileSync(
    process.execPath,
    [path.join(__dirname, 'release-notes.cjs'), version],
    { encoding: 'utf8' },
  )

  const releases = await githubRequest(`https://api.github.com/repos/${repo}/releases?per_page=100`)
  const release = Array.isArray(releases) ? releases.find(entry => entry.tag_name === tagName) : null
  if (!release) {
    throw new Error(
      `[release-notes] No release found for tag ${tagName}. `
      + 'The build job creates it, so this running before the upload finished is the likely cause.',
    )
  }

  await githubRequest(`https://api.github.com/repos/${repo}/releases/${release.id}`, 'PATCH', { body })
  console.log(
    `[release-notes] Wrote the ${version} notes onto release ${release.id} (draft: ${release.draft}).`,
  )
}

run().catch(error => {
  console.error(String(error.message || error))
  process.exit(1)
})
