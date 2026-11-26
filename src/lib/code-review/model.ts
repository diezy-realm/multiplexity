export type ScmProvider = 'ghes' | 'bitbucket';
export const SCM_LABELS = { ghes: 'GitHub Enterprise', bitbucket: 'Bitbucket Data Center' } as const;
export type PullRef = { owner: string; repo: string; number: number };
export type QueueGroup = 'mine' | 'requested' | 'team';
export type QueueItem = PullRef & { title: string; author: string; group: QueueGroup; updatedAt: string; draft: boolean };
export type Pull = PullRef & {
  title: string; description: string; descriptionTruncated: boolean; author: string;
  status: 'open' | 'closed' | 'merged' | 'draft'; headSha: string; baseSha: string;
  headBranch: string; baseBranch: string; updatedAt: string; createdAt: string; closedAt: string;
  mergedAt: string; changedFiles: number | null; fetchedAt: string; profileId: string; remoteUrl: string | null;
  requestedReviewers: string[]; requestedTeams: string[];
};
export type FileChange = {
  path: string; previousPath: string | null; status: string; additions: number; deletions: number;
  patch: string | null; patchStatus: 'available' | 'truncated' | 'binary' | 'unavailable' | 'not_loaded'; page: number; comparisonBase?: string | null;
};
export type Reviewer = { id: number; login: string; state: string; body: string; submittedAt: string; revision: string };
export type DiffSide = 'left' | 'right';
export type ReviewComment = {
  id: number; login: string; body: string; path: string; side: DiffSide | null;
  line: number | null; startLine?: number | null; startSide?: DiffSide | null;
  revision: string; originalRevision: string; createdAt: string; comparisonBase?: string | null;
};
export type Check = {
  id: number; key?: string | null; name: string; status: 'success' | 'failure' | 'pending' | 'neutral' | 'unavailable';
  detail: string; revision: string; source: 'run' | 'status';
};
export type ReviewActivity = { id: number; label: string; login: string; createdAt: string };
export type Page<T> = { items: T[]; nextPage: number | null; stale: boolean; partial?: boolean };
export type QueuePage = Page<QueueItem> & {
  groupErrors: { group: QueueGroup; message: string }[];
  teamCount: number; teamScopeLimited: boolean;
};
export type ProfileData = {
  profile: { id: string; label: string; origin: string; version: string; status: string } | null;
  configurationError: string | null; desktopOpen: boolean;
};
export type PullData = { pull: Pull; stale: boolean; cachedAt?: number };
export type LineRange = { side: DiffSide; start: number; end: number };
export type ReviewContext = LineRange & {
  reference: PullRef; headSha: string; baseSha: string; path: string; page: number; fixture: boolean; profileId: string; provider: ScmProvider; comparisonBase?: string | null;
};
export type Preview = {
  id: string; destination: { provider: string; model: string; endpoint: string | null };
  payload: string; source: Omit<ReviewContext, 'fixture'> & { fetchedAt: string };
};

export const integrationsUrl = (provider: ScmProvider) => '/settings?section=integrations&connector=' + provider;
export const GROUP_LABELS = { mine: 'PR Saya', requested: 'Perlu Review Saya', team: 'Review Tim' };

export function pullKey({ owner, repo, number }: PullRef) {
  return [owner.toLowerCase(), repo.toLowerCase(), number].join('/');
}

export function parsePullKey(value: string | null): PullRef | null {
  const parts = value?.match(/^(~?[a-z\d_.-]{1,100})\/([a-z\d_.-]{1,100})\/([1-9]\d*)$/i);
  if (!parts) return null;
  const [, owner, repo, input] = parts;
  const number = Number(input);
  return Number.isSafeInteger(number) && !['.', '..'].includes(owner.replace(/^~/, '')) && !['.', '..'].includes(repo)
    ? { owner, repo, number } : null;
}

export function pullEndpoint(reference: PullRef) {
  return '/api/scm/pulls/' + pullKey(reference);
}

export function pullQuery(fixture: boolean, pull?: Pull, provider: ScmProvider = 'ghes') {
  const params = new URLSearchParams({ fixture: String(fixture), provider });
  if (pull) {
    params.set('head', pull.headSha);
    params.set('base', pull.baseSha);
  }
  return '?' + params.toString();
}

export function queueItems(pages: QueuePage[]) {
  const items = new Map<string, QueueItem>();
  const priority = { mine: 0, team: 1, requested: 2 };
  for (const page of pages) {
    for (const item of page.items) {
      const key = pullKey(item);
      const previous = items.get(key);
      if (!previous || priority[item.group] < priority[previous.group]) items.set(key, item);
    }
  }
  return [...items.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type DiffRow = { kind: 'hunk' | 'context' | 'added' | 'removed'; old?: number; new?: number; text: string };

export function parseDiff(patch: string): DiffRow[] {
  let old = 0, next = 0, remainingOld = 0, remainingNew = 0;
  const rows: DiffRow[] = [];
  for (const text of patch.split(/\r?\n/)) {
    if (text.startsWith('@@ ')) {
      const header = text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      [old, remainingOld, next, remainingNew] = header
        ? [Number(header[1]), Number(header[2] ?? 1), Number(header[3]), Number(header[4] ?? 1)]
        : [0, 0, 0, 0];
      rows.push({ kind: 'hunk', text });
      continue;
    }
    const marker = text[0];
    const readOld = marker === ' ' || marker === '-';
    const readNew = marker === ' ' || marker === '+';
    if ((!readOld && !readNew) || (readOld && !remainingOld) || (readNew && !remainingNew)) continue;
    rows.push({ kind: marker === '+' ? 'added' : marker === '-' ? 'removed' : 'context',
      old: readOld ? old++ : undefined, new: readNew ? next++ : undefined, text });
    if (readOld) remainingOld--;
    if (readNew) remainingNew--;
  }
  return rows;
}

export function lineOn(row: DiffRow, side: DiffSide) {
  return side === 'left' ? row.old : row.new;
}

export function selectLine(rows: DiffRow[], current: LineRange | null, side: DiffSide, line: number, extend: boolean): LineRange {
  if (extend && current?.side === side) {
    const start = Math.min(current.start, line);
    const end = Math.max(current.start, line);
    if (end - start < 40 && rows.filter(row => {
      const value = lineOn(row, side);
      return value !== undefined && value >= start && value <= end;
    }).length === end - start + 1) {
      return { side, start, end };
    }
  }
  return { side, start: line, end: line };
}

export function currentAnchor(comment: ReviewComment, path: string, head: string, comparisonBase?: string | null) {
  return comment.path === path && comment.revision === head &&
    (!comment.comparisonBase || comment.comparisonBase === comparisonBase) &&
    (!comment.originalRevision || comment.originalRevision === head) &&
    comment.side !== null && comment.line !== null;
}

export function showDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Waktu tidak tersedia' : date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export async function reviewJson<T>(url: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    signal,
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Permintaan gagal.');
  return data as T;
}
