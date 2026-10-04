import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const NASA_RAW_FEED =
  'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&ver=1.2';
export const NASA_WAYPOINTS_URL = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';
export const NASA_CREDIT = 'NASA/JPL-Caltech';
export const LIVE_SCENE_ID = 'current';
export const LIVE_DIR = path.join(process.cwd(), 'data/live');
export const FALLBACK_DIR = path.join(LIVE_DIR, 'fallback');

const NASA_UA = 'MarsLatencyMediation/1.0 (hackathon; Perseverance live-scene ingest)';
const FEED_TIMEOUT_MS = 30_000;
const IMAGE_TIMEOUT_MS = 120_000;
const PAGE_SIZE = 50;
const MAX_PAGES = 3;
const LOOKBACK_SOLS = 6;

const NAVCAM = new Set(['NAVCAM_LEFT', 'NAVCAM_RIGHT']);
const FRONT_HAZCAM = new Set([
  'FRONT_HAZCAM_LEFT_A',
  'FRONT_HAZCAM_LEFT_B',
  'FRONT_HAZCAM_RIGHT_A',
  'FRONT_HAZCAM_RIGHT_B',
]);
const DRIVING_SEARCH = `|${[...NAVCAM, ...FRONT_HAZCAM].join('|')}`;

export interface NasaRawImage {
  imageid?: string;
  sol?: number;
  sample_type?: string;
  date_taken_utc?: string;
  date_taken_mars?: string;
  credit?: string;
  link?: string;
  camera?: { instrument?: string };
  image_files?: {
    small?: string;
    medium?: string;
    large?: string;
    full_res?: string;
  };
  extended?: { subframeRect?: string; dimension?: string; scaleFactor?: string };
}

export interface NasaWaypoint {
  sol: number;
  lat: number;
  lon: number;
}

export interface LiveSceneRecord {
  id: string;
  imageId: string;
  sol: number;
  camera: string;
  utcDateTaken: string;
  localMeanSolarTime: string;
  daysAgo: number;
  filePath: string;
  nasaUrl: string;
  credit: string;
  isFallback: boolean;
  chosenWhy: string;
  lat?: number;
  lon?: number;
  waypointSol?: number;
  ingestedAt: string;
}

export interface LiveSceneMeta {
  imageId: string;
  sol: number;
  camera: string;
  utcDateTaken: string;
  localMeanSolarTime: string;
  nasaUrl: string;
  credit: string;
  fileName: string;
  lat?: number;
  lon?: number;
  waypointSol?: number;
}

export interface IngestResult {
  record: LiveSceneRecord;
  persisted: boolean;
  persistError?: string;
}

export interface IngestOptions {
  offline?: boolean;
  now?: Date;
  fetchImpl?: typeof fetch;
  liveDir?: string;
  persist?: (row: LiveSceneRecord) => Promise<void>;
  log?: (line: string) => void;
}

interface NasaFeed {
  images?: NasaRawImage[];
  latest_sol?: number;
  latest_sols?: number[];
  total_results?: number;
}

interface NasaFeatureCollection {
  features?: { properties?: { sol?: number; lat?: number; lon?: number } }[];
}

export function parseLmstHours(dateTakenMars: string | undefined): number | null {
  if (!dateTakenMars) return null;
  const match = /M(\d{1,2}):(\d{2}):(\d{2})/.exec(dateTakenMars);
  if (!match) return null;
  const hours = Number(match[1]) + Number(match[2]) / 60 + Number(match[3]) / 3600;
  return Number.isFinite(hours) ? hours : null;
}

export function isDaylightLmst(dateTakenMars: string | undefined): boolean {
  const hours = parseLmstHours(dateTakenMars);
  return hours !== null && hours >= 6 && hours < 18;
}

export function daysAgoFromUtc(utc: string, now = new Date()): number {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(utc) ? utc : `${utc}Z`;
  const taken = Date.parse(normalized);
  if (!Number.isFinite(taken)) return 0;
  return Math.max(0, Math.round(((now.getTime() - taken) / 86_400_000) * 1000) / 1000);
}

export function cameraRank(instrument: string | undefined): number {
  if (!instrument) return 99;
  if (FRONT_HAZCAM.has(instrument) || instrument.startsWith('FRONT_HAZCAM')) return 0;
  if (NAVCAM.has(instrument)) return 1;
  return 99;
}

export function isThumbnail(image: NasaRawImage): boolean {
  return (image.sample_type ?? '').toLowerCase().includes('thumb');
}

