type Chapter = {
  part: string;
  title: string;
};

type CompactToc = {
  parts: Array<{ name: string; titles: string[] }>;
};

type ScrollMap = Record<string, number>;

const STORAGE_KEYS = {
  lastChapter: "last-read-ch",
  lastByPart: "last-read-by-part",
  fontSize: "personal-reader-font-size",
  theme: "personal-theme",
  scrollMap: "scroll-pos-map",
  tocCache: "toc-cache",
} as const;

const SCROLL_MAX = 80;

function must<T extends Element>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Không tìm thấy ${selector}`);
  return node as T;
}

const el = {
  chapterPicker: must<HTMLSelectElement>(".chapter-picker"),
  title: must<HTMLHeadingElement>("#chapter-title"),
  content: must<HTMLElement>("#chapter-content"),
  reader: must<HTMLElement>("#reader"),
  btnPrev: must<HTMLButtonElement>("#btn-prev"),
  btnNext: must<HTMLButtonElement>("#btn-next"),
  btnPrevBottom: must<HTMLButtonElement>("#btn-prev-bottom"),
  btnNextBottom: must<HTMLButtonElement>("#btn-next-bottom"),
  fs: must<HTMLSelectElement>("#fs"),
  themeCheckbox: must<HTMLInputElement>("#theme-checkbox"),
  bookCards: [...document.querySelectorAll<HTMLAnchorElement>(".book-card")],
};

let toc: Chapter[] = [];
let currentCh = 1;
let currentPart: string | null = null;
let partIndex = new Map<string, number[]>();
let chapterListReady = false;

const migrateOldScrollKeys = (): void => {
  if (localStorage.getItem(STORAGE_KEYS.scrollMap) != null) return;
  const map: ScrollMap = {};
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("scroll-pos-")) continue;
    const ch = key.slice("scroll-pos-".length);
    const y = parseInt(localStorage.getItem(key) ?? "", 10);
    if (ch && Number.isFinite(y)) map[ch] = y;
    stale.push(key);
  }
  localStorage.setItem(STORAGE_KEYS.scrollMap, JSON.stringify(map));
  stale.forEach((key) => localStorage.removeItem(key));
};

const readScrollMap = (): ScrollMap => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEYS.scrollMap) ?? "{}");
    if (parsed && typeof parsed === "object") return parsed as ScrollMap;
    return {};
  } catch {
    return {};
  }
};

const writeScrollMap = (map: ScrollMap): void => {
  const keys = Object.keys(map);
  if (keys.length > SCROLL_MAX) {
    for (const key of keys.slice(0, keys.length - SCROLL_MAX)) delete map[key];
  }
  localStorage.setItem(STORAGE_KEYS.scrollMap, JSON.stringify(map));
};

const isHomeMode = (): boolean => document.documentElement.classList.contains("home-mode");

const readLastByPart = (): Record<string, number> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEYS.lastByPart) ?? "{}");
    if (parsed && typeof parsed === "object") return parsed as Record<string, number>;
    return {};
  } catch {
    return {};
  }
};

const writeLastByPart = (map: Record<string, number>): void => {
  localStorage.setItem(STORAGE_KEYS.lastByPart, JSON.stringify(map));
};

const rememberChapter = (ch: number): void => {
  localStorage.setItem(STORAGE_KEYS.lastChapter, String(ch));
  const entry = toc[ch - 1];
  if (!entry) return;
  const map = readLastByPart();
  map[entry.part] = ch;
  writeLastByPart(map);
};

const seedLastByPart = (): void => {
  const map = readLastByPart();
  if (Object.keys(map).length) return;
  const saved = parseInt(localStorage.getItem(STORAGE_KEYS.lastChapter) ?? "", 10);
  const entry = toc[saved - 1];
  if (!entry) return;
  map[entry.part] = saved;
  writeLastByPart(map);
};

const saveScrollNow = (): void => {
  if (!currentCh || isHomeMode()) return;
  const map = readScrollMap();
  map[String(currentCh)] = Math.round(window.scrollY);
  writeScrollMap(map);
};

const chapterUrl = (ch: number): string => `${import.meta.env.BASE_URL}${ch}.html`;

const chapterFromPath = (): number => {
  const match = /\/(\d+)\.html$/.exec(location.pathname);
  return match ? parseInt(match[1], 10) : 0;
};

const goTo = (ch: number): void => {
  if (ch < 1 || ch > toc.length || ch === currentCh) return;
  saveScrollNow();
  rememberChapter(ch);
  window.location.href = chapterUrl(ch);
};

const openBook = (part: string): void => {
  const chapters = partIndex.get(part) ?? [];
  const saved = readLastByPart()[part];
  const ch = saved && chapters.includes(saved) ? saved : (chapters[0] ?? 1);
  rememberChapter(ch);
  window.location.href = chapterUrl(ch);
};

const goPrev = (): void => goTo(currentCh - 1);
const goNext = (): void => goTo(currentCh + 1);

const FONT_PRESETS: Record<string, string> = {
  "17px": "1.6",
  "19px": "1.7",
  "22px": "1.8",
};

const normalizeFontSize = (size: string | null): string => {
  if (size === "26px" || size === "30px") return "22px";
  if (size && size in FONT_PRESETS) return size;
  return "19px";
};

const changeFontSize = (size: string): void => {
  const resolved = normalizeFontSize(size);
  const root = document.documentElement;
  if (root.style.getPropertyValue("--font-size") !== resolved) {
    root.style.setProperty("--font-size", resolved);
    root.style.setProperty("--line-height", FONT_PRESETS[resolved]!);
  }
  localStorage.setItem(STORAGE_KEYS.fontSize, resolved);
  if (el.fs.value !== resolved) el.fs.value = resolved;
};

const toggleTheme = (): void => {
  const isDark = document.documentElement.classList.toggle("dark-mode");
  localStorage.setItem(STORAGE_KEYS.theme, isDark ? "dark" : "light");
  el.themeCheckbox.checked = isDark;
};

const buildPartIndex = (): void => {
  partIndex = toc.reduce((map, { part }, i) => {
    const list = map.get(part) ?? [];
    list.push(i + 1);
    map.set(part, list);
    return map;
  }, new Map<string, number[]>());
};

const renderChapterPicker = (part: string, ch: number): void => {
  if (part !== currentPart || !chapterListReady) {
    currentPart = part;
    const frag = document.createDocumentFragment();
    for (const idx of partIndex.get(part) ?? []) {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = toc[idx - 1]?.title ?? "";
      frag.appendChild(opt);
    }
    el.chapterPicker.replaceChildren(frag);
    chapterListReady = true;
  }
  el.chapterPicker.value = String(ch);
};

const assetUrl = (path: string): string => {
  const base = import.meta.env.BASE_URL;
  return `${base}${path.replace(/^\//, "")}`;
};

const isChapter = (value: unknown): value is Chapter =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Chapter).part === "string" &&
  typeof (value as Chapter).title === "string";

