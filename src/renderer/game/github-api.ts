export interface FileResult {
  data: any;
  sha: string;
}

export interface WriteResult {
  sha: string;
}

export class GitHubAPI {
  private token: string;
  private repo: string;
  private baseUrl: string;

  constructor(token: string, repo: string) {
    this.token = token;
    this.repo = repo;
    this.baseUrl = `https://api.github.com/repos/${repo}/contents`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  async readFile(path: string): Promise<FileResult | null> {
    const res = await fetch(`${this.baseUrl}/${path}`, { headers: this.headers() });
    if (!res.ok) return null;
    const json = await res.json();
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(json.content), c => c.charCodeAt(0)));
    const content = JSON.parse(decoded);
    return { data: content, sha: json.sha };
  }

  async writeFile(
    path: string,
    data: any,
    message: string,
    sha?: string,
  ): Promise<WriteResult | null> {
    const body: any = {
      message,
      content: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(data, null, 2)))),
    };
    if (sha) body.sha = sha;

    const res = await fetch(`${this.baseUrl}/${path}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return { sha: json.content.sha };
  }

  async deleteFile(path: string, sha: string, message: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/${path}`, {
      method: 'DELETE',
      headers: this.headers(),
      body: JSON.stringify({ message, sha }),
    });
    return res.ok;
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/${dirPath}`, { headers: this.headers() });
    if (!res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json)) return [];
    return json.filter((f: any) => f.type === 'file').map((f: any) => f.name);
  }
}
