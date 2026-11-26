import { describe, expect, it } from 'vitest';
import { currentAnchor, parseDiff, parsePullKey, pullKey, queueItems, selectLine, type QueueItem, type QueuePage, type ReviewComment } from '@/lib/code-review/model';

const patch = '@@ -3,2 +7,3 @@\n before\n-old\n+new\n+last\n@@ -40 +42 @@\n another';
const item = (number: number, group: QueueItem['group']): QueueItem => ({
  owner: 'Demo', repo: 'Project', number, title: 'Fixture ' + number, group, draft: false,
  author: 'nara-demo', updatedAt: '2026-01-01T00:00:00Z',
});
const page = (items: QueueItem[], nextPage: number | null): QueuePage => ({
  items, nextPage, stale: false, groupErrors: [], teamCount: 1, teamScopeLimited: false,
});

describe('Code Review', () => {
  it('normalizes stable deep links and rejects malformed repository keys', () => {
    expect(pullKey(parsePullKey('Demo/Project/17')!)).toBe('demo/project/17');
    for (const key of ['demo/../17', 'demo/project/-1', 'demo/project/9007199254740993', 'https://host/demo/project/17']) {
      expect(parsePullKey(key)).toBeNull();
    }
  });

  it('deduplicates pull requests across paginated groups', () => {
    const loaded = queueItems([
      page([item(1, 'requested'), item(2, 'requested')], 2),
      page([item(1, 'team'), item(3, 'team'), item(3, 'mine')], null),
    ]);
    expect(loaded.map(({ number, group }) => [number, group])).toEqual([[1, 'team'], [2, 'requested'], [3, 'mine']]);
  });

  it('counts each side and keeps selection contiguous within available hunks', () => {
    const rows = parseDiff(patch);
    expect(rows.slice(1, 4).map(row => [row.kind, row.old, row.new])).toEqual([
      ['context', 3, 7], ['removed', 4, undefined], ['added', undefined, 8],
    ]);
    const first = selectLine(rows, null, 'right', 8, false);
    expect(selectLine(rows, first, 'right', 9, true)).toEqual({ side: 'right', start: 8, end: 9 });
    expect(selectLine(rows, first, 'right', 42, true)).toEqual({ side: 'right', start: 42, end: 42 });
    expect(selectLine(rows, first, 'left', 4, true)).toEqual({ side: 'left', start: 4, end: 4 });
  });

  it('only attaches comments to the file and diff revision they refer to', () => {
    const comment: ReviewComment = { id: 1, login: 'demo', body: 'fixture', path: 'src/a.ts',
      side: 'right', line: 8, revision: 'head-new', originalRevision: 'head-new', createdAt: '2026-01-01' };
    expect(currentAnchor(comment, 'src/a.ts', 'head-new')).toBe(true);
    expect(currentAnchor(comment, 'src/b.ts', 'head-new')).toBe(false);
    expect(currentAnchor({ ...comment, originalRevision: 'head-old' }, 'src/a.ts', 'head-new')).toBe(false);
    expect(currentAnchor({ ...comment, line: null }, 'src/a.ts', 'head-new')).toBe(false);
  });
});