const isCompactToc = (value: unknown): value is CompactToc =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as CompactToc).parts);

const parseToc = (data: unknown): Chapter[] => {
  if (Array.isArray(data) && data.every(isChapter)) return data;
  if (isCompactToc(data)) {
    return data.parts.flatMap(({ name, titles }) =>
      titles.map((title) => ({ part: name, title })),
    );
  }
  throw new Error("toc.json không đúng định dạng");
};

const loadToc = async (): Promise<Chapter[]> => {
  try {
    const cached = sessionStorage.getItem(STORAGE_KEYS.tocCache);
    if (cached) return parseToc(JSON.parse(cached) as unknown);
  } catch {
    /* ignore broken cache */
  }
  const res = await fetch(assetUrl("toc.json"), { cache: "force-cache", credentials: "omit" });
  if (!res.ok) throw new Error(`Không tải được toc.json (HTTP ${res.status})`);
  const data: unknown = await res.json();
  try {
    sessionStorage.setItem(STORAGE_KEYS.tocCache, JSON.stringify(data));
  } catch {
    /* quota */
  }
  return parseToc(data);
};

const ensureChapterList = (): void => {
  if (chapterListReady || !toc.length || !currentCh) return;
  const entry = toc[currentCh - 1];
  if (!entry) return;
  renderChapterPicker(entry.part, currentCh);
};

