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
  partPicker: must<HTMLSelectElement>(".part-picker"),
  chapterPicker: must<HTMLSelectElement>(".chapter-picker"),
  title: must<HTMLHeadingElement>("#chapter-title"),
  content: must<HTMLElement>("#chapter-content"),
  btnPrev: must<HTMLButtonElement>("#btn-prev"),
  btnNext: must<HTMLButtonElement>("#btn-next"),
  btnPrevBottom: must<HTMLButtonElement>("#btn-prev-bottom"),
  btnNextBottom: must<HTMLButtonElement>("#btn-next-bottom"),
  fs: must<HTMLSelectElement>("#fs"),
  themeCheckbox: must<HTMLInputElement>("#theme-checkbox"),
};

let toc: Chapter[] = [];
let currentCh = 1;
let currentPart: string | null = null;
let partIndex = new Map<string, number[]>();
let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;

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

const saveScrollNow = (): void => {
  if (!currentCh) return;
  const map = readScrollMap();
  map[String(currentCh)] = Math.round(window.scrollY);
  writeScrollMap(map);
};

const chapterUrl = (ch: number): string => `?ch=${ch}`;

const goTo = (ch: number): void => {
  if (ch < 1 || ch > toc.length || ch === currentCh) return;
  saveScrollNow();
  localStorage.setItem(STORAGE_KEYS.lastChapter, String(ch));
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
  document.documentElement.style.setProperty("--font-size", resolved);
  document.documentElement.style.setProperty("--line-height", FONT_PRESETS[resolved]!);
  localStorage.setItem(STORAGE_KEYS.fontSize, resolved);
  el.fs.value = resolved;
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

const renderPartPicker = (): void => {
  const frag = document.createDocumentFragment();
  for (const name of partIndex.keys()) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    frag.appendChild(opt);
  }
  el.partPicker.replaceChildren(frag);
};

const renderChapterPicker = (part: string, ch: number): void => {
  if (part !== currentPart) {
    currentPart = part;
    const frag = document.createDocumentFragment();
    for (const idx of partIndex.get(part) ?? []) {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = toc[idx - 1]?.title ?? "";
      frag.appendChild(opt);
    }
    el.chapterPicker.replaceChildren(frag);
  }
  el.chapterPicker.value = String(ch);
};

const restoreScrollPosition = (ch: number): void => {
  const saved = readScrollMap()[String(ch)];
  const y = saved ? Number(saved) : 0;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => window.scrollTo(0, y));
  });
};

const assetUrl = (path: string): string => {
  const base = import.meta.env.BASE_URL;
  return `${base}${path.replace(/^\//, "")}`;
};

const prefetchChapter = (ch: number): void => {
  if (ch < 1 || ch > toc.length) return;
  void fetch(assetUrl(`chapters/${ch}.txt`), { cache: "force-cache" }).catch(() => undefined);
};

const fetchChapterText = async (ch: number): Promise<string> => {
  const res = await fetch(assetUrl(`chapters/${ch}.txt`), { cache: "force-cache" });
  if (!res.ok) throw new Error(`Không tải được chương ${ch}`);
  return res.text();
};

const loadChapter = async (ch: number): Promise<void> => {
  if (ch < 1 || ch > toc.length) return;
  currentCh = ch;
  localStorage.setItem(STORAGE_KEYS.lastChapter, String(ch));

  const entry = toc[ch - 1];
  if (!entry) return;

  el.partPicker.value = entry.part;
  el.title.textContent = entry.title;
  document.title = entry.title;

  el.btnPrev.disabled = el.btnPrevBottom.disabled = ch <= 1;
  el.btnNext.disabled = el.btnNextBottom.disabled = ch >= toc.length;
  renderChapterPicker(entry.part, ch);
  el.content.innerHTML = '<p class="loading">Đang tải chương…</p>';

  try {
    el.content.innerHTML = await fetchChapterText(ch);
    restoreScrollPosition(ch);
    prefetchChapter(ch + 1);
    prefetchChapter(ch + 2);
  } catch (err) {
    el.content.innerHTML = '<p class="error">Không tải được nội dung chương.</p>';
    console.error(err);
  }
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

el.partPicker.addEventListener("change", (e) => {
  const value = (e.target as HTMLSelectElement).value;
  const [firstCh = 1] = partIndex.get(value) ?? [];
  goTo(firstCh);
});
el.chapterPicker.addEventListener("change", (e) => {
  goTo(parseInt((e.target as HTMLSelectElement).value, 10));
});
el.fs.addEventListener("change", (e) => {
  changeFontSize((e.target as HTMLSelectElement).value);
});
el.themeCheckbox.addEventListener("change", toggleTheme);
el.btnPrev.addEventListener("click", goPrev);
el.btnNext.addEventListener("click", goNext);
el.btnPrevBottom.addEventListener("click", goPrev);
el.btnNextBottom.addEventListener("click", goNext);

window.addEventListener(
  "scroll",
  () => {
    if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(saveScrollNow, 150);
  },
  { passive: true },
);

window.addEventListener("pagehide", saveScrollNow);

document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return;
  }
  if (e.key === "ArrowLeft") goPrev();
  if (e.key === "ArrowRight") goNext();
});

const savedSize = localStorage.getItem(STORAGE_KEYS.fontSize);
changeFontSize(normalizeFontSize(savedSize));
if (document.documentElement.classList.contains("dark-mode")) {
  el.themeCheckbox.checked = true;
}

const init = async (): Promise<void> => {
  try {
    toc = await loadToc();
    buildPartIndex();
    renderPartPicker();
    migrateOldScrollKeys();

    const urlCh = parseInt(new URLSearchParams(location.search).get("ch") ?? "", 10);
    const savedCh = parseInt(localStorage.getItem(STORAGE_KEYS.lastChapter) ?? "", 10);
    const startCh = Math.min(Math.max(urlCh || savedCh || 1, 1), toc.length);
    await loadChapter(startCh);
  } catch (err) {
    el.title.textContent = "Lỗi tải danh sách chương";
    console.error(err);
  }
};

void init();
