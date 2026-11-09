/**
 * 归档与子进程安全的回归测试。
 *
 * 覆盖两类此前的静默失败：
 * - archive_compress 在两个源目录含同名文件时，后者覆盖前者且 fileCount 谎报 1；
 * - python 子进程继承宿主全部环境变量，包括 API key / token / 密码。
 */
import { describe, expect, it } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import { unzipSync } from 'fflate';
import { compressArchive } from '../src/archive-service.js';
import { scrubSecretEnv } from '../src/python-runner.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'archive-test-'));

describe('archive_compress 同名条目', () => {
  it('两个不同目录下的同名单文件 → 报错而非静默覆盖', async () => {
    const dir = await tmp();
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    await fs.mkdir(a, { recursive: true });
    await fs.mkdir(b, { recursive: true });
    await fs.writeFile(path.join(a, 'x.txt'), 'from-a');
    await fs.writeFile(path.join(b, 'x.txt'), 'from-b');

    const r = await compressArchive({
      paths: [path.join(a, 'x.txt'), path.join(b, 'x.txt')],
      outputPath: path.join(dir, 'out.zip'),
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('重名');
    expect(r.error).toContain('x.txt');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('两个同名目录 → 报错而非静默覆盖', async () => {
    const dir = await tmp();
    for (const p of ['a/docs', 'b/docs']) {
      await fs.mkdir(path.join(dir, p), { recursive: true });
      await fs.writeFile(path.join(dir, p, 'x.txt'), p);
    }
    const r = await compressArchive({
      paths: [path.join(dir, 'a/docs'), path.join(dir, 'b/docs')],
      outputPath: path.join(dir, 'out.zip'),
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('重名');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('同一文件重复传入视为幂等去重，不报错', async () => {
    const dir = await tmp();
    const f = path.join(dir, 'x.txt');
    await fs.writeFile(f, 'once');
    const out = path.join(dir, 'out.zip');
    const r = await compressArchive({ paths: [f, f], outputPath: out });
    expect(r.success).toBe(true);
    expect(r.fileCount).toBe(1);
    const z = unzipSync(new Uint8Array(await fs.readFile(out)));
    expect(new TextDecoder().decode(z['x.txt'])).toBe('once');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('不同目录下的同名文件各自保留相对路径（不丢文件）', async () => {
    const dir = await tmp();
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    await fs.mkdir(a, { recursive: true });
    await fs.mkdir(b, { recursive: true });
    await fs.writeFile(path.join(a, 'x.txt'), 'from-a');
    await fs.writeFile(path.join(b, 'x.txt'), 'from-b');
    const out = path.join(dir, 'out.zip');
    const r = await compressArchive({ paths: [a, b], outputPath: out });
    expect(r.success).toBe(true);
    expect(r.fileCount).toBe(2);
    const z = unzipSync(new Uint8Array(await fs.readFile(out)));
    const names = Object.keys(z).sort();
    expect(names).toEqual(['a/x.txt', 'b/x.txt']);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('python 子进程环境清洗', () => {
  it('剔除常见凭据变量，保留普通变量', () => {
    const out = scrubSecretEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      LANG: 'en_US.UTF-8',
      HTTP_PROXY: 'http://proxy:8080',
      OPENAI_API_KEY: 'sk-xxx',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      GITHUB_TOKEN: 'ghp_xxx',
      NPM_TOKEN: 'npm_xxx',
      DATABASE_PASSWORD: 'p@ss',
      MY_PRIVATE_KEY: 'key',
      PROBE_SECRET_TOKEN: 'leak',
      MYSQL_PWD: 'mysql-pwd',
      // 复数 / 缩写 / 无下划线 / KEY 结尾等变体
      GITHUB_SECRETS: 'plural',
      DB_PASS: 'abbr',
      ACCESSKEY: 'glued',
      APIKEY: 'glued2',
      ENCRYPTION_KEY: 'key-suffix',
      AWS_SESSION_TOKEN: 'session',
    });
    expect(Object.keys(out).sort()).toEqual(
      ['HOME', 'HTTP_PROXY', 'LANG', 'PATH'].sort(),
    );
  });

  it('剔除内嵌 user:pass 的 DSN，但不误删无凭据的公开 URL', () => {
    const out = scrubSecretEnv({
      DATABASE_URL: 'postgres://user:pass@db.internal:5432/app',
      REDIS_URL: 'redis://:s3cret@cache:6379',
      MONGODB_URI: 'mongodb+srv://u:p@cluster/db',
      PUPPETEER_DOWNLOAD_BASE_URL: 'https://registry.npmmirror.com/-/binary',
      METADATA_URL: 'http://169.254.169.254/latest/meta-data',
      PWD: '/home/u/work',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
    });
    expect(Object.keys(out).sort()).toEqual(
      ['METADATA_URL', 'PUPPETEER_DOWNLOAD_BASE_URL', 'PWD', 'SSH_AUTH_SOCK'].sort(),
    );
  });
});
