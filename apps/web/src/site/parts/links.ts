/** The public repository and the testnet explorer, for "read the source" links on the site pages. */

export const REPO_URL = 'https://github.com/OoJae/baserate'

/** A file in the repository on GitHub (main branch). */
export function repoFile(path: string): string {
  return `${REPO_URL}/blob/main/${path}`
}

/** A folder in the repository on GitHub (main branch). */
export function repoDir(path: string): string {
  return `${REPO_URL}/tree/main/${path}`
}

/** Short display form of a repository path: its last two segments ("audit/FINDINGS.md"). */
export function shortPath(path: string): string {
  return path.split('/').filter(Boolean).slice(-2).join('/')
}
