export type Status = 'กินได้' | 'จำกัดปริมาณ' | 'ตามยี่ห้อ' | 'ต้องตรวจส่วนประกอบ' | 'ห้าม';

export interface PhotoCredit {
  url: string;
  creator: string;
  license: string;
  page: string;
}

export interface IngredientInfo {
  status: Status;
  reason: string;
  substitute: string;
  source: string;
  image?: PhotoCredit | null;
}

export interface ProteinMapEntry {
  mapsTo: string;
  status: string;
  reason: string;
}

export interface Brand {
  category: string;
  brand: string;
  variant: string;
  note: string;
  confirmed: boolean;
  image?: PhotoCredit | null;
}

export interface MenuRow {
  ingredient: string;
  role: string;
  note: string;
}

export type MenuImage = PhotoCredit;

export interface Menu {
  name: string;
  region: string;
  options: string[];
  slot: number;
  rows: MenuRow[];
  image: MenuImage | null;
}

export interface Data {
  ingredients: Record<string, IngredientInfo>;
  proteinMap: Record<string, ProteinMapEntry>;
  brands: Brand[];
  menus: Menu[];
}

export type Verdict = 'ok' | 'no' | 'unsure';

/** How one ingredient row is handled for a diet. */
export type RowKind = 'ok' | 'limit' | 'swap' | 'omit' | 'brand' | 'unknown' | 'banned';

export interface RowResult {
  ingredient: string;
  kind: RowKind;
  /** Short Thai instruction shown under the ingredient name. */
  use: string;
  reason?: string;
  swapTo?: string;
  brands?: { brand: string; variants: string[]; notes: string[]; singleSource: boolean; image?: PhotoCredit | null }[];
  /** Photo of the ingredient itself (never a brand photo). */
  image?: PhotoCredit | null;
  protein?: boolean;
}

export interface Check {
  menu: string;
  /** Chosen protein option; null when the user did not choose one. */
  protein: string | null;
  verdict: Verdict;
  rows: RowResult[];
  /** Why the verdict is not "ok" (Thai sentences). */
  reasons: string[];
  /** Verdict for each protein option, when the menu has options. */
  byProtein: { option: string; verdict: Verdict }[];
}
