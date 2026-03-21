import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAPI } from '../src/renderer/game/github-api';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

let api: GitHubAPI;

beforeEach(() => {
  mockFetch.mockReset();
  api = new GitHubAPI('test-token', 'owner/repo');
});

describe('readFile', () => {
  it('returns parsed JSON content when file exists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: btoa(JSON.stringify({ hello: 'world' })),
        sha: 'abc123',
      }),
    });
    const result = await api.readFile('test.json');
    expect(result).toEqual({ data: { hello: 'world' }, sha: 'abc123' });
  });

  it('returns null when file does not exist (404)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await api.readFile('missing.json');
    expect(result).toBeNull();
  });
});

describe('writeFile', () => {
  it('creates a new file when no sha provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: { sha: 'new-sha' } }),
    });
    const result = await api.writeFile('new.json', { data: true }, 'create file');
    expect(result).toEqual({ sha: 'new-sha' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/contents/new.json'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('updates a file when sha provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: { sha: 'updated-sha' } }),
    });
    const result = await api.writeFile('existing.json', { data: true }, 'update file', 'old-sha');
    expect(result).toEqual({ sha: 'updated-sha' });
  });

  it('returns null on conflict (409)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 409 });
    const result = await api.writeFile('conflict.json', { data: true }, 'update', 'stale-sha');
    expect(result).toBeNull();
  });
});

describe('deleteFile', () => {
  it('deletes a file with sha', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await api.deleteFile('old.json', 'abc123', 'cleanup');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/contents/old.json'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('listFiles', () => {
  it('returns array of filenames in a directory', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { name: 'ABCDEF.json', type: 'file' },
        { name: 'GHIJKL.json', type: 'file' },
      ],
    });
    const result = await api.listFiles('games');
    expect(result).toEqual(['ABCDEF.json', 'GHIJKL.json']);
  });

  it('returns empty array for missing directory', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await api.listFiles('nonexistent');
    expect(result).toEqual([]);
  });
});
