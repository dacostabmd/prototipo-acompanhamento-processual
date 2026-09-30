const STORAGE_KEY = 'bf:tribunalTiming';
const DEFAULT_AVG_MS = 4000;

interface TimingEntry {
  avgMs: number;
  amostras: number;
}

type TimingMap = Record<string, TimingEntry>;

function readAll(): TimingMap {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAll(map: TimingMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

/** Tempo médio histórico (ms) de resposta de um tribunal, com fallback para uma estimativa padrão. */
export function getAvgMs(label: string): number {
  return readAll()[label]?.avgMs ?? DEFAULT_AVG_MS;
}

/** Registra uma nova amostra de tempo de resposta (média móvel simples) para refinar a estimativa futura. */
export function recordSample(label: string, elapsedMs: number) {
  if (typeof window === 'undefined' || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
  const map = readAll();
  const prev = map[label];
  if (!prev) {
    map[label] = { avgMs: elapsedMs, amostras: 1 };
  } else {
    const amostras = Math.min(prev.amostras + 1, 20);
    map[label] = { avgMs: prev.avgMs + (elapsedMs - prev.avgMs) / amostras, amostras };
  }
  writeAll(map);
}
