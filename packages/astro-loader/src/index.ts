import { glob, type Loader, type LoaderContext } from 'astro/loaders';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globby } from 'globby';
import { parseFrontmatter, type FrontmatterResult } from 'xmdx-napi';

export interface XmdxLoaderOptions {
  /** Directory (relative to project root) that contains the target content collection. */
  dir: string;
  /** Glob pattern(s) that determine which files should be processed. */
  pattern?: string | string[];
  /** Throw when Xmdx reports frontmatter errors (default: log and continue). */
  throwOnFrontmatterError?: boolean;
}

export function xmdxLoader({
  dir,
  pattern = '**/*.{md,mdx}',
  throwOnFrontmatterError = false,
}: XmdxLoaderOptions): Loader {
  const fallbackLoader = glob({
    base: dir,
    pattern,
  });

  return {
    name: 'xmdx-loader',
    load: async (context) => {
      const { store, logger, meta, config, collection } = context;
      const rootDir = fileURLToPath(config.root);
      const contentDir = path.resolve(rootDir, dir);
      const digestMetaKey = createDigestMetaKey(collection);

      logger.info?.(`Loading Xmdx content from ${dir}`);

      // Always seed the datastore using Astro's default glob loader so non-Xmdx
      // entries continue to behave exactly like the baseline implementation.
      await fallbackLoader.load(context);

      const existingEntries = buildEntryLookup(store.entries());
      const files = await globby(pattern, { cwd: contentDir });
      const previousDigests = readDigestMeta(meta.get(digestMetaKey));
      const nextDigests = new Map<string, string>();

      await Promise.all(
        files.map(async (relativePath) => {
          const absolutePath = path.join(contentDir, relativePath);
          const filePathFromRoot = toPosixPath(path.relative(rootDir, absolutePath));
          const fallbackEntry = existingEntries.get(filePathFromRoot);
          if (!fallbackEntry) {
            logger.warn?.(`No fallback entry for ${relativePath}; leaving default loader output.`);
            return;
          }

          const { id, entry } = fallbackEntry;

          try {
            let body = typeof entry.body === 'string' ? entry.body : undefined;
            if (!body) {
              body = await readFile(absolutePath, 'utf8');
            }

            let digestValue = entry.digest;
            if (typeof digestValue !== 'string' && typeof digestValue !== 'number') {
              digestValue = context.generateDigest(body);
            }
            const digest = String(digestValue);

            const previousDigest = previousDigests.get(id);
            const digestMatchesPrevious = previousDigest === digest;
            if (digestMatchesPrevious) {
              nextDigests.set(id, digest);
              return;
            }

            const synced = await syncFile(context, {
              id,
              absolutePath,
              body,
              digest,
              throwOnFrontmatterError,
              existingEntry: entry,
            });

            if (!synced) {
              return;
            }

            nextDigests.set(id, digest);
          } catch (error) {
            logger.error?.(`Failed to load ${relativePath}: ${(error as Error).message}`);
          }
        }),
      );

      meta.set(digestMetaKey, JSON.stringify(Object.fromEntries(nextDigests)));
    },
  };
}

async function syncFile(
  { parseData, store, logger }: LoaderContext,
  {
    id,
    absolutePath,
    body,
    digest,
    throwOnFrontmatterError,
    existingEntry,
  }: {
    id: string;
    absolutePath: string;
    body: string;
    digest: string;
    throwOnFrontmatterError: boolean;
    existingEntry: StoreEntry;
  },
): Promise<boolean> {
  const result = parseFrontmatter(body) as FrontmatterResult;
  const errors = getFrontmatterErrors(result);
  if (errors.length > 0) {
    const message = `Xmdx parsing errors in ${absolutePath}: ${errors.join(', ')}`;
    logger.error?.(message);
    if (throwOnFrontmatterError) {
      throw new Error(message);
    }
    return false;
  }

  const data = await parseData({ id, data: result.frontmatter, filePath: absolutePath });
  store.set({
    ...existingEntry,
    id,
    data,
    body,
    digest,
  });

  return true;
}

type StoreEntry = NonNullable<ReturnType<LoaderContext['store']['get']>>;

function buildEntryLookup(entries: Array<[string, StoreEntry]>): Map<string, { id: string; entry: StoreEntry }> {
  const map = new Map<string, { id: string; entry: StoreEntry }>();
  for (const [entryId, entry] of entries) {
    if (!entry?.filePath) continue;
    map.set(toPosixPath(entry.filePath), { id: entryId, entry });
  }
  return map;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function createDigestMetaKey(collection: string): string {
  return `xmdx:${collection}:digests`;
}

function readDigestMeta(rawValue?: string): Map<string, string> {
  if (!rawValue) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function getFrontmatterErrors(result: FrontmatterResult): string[] {
  return Array.isArray(result.errors) ? result.errors : [];
}