export function isSubframe(image: NasaRawImage): boolean {
  const sample = (image.sample_type ?? '').toLowerCase();
  if (sample.includes('subframe')) return true;
  const rect = image.extended?.subframeRect;
  if (!rect) return false;
  const nums = rect.match(/\d+/g)?.map(Number);
  if (!nums || nums.length < 4) return false;
  const [x, y, width, height] = nums;
  const originOk = x <= 1 && y <= 1;
  const largeEnough = width >= 2000 && height >= 1500;
  return !originOk || !largeEnough;
}

export function isFullFrame(image: NasaRawImage): boolean {
  if (isThumbnail(image) || isSubframe(image)) return false;
  return (image.sample_type ?? '').toLowerCase() === 'full';
}

export function largestImageUrl(image: NasaRawImage): string | undefined {
  const files = image.image_files;
  if (!files) return undefined;
  return files.full_res || files.large || files.medium || files.small;
}

export function pickBestImage(images: NasaRawImage[]): { image: NasaRawImage; why: string } | null {
  const scored = images
    .map((image) => ({ image, rank: cameraRank(image.camera?.instrument) }))
    .filter(({ image, rank }) => {
      if (rank >= 99) return false;
      if (!image.imageid || !image.date_taken_utc) return false;
      if (!largestImageUrl(image)) return false;
      return isFullFrame(image) && isDaylightLmst(image.date_taken_mars);
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const sol = (b.image.sol ?? 0) - (a.image.sol ?? 0);
      if (sol !== 0) return sol;
      return (b.image.date_taken_utc ?? '').localeCompare(a.image.date_taken_utc ?? '');
    });

  const winner = scored[0];
  if (!winner) return null;

  const image = winner.image;
  const camera = image.camera?.instrument ?? 'unknown';
  const lmst = image.date_taken_mars ?? 'unknown LMST';
  const kind = winner.rank === 0 ? 'Front Hazcam' : 'Navcam';
  const why =
    `Chose ${camera} ${image.imageid} because it is a full-frame daylight ${kind} ` +
    `on sol ${image.sol ?? '?'} (${lmst}). Preference is FRONT_HAZCAM, then NAVCAM_LEFT/RIGHT; ` +
    `thumbnails and subframes were rejected.`;
  return { image, why };
}

export function latestWaypoint(features: NasaFeatureCollection['features']): NasaWaypoint | null {
  let best: NasaWaypoint | null = null;
  for (const feature of features ?? []) {
    const sol = Number(feature.properties?.sol);
    const lat = Number(feature.properties?.lat);
    const lon = Number(feature.properties?.lon);
    if (![sol, lat, lon].every(Number.isFinite)) continue;
    if (!best || sol > best.sol || sol === best.sol) {
      best = { sol, lat, lon };
    }
  }
  return best;
}

function feedUrl(params: Record<string, string | number | boolean>): string {
  const url = new URL(NASA_RAW_FEED);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.toString();
}

async function fetchJson<T>(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs = FEED_TIMEOUT_MS,
): Promise<T> {
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': NASA_UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function fetchLatestSols(fetchImpl: typeof fetch): Promise<number[]> {
  const meta = await fetchJson<NasaFeed>(feedUrl({ latest: true }), fetchImpl);
  const sols = (meta.latest_sols ?? []).filter((sol) => Number.isFinite(sol));
  if (sols.length) return [...new Set(sols)].sort((a, b) => b - a);
  if (Number.isFinite(meta.latest_sol)) return [meta.latest_sol as number];
  throw new Error('latest=true returned no sol numbers');
}