el.chapterPicker.addEventListener("pointerdown", ensureChapterList);
el.chapterPicker.addEventListener("focus", ensureChapterList);
el.chapterPicker.addEventListener("change", () => {
  ensureChapterList();
  goTo(parseInt(el.chapterPicker.value, 10));
});
el.fs.addEventListener("change", () => {
  changeFontSize(el.fs.value);
});
el.themeCheckbox.addEventListener("change", toggleTheme);
el.btnPrev.addEventListener("click", goPrev);
el.btnNext.addEventListener("click", goNext);
el.btnPrevBottom.addEventListener("click", goPrev);
el.btnNextBottom.addEventListener("click", goNext);

window.addEventListener("pagehide", saveScrollNow);

document.addEventListener("keydown", (e) => {
  if (isHomeMode()) return;
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return;
  }
  if (e.key === "ArrowLeft") goPrev();
  if (e.key === "ArrowRight") goNext();
});

const savedSize = normalizeFontSize(localStorage.getItem(STORAGE_KEYS.fontSize));
if (document.documentElement.style.getPropertyValue("--font-size") !== savedSize || el.fs.value !== savedSize) {
  changeFontSize(savedSize);
}

const bindHomeCards = (): void => {
  const parts = [...partIndex.keys()];
  const lastByPart = readLastByPart();
  el.bookCards.forEach((card, i) => {
    const part = parts[i];
    if (!part) return;
    const chapters = partIndex.get(part) ?? [];
    const saved = lastByPart[part];
    const ch = saved && chapters.includes(saved) ? saved : (chapters[0] ?? 1);
    card.href = chapterUrl(ch);
    const status = card.querySelector(".book-status");
    if (status) {
      status.textContent =
        saved && chapters.includes(saved) ? `Đọc tiếp · ${toc[saved - 1]?.title ?? ""}` : "Bắt đầu đọc";
    }
    card.addEventListener("click", (e) => {
      e.preventDefault();
      openBook(part);
    });
  });
};

const showHome = async (): Promise<void> => {
  document.documentElement.classList.add("home-mode");
  document.title = "Truyện Phàm Nhân Tu Tiên";
  try {
    toc = await loadToc();
    buildPartIndex();
    seedLastByPart();
    bindHomeCards();
  } catch (err) {
    console.error(err);
  }
};

const init = async (): Promise<void> => {
  const pathCh = chapterFromPath();
  if (!pathCh) {
    const urlCh = parseInt(new URLSearchParams(location.search).get("ch") ?? "", 10);
    if (urlCh) {
      location.replace(chapterUrl(urlCh));
      return;
    }
    await showHome();
    return;
  }

  currentCh = pathCh;
  if (document.documentElement.classList.contains("home-mode")) {
    document.documentElement.classList.remove("home-mode");
  }

  try {
    toc = await loadToc();
    buildPartIndex();
    migrateOldScrollKeys();
    seedLastByPart();
    const startCh = Math.min(Math.max(pathCh, 1), toc.length);
    if (startCh !== pathCh) {
      location.replace(chapterUrl(startCh));
      return;
    }
    currentCh = startCh;
    rememberChapter(startCh);
  } catch (err) {
    el.title.textContent = "Lỗi tải danh sách chương";
    console.error(err);
  }
};

void init();
