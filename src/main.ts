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

type PickerOption = { value: string; label: string };

type Picker = {
  wrap: HTMLElement;
  trigger: HTMLButtonElement;
  valueEl: HTMLElement;
  menu: HTMLElement;
  options: PickerOption[];
  value: string;
  onChange: ((value: string) => void) | null;
};

const bindPicker = (wrapSelector: string, triggerSelector: string): Picker => {
  const wrap = must<HTMLElement>(wrapSelector);
  const trigger = must<HTMLButtonElement>(triggerSelector);
  const valueEl = must<HTMLElement>(`${wrapSelector} .picker-value`);
  const menu = must<HTMLElement>(`${wrapSelector} .picker-menu`);
  return { wrap, trigger, valueEl, menu, options: [], value: "", onChange: null };
};

const el = {
  partPicker: bindPicker(".part-picker-wrap", ".part-picker"),
  chapterPicker: bindPicker(".chapter-picker-wrap", ".chapter-picker"),
  title: must<HTMLHeadingElement>("#chapter-title"),
  content: must<HTMLElement>("#chapter-content"),
  reader: must<HTMLElement>("#reader"),
  btnPrev: must<HTMLButtonElement>("#btn-prev"),
  btnNext: must<HTMLButtonElement>("#btn-next"),
  btnPrevBottom: must<HTMLButtonElement>("#btn-prev-bottom"),
  btnNextBottom: must<HTMLButtonElement>("#btn-next-bottom"),
  fs: bindPicker(".fs-picker-wrap", "#fs"),
  themeCheckbox: must<HTMLInputElement>("#theme-checkbox"),
  bookCards: [...document.querySelectorAll<HTMLAnchorElement>(".book-card")],
};

const pickers = [el.partPicker, el.chapterPicker, el.fs];

const isPickerOpen = (picker: Picker): boolean => picker.trigger.getAttribute("aria-expanded") === "true";

const closePicker = (picker: Picker): void => {
  picker.trigger.setAttribute("aria-expanded", "false");
  picker.menu.hidden = true;
};

const closeAllPickers = (): void => {
  pickers.forEach(closePicker);
};

const setPickerValue = (picker: Picker, value: string): void => {
  picker.value = value;
  const match = picker.options.find((opt) => opt.value === value);
  picker.valueEl.textContent = match?.label ?? value;
  picker.menu.querySelectorAll<HTMLButtonElement>(".picker-option").forEach((btn) => {
    const selected = btn.dataset.value === value;
    btn.classList.toggle("is-selected", selected);
    btn.setAttribute("aria-selected", selected ? "true" : "false");
  });
};

const renderPickerOptions = (picker: Picker, options: PickerOption[], selected: string): void => {
  picker.options = options;
  const frag = document.createDocumentFragment();
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-option";
    btn.role = "option";
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    frag.appendChild(btn);
  }
  picker.menu.replaceChildren(frag);
  setPickerValue(picker, selected);
};

const openPicker = (picker: Picker): void => {
  pickers.forEach((other) => {
    if (other !== picker) closePicker(other);
  });
  picker.trigger.setAttribute("aria-expanded", "true");
  picker.menu.hidden = false;
  const selected = picker.menu.querySelector<HTMLElement>(".picker-option.is-selected");
  selected?.scrollIntoView({ block: "nearest" });
};

const bindPickerEvents = (picker: Picker): void => {
  picker.trigger.addEventListener("click", () => {
    if (isPickerOpen(picker)) closePicker(picker);
    else openPicker(picker);
  });
  picker.menu.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".picker-option");
    if (!btn?.dataset.value) return;
    const value = btn.dataset.value;
    closePicker(picker);
    if (value === picker.value) return;
    setPickerValue(picker, value);
    picker.onChange?.(value);
  });
  picker.menu.addEventListener("mouseover", (e) => {
    const btn = (e.target as HTMLElement).closest(".picker-option");
    if (!btn) return;
    picker.menu.querySelectorAll(".picker-option.is-active").forEach((node) => node.classList.remove("is-active"));
    btn.classList.add("is-active");
  });
};

pickers.forEach(bindPickerEvents);

document.addEventListener("click", (e) => {
  if (pickers.some((picker) => picker.wrap.contains(e.target as Node))) return;
  closeAllPickers();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!pickers.some(isPickerOpen)) return;
  closeAllPickers();
  e.preventDefault();
});

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
  document.documentElement.style.setProperty("--font-size", resolved);
  document.documentElement.style.setProperty("--line-height", FONT_PRESETS[resolved]!);
  localStorage.setItem(STORAGE_KEYS.fontSize, resolved);
  setPickerValue(el.fs, resolved);
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
  renderPickerOptions(
    el.partPicker,
    [...partIndex.keys()].map((name) => ({ value: name, label: name })),
    [...partIndex.keys()][0] ?? "",
  );
};

const renderChapterPicker = (part: string, ch: number): void => {
  if (part !== currentPart) {
    currentPart = part;
    renderPickerOptions(
      el.chapterPicker,
      (partIndex.get(part) ?? []).map((idx) => ({
        value: String(idx),
        label: toc[idx - 1]?.title ?? "",
      })),
      String(ch),
    );
    return;
  }
  setPickerValue(el.chapterPicker, String(ch));
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
  rememberChapter(ch);

  const entry = toc[ch - 1];
  if (!entry) return;

  setPickerValue(el.partPicker, entry.part);
  el.title.textContent = entry.title;
  document.title = entry.title;

  el.btnPrev.disabled = el.btnPrevBottom.disabled = ch <= 1;
  el.btnNext.disabled = el.btnNextBottom.disabled = ch >= toc.length;
  renderChapterPicker(entry.part, ch);
  const prerendered = el.reader.getAttribute("data-prerendered-ch") === String(ch);
  if (!prerendered) {
    el.content.innerHTML = '<p class="loading">Đang tải chương…</p>';
  }

  try {
    if (!prerendered) {
      el.content.innerHTML = await fetchChapterText(ch);
    }
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

el.partPicker.onChange = (value) => {
  const [firstCh = 1] = partIndex.get(value) ?? [];
  goTo(firstCh);
};
el.chapterPicker.onChange = (value) => {
  goTo(parseInt(value, 10));
};
el.fs.onChange = (value) => {
  changeFontSize(value);
};
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
  if (isHomeMode()) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return;
  }
  if (pickers.some(isPickerOpen)) return;
  if (e.key === "ArrowLeft") goPrev();
  if (e.key === "ArrowRight") goNext();
});

const FONT_OPTIONS: PickerOption[] = [
  { value: "17px", label: "Nhỏ" },
  { value: "19px", label: "Bình thường" },
  { value: "22px", label: "Lớn" },
];
renderPickerOptions(el.fs, FONT_OPTIONS, "19px");

const savedSize = localStorage.getItem(STORAGE_KEYS.fontSize);
changeFontSize(normalizeFontSize(savedSize));
if (document.documentElement.classList.contains("dark-mode")) {
  el.themeCheckbox.checked = true;
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

  document.documentElement.classList.remove("home-mode");

  try {
    toc = await loadToc();
    buildPartIndex();
    renderPartPicker();
    migrateOldScrollKeys();
    seedLastByPart();

    const startCh = Math.min(Math.max(pathCh, 1), toc.length);
    if (startCh !== pathCh) {
      location.replace(chapterUrl(startCh));
      return;
    }
    await loadChapter(startCh);
  } catch (err) {
    el.title.textContent = "Lỗi tải danh sách chương";
    console.error(err);
  }
};

void init();
