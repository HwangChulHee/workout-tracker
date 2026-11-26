const repositoryUrl = 'https://api.github.com/repos/HwangChulHee/workout-data'
export const tokenStorageKey = 'workout-tracker-github-token'

export class GitHubError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'permission' | 'rate' | 'network' | 'sha' | 'format', readonly retryAt?: number) {
    super(message)
  }
}

export function bucketPath(path: string) {
  return /^workouts\/\d{4}-(0[1-9]|1[0-2])\.json$/.test(path) || /^body\/\d{4}\.json$/.test(path)
}

function encode(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}

export interface RemoteFile { sha: string; text: string }
export interface RemoteStorage {
  list(): Promise<string[]>
  read(path: string): Promise<RemoteFile | null>
  write(path: string, text: string, sha?: string): Promise<void>
}

export class GitHubStorage implements RemoteStorage {
  private branch = ''

  constructor(private readonly token: string, private readonly fetcher = fetch, private readonly signal?: AbortSignal) {}

  private async request(path: string, options?: { method?: 'PUT'; body?: string; allowMissing?: boolean }) {
    this.signal?.throwIfAborted()
    let response: Response
    const deadline = AbortSignal.timeout(15000)
    const fetcher = this.fetcher
    try {
      response = await fetcher(repositoryUrl + path, {
        method: options?.method ?? 'GET', body: options?.body,
        headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + this.token,
          'X-GitHub-Api-Version': '2022-11-28', ...(options?.body ? { 'Content-Type': 'application/json' } : {}) },
        signal: this.signal ? AbortSignal.any([this.signal, deadline]) : deadline,
        cache: 'no-store', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
      })
    } catch {
      this.signal?.throwIfAborted()
      throw new GitHubError('GitHub에 연결할 수 없어요. 연결이 돌아오면 다시 시도해요.', 'network')
    }
    if (response.ok) return response
    if (response.status === 404 && options?.allowMissing) return null
    const retry = response.headers.get('retry-after')
    const rateMessage = response.status === 403 ? await response.json().then(
      (body: unknown) => typeof body === 'object' && body !== null && 'message' in body
        && typeof body.message === 'string' && /rate limit/i.test(body.message),
      () => false,
    ) : false
    const limited = response.status === 429 || (response.status === 403
      && (response.headers.get('x-ratelimit-remaining') === '0' || retry !== null || rateMessage))
    if (limited) {
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
      const seconds = retry === null ? NaN : Number(retry)
      const until = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Math.max(Date.now() + 60000, reset || 0)
      throw new GitHubError('GitHub 요청 한도에 도달했어요. 잠시 뒤 다시 시도해요.', 'rate', until)
    }
    if (response.status === 401) throw new GitHubError('PAT가 만료되었거나 유효하지 않아요. 새 토큰으로 다시 연결해 주세요.', 'auth')
    if (response.status === 403 || response.status === 404) {
      throw new GitHubError('비공개 workout-data 접근 권한을 확인해 주세요. 저장에는 Contents 쓰기 권한이 필요해요.', 'permission')
    }
    if (options?.method === 'PUT' && [409, 422].includes(response.status)) {
      throw new GitHubError('원격 버전이 바뀌었거나 GitHub가 쓰기를 거부했어요.', 'sha')
    }
    if (response.status >= 500) throw new GitHubError('GitHub가 일시적으로 응답하지 않아요. 다시 확인할게요.', 'network')
    throw new GitHubError('GitHub 파일을 처리할 수 없어요.', 'format')
  }

  async connect() {
    const response = await this.request('')
    const metadata = await response?.json()
    if (metadata?.private !== true || typeof metadata.default_branch !== 'string' || !metadata.default_branch) {
      throw new GitHubError('대상 저장소를 비공개 저장소로 확인하지 못했어요.', 'permission')
    }
    this.branch = metadata.default_branch
    // Read a directory to verify Contents permission, independent of repository metadata access.
    await this.request('/contents?ref=' + encodeURIComponent(this.branch))
  }

  async list() {
    const paths: string[] = []
    for (const directory of ['workouts', 'body']) {
      const response = await this.request('/contents/' + directory + '?ref=' + encodeURIComponent(this.branch), { allowMissing: true })
      if (!response) continue
      const rows: unknown = await response.json()
      if (!Array.isArray(rows) || rows.length >= 1000) throw new GitHubError('원격 파일 목록을 안전하게 읽을 수 없어요.', 'format')
      for (const item of rows) {
        if (item?.type === 'file' && typeof item.path === 'string' && bucketPath(item.path)) paths.push(item.path)
      }
    }
    return paths
  }

  async read(path: string) {
    if (!bucketPath(path)) throw new GitHubError('지원하지 않는 원격 경로예요.', 'format')
    const response = await this.request('/contents/' + path + '?ref=' + encodeURIComponent(this.branch), { allowMissing: true })
    if (!response) return null
    const file = await response.json()
    if (file?.type !== 'file' || typeof file.sha !== 'string' || file.encoding !== 'base64' || typeof file.content !== 'string') {
      throw new GitHubError('GitHub에서 JSON 파일의 본문과 SHA를 읽을 수 없어요.', 'format')
    }
    try {
      const bytes = Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0))
      return { sha: file.sha as string, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    } catch {
      throw new GitHubError('원격 파일이 올바른 UTF-8 JSON이 아니에요.', 'format')
    }
  }

  async write(path: string, text: string, sha?: string) {
    if (!bucketPath(path) || !this.branch) throw new GitHubError('연결된 원격 경로를 확인해 주세요.', 'format')
    await this.request('/contents/' + path, { method: 'PUT', body: JSON.stringify({
      message: 'Update workout tracker data', branch: this.branch, content: encode(text), ...(sha ? { sha } : {}),
    }) })
  }
}