async function fetchSolImages(sol: number, fetchImpl: typeof fetch): Promise<NasaRawImage[]> {
  const images: NasaRawImage[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await fetchJson<NasaFeed>(
      feedUrl({ sol, num: PAGE_SIZE, page, search: DRIVING_SEARCH }),
      fetchImpl,
    );
    const batch = body.images ?? [];
    images.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return images;
}

async function fetchRecentDrivingImages(fetchImpl: typeof fetch, search = DRIVING_SEARCH): Promise<NasaRawImage[]> {
  const body = await fetchJson<NasaFeed>(
    feedUrl({ num: PAGE_SIZE, page: 0, order: 'sol desc', search }),
    fetchImpl,
  );
  return body.images ?? [];
}

function dedupeImages(images: NasaRawImage[]): NasaRawImage[] {
  const seen = new Set<string>();
  const out: NasaRawImage[] = [];
  for (const image of images) {
    const id = image.imageid;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(image);
  }
  return out;
}

async function collectCandidates(fetchImpl: typeof fetch, log: (line: string) => void): Promise<NasaRawImage[]> {
  const latestSols = await fetchLatestSols(fetchImpl);
  log(`feed: latest sols ${latestSols.join(', ')}`);
  const images: NasaRawImage[] = [];
  for (const sol of latestSols) {
    const batch = await fetchSolImages(sol, fetchImpl);
    log(`feed: sol ${sol} returned ${batch.length} driving-camera images`);
    images.push(...batch);
  }

  const recent = await fetchRecentDrivingImages(fetchImpl);
  log(`feed: newest-page returned ${recent.length} driving-camera images`);
  images.push(...recent);
  const navcams = await fetchRecentDrivingImages(fetchImpl, '|NAVCAM_LEFT|NAVCAM_RIGHT');
  log(`feed: newest Navcam page returned ${navcams.length} images`);
  images.push(...navcams);

  if (pickBestImage(images)) return dedupeImages(images);

  const lookbackStart = (latestSols[0] ?? 0) - 1;
  const lookbackEnd = Math.max(0, (latestSols[0] ?? 0) - LOOKBACK_SOLS);
  for (let sol = lookbackStart; sol >= lookbackEnd; sol--) {
    if (latestSols.includes(sol)) continue;
    const batch = await fetchSolImages(sol, fetchImpl);
    if (batch.length) log(`feed: lookback sol ${sol} returned ${batch.length} driving-camera images`);
    images.push(...batch);
    if (pickBestImage(images)) break;
  }
  return dedupeImages(images);
}

async function fetchWaypoint(fetchImpl: typeof fetch, log: (line: string) => void): Promise<NasaWaypoint | undefined> {
  try {
    const body = await fetchJson<NasaFeatureCollection>(NASA_WAYPOINTS_URL, fetchImpl);
    const waypoint = latestWaypoint(body.features);
    if (!waypoint) {
      log('location: MMGIS waypoint layer had no usable sol/lat/lon; skipped');
      return undefined;
    }
    log(
      `location: latest published waypoint sol ${waypoint.sol} ` +
        `lon ${waypoint.lon} lat ${waypoint.lat} from ${NASA_WAYPOINTS_URL}`,
    );
    return waypoint;
  } catch (err) {
    log(`location: waypoint fetch failed (${(err as Error).message}); skipped, not guessed`);
    return undefined;
  }
}

function extensionFor(url: string): string {
  const clean = url.split('?')[0] ?? url;
  const ext = path.extname(clean).toLowerCase();
  return ext === '.png' || ext === '.jpg' || ext === '.jpeg' ? ext : '.jpg';
}

function safeImageId(imageId: string): string {
  return imageId.replace(/[^A-Za-z0-9._-]/g, '_');
}

function storedPath(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

function fallbackMetaPath(liveDir: string): string {
  return path.join(liveDir, 'fallback', 'scene.json');
}

export function loadFallbackScene(liveDir = LIVE_DIR): { meta: LiveSceneMeta; filePath: string } {
  return readFallbackMeta(liveDir);
}

function readFallbackMeta(liveDir: string): { meta: LiveSceneMeta; filePath: string } {
  const metaPath = fallbackMetaPath(liveDir);
  if (!existsSync(metaPath)) {
    throw new Error(`Pinned fallback missing at ${metaPath}`);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as LiveSceneMeta;
  const filePath = path.join(liveDir, 'fallback', meta.fileName);
  if (!existsSync(filePath)) {
    throw new Error(`Pinned fallback image missing at ${filePath}`);
  }
  return { meta, filePath };
}

export function recordFromMeta(
  meta: LiveSceneMeta,
  filePath: string,
  opts: {
    isFallback: boolean;
    chosenWhy: string;
    waypoint?: NasaWaypoint;
    now?: Date;
  },
): LiveSceneRecord {
  const now = opts.now ?? new Date();
  return {
    id: LIVE_SCENE_ID,
    imageId: meta.imageId,
    sol: meta.sol,
    camera: meta.camera,
    utcDateTaken: meta.utcDateTaken,
    localMeanSolarTime: meta.localMeanSolarTime,
    daysAgo: daysAgoFromUtc(meta.utcDateTaken, now),
    filePath: storedPath(filePath),
    nasaUrl: meta.nasaUrl,
    credit: NASA_CREDIT,
    isFallback: opts.isFallback,
    chosenWhy: opts.chosenWhy,
    lat: opts.waypoint?.lat,
    lon: opts.waypoint?.lon,
    waypointSol: opts.waypoint?.sol,
    ingestedAt: now.toISOString(),
  };
}

async function downloadLargest(
  image: NasaRawImage,
  liveDir: string,
  fetchImpl: typeof fetch,
  log: (line: string) => void,
): Promise<{ filePath: string; meta: LiveSceneMeta }> {
  const url = largestImageUrl(image);
  if (!url || !image.imageid) throw new Error('image is missing a download URL or id');
  mkdirSync(liveDir, { recursive: true });
  const fileName = `${safeImageId(image.imageid)}${extensionFor(url)}`;
  const filePath = path.join(liveDir, fileName);
  if (!existsSync(filePath)) {
    log(`download: ${url}`);
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': NASA_UA },
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`image download HTTP ${res.status}`);
    writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
  } else {
    log(`download: already cached ${filePath}`);
  }
  const meta: LiveSceneMeta = {
    imageId: image.imageid,
    sol: image.sol ?? 0,
    camera: image.camera?.instrument ?? 'unknown',
    utcDateTaken: image.date_taken_utc ?? '',
    localMeanSolarTime: image.date_taken_mars ?? '',
    nasaUrl: image.link ?? '',
    credit: NASA_CREDIT,
    fileName,
  };
  writeFileSync(path.join(liveDir, `${safeImageId(image.imageid)}.json`), JSON.stringify(meta, null, 2));
  return { filePath, meta };
}

export async function pinFallback(imagePath: string, meta: LiveSceneMeta, liveDir = LIVE_DIR): Promise<void> {
  const dir = path.join(liveDir, 'fallback');
  mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, meta.fileName);
  if (path.resolve(imagePath) !== path.resolve(dest)) copyFileSync(imagePath, dest);
  writeFileSync(fallbackMetaPath(liveDir), JSON.stringify(meta, null, 2));
}

function fallbackRecord(
  liveDir: string,
  why: string,
  waypoint: NasaWaypoint | undefined,
  now: Date,
): LiveSceneRecord {
  const { meta, filePath } = readFallbackMeta(liveDir);
  return recordFromMeta(meta, filePath, {
    isFallback: true,
    chosenWhy: why,
    waypoint,
    now,
  });
}

export async function ingestLiveScene(opts: IngestOptions = {}): Promise<IngestResult> {
  const log = opts.log ?? console.log;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const liveDir = opts.liveDir ?? LIVE_DIR;
  const now = opts.now ?? new Date();
  mkdirSync(liveDir, { recursive: true });

  let record: LiveSceneRecord;
  if (opts.offline) {
    log('feed: offline flag set; using pinned demo scene');
    record = fallbackRecord(
      liveDir,
      'Pinned demo scene used because ingest was run offline.',
      undefined,
      now,
    );
  } else {
    try {
      const images = await collectCandidates(fetchImpl, log);
      const picked = pickBestImage(images);
      if (!picked) throw new Error('no full-frame daylight Navcam/Front Hazcam in the fetched pages');
      log(`pick: ${picked.why}`);
      const { filePath, meta } = await downloadLargest(picked.image, liveDir, fetchImpl, log);
      if (!existsSync(fallbackMetaPath(liveDir))) {
        await pinFallback(filePath, { ...meta, fileName: path.basename(filePath) }, liveDir);
        log(`fallback: pinned ${meta.imageId} for offline use`);
      }
      const waypoint = await fetchWaypoint(fetchImpl, log);
      record = recordFromMeta(meta, filePath, {
        isFallback: false,
        chosenWhy: picked.why,
        waypoint,
        now,
      });
    } catch (err) {
      const reason = (err as Error).message;
      log(`feed: unreachable or unusable (${reason}); using pinned demo scene`);
      let waypoint: NasaWaypoint | undefined;
      try {
        waypoint = await fetchWaypoint(fetchImpl, log);
      } catch {
        waypoint = undefined;
      }
      record = fallbackRecord(
        liveDir,
        `Pinned demo scene used because the NASA raw-image feed was unreachable or unusable (${reason}).`,
        waypoint,
        now,
      );
    }
  }

  log(
    `scene: ${record.camera} sol ${record.sol} ${record.daysAgo} days ago ` +
      `fallback=${record.isFallback} file=${record.filePath}`,
  );

  if (!opts.persist) return { record, persisted: false };
  try {
    await opts.persist(record);
    log(`spacetime: wrote live_scene id=${record.id}`);
    return { record, persisted: true };
  } catch (err) {
    const persistError = (err as Error).message;
    log(`spacetime: persist failed (${persistError})`);
    return { record, persisted: false, persistError };
  }
}
