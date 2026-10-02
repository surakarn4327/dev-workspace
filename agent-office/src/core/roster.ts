import type { AgentId } from './types.ts';

export type Dept = 'exec' | 'research' | 'production' | 'qa' | 'ops';
export type HairStyle = 'short' | 'long' | 'bob' | 'bun' | 'spiky' | 'bald' | 'cap';
export type Accessory = 'none' | 'tie' | 'headset' | 'lanyard' | 'bag';

export interface Look {
  skin: string;
  /** Hair colour (cap colour when hairStyle is 'cap'). */
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  pants: string;
  accent: string;
  accessory: Accessory;
  crown?: boolean;
}

export interface AgentDef {
  id: AgentId;
  name: string;
  role: string;
  dept: Dept;
  look: Look;
  /** Which brain drives this position. A per-position config line later. */
  model: string;
  blurb: string;
}

export const DEPT_COLOR: Record<Dept, string> = {
  exec: '#8f6bd9',
  research: '#3fb6c6',
  production: '#f09a3e',
  qa: '#4fc27a',
  ops: '#c9915a',
};

const MOCK = 'mock-script';

export const ROSTER: Record<AgentId, AgentDef> = {
  owner: {
    id: 'owner',
    name: 'Rex',
    role: 'Owner',
    dept: 'exec',
    model: MOCK,
    blurb: 'Takes your order, gathers requirements and decides which departments to involve.',
    look: {
      skin: '#e0a878',
      hair: '#9aa0ad',
      hairStyle: 'short',
      shirt: '#2f3350',
      pants: '#272a40',
      accent: '#d9453b',
      accessory: 'tie',
      crown: true,
    },
  },
  secretary: {
    id: 'secretary',
    name: 'Sam',
    role: 'Secretary',
    dept: 'exec',
    model: MOCK,
    blurb: 'Writes the brief and delivers the final result to the client.',
    look: {
      skin: '#f2c9a0',
      hair: '#6b3f1d',
      hairStyle: 'bun',
      shirt: '#d9688a',
      pants: '#3b3f5c',
      accent: '#2a2438',
      accessory: 'headset',
    },
  },
  'research-head': {
    id: 'research-head',
    name: 'Dr. Iris',
    role: 'Head of Research',
    dept: 'research',
    model: MOCK,
    blurb: 'Splits the research work, reviews findings and reports to Production.',
    look: {
      skin: '#c48a5a',
      hair: '#1b1b2b',
      hairStyle: 'bob',
      shirt: '#eceae3',
      pants: '#46567a',
      accent: '#3fb6c6',
      accessory: 'lanyard',
    },
  },
  'research-1': {
    id: 'research-1',
    name: 'Leo',
    role: 'Researcher',
    dept: 'research',
    model: MOCK,
    blurb: 'Gathers facts and sources.',
    look: {
      skin: '#f2c9a0',
      hair: '#d9a441',
      hairStyle: 'short',
      shirt: '#dce6ef',
      pants: '#4a5a7a',
      accent: '#3fb6c6',
      accessory: 'none',
    },
  },
  'research-2': {
    id: 'research-2',
    name: 'Mina',
    role: 'Researcher',
    dept: 'research',
    model: MOCK,
    blurb: 'Gathers facts and sources.',
    look: {
      skin: '#8d5a3a',
      hair: '#2b2118',
      hairStyle: 'long',
      shirt: '#e6e1d6',
      pants: '#4a5a7a',
      accent: '#3fb6c6',
      accessory: 'none',
    },
  },
  'prod-head': {
    id: 'prod-head',
    name: 'Hana',
    role: 'Head of Production',
    dept: 'production',
    model: MOCK,
    blurb: 'Plans the build, merges research into the deliverable and fixes QA findings.',
    look: {
      skin: '#f2c9a0',
      hair: '#b8442b',
      hairStyle: 'long',
      shirt: '#e8913a',
      pants: '#3b3f5c',
      accent: '#f09a3e',
      accessory: 'lanyard',
    },
  },
  'prod-1': {
    id: 'prod-1',
    name: 'Kai',
    role: 'Producer',
    dept: 'production',
    model: MOCK,
    blurb: 'Drafts and builds parts of the deliverable.',
    look: {
      skin: '#e0a878',
      hair: '#2b2118',
      hairStyle: 'spiky',
      shirt: '#4a8fd9',
      pants: '#303450',
      accent: '#f09a3e',
      accessory: 'none',
    },
  },
  'prod-2': {
    id: 'prod-2',
    name: 'Zoe',
    role: 'Producer',
    dept: 'production',
    model: MOCK,
    blurb: 'Drafts and builds parts of the deliverable.',
    look: {
      skin: '#c48a5a',
      hair: '#6b3f1d',
      hairStyle: 'bob',
      shirt: '#6fbf5f',
      pants: '#303450',
      accent: '#f09a3e',
      accessory: 'none',
    },
  },
  qa: {
    id: 'qa',
    name: 'Quinn',
    role: 'QA Reviewer',
    dept: 'qa',
    model: MOCK,
    blurb: 'Checks the deliverable against the approved brief and can send it back.',
    look: {
      skin: '#f2c9a0',
      hair: '#8a8f9c',
      hairStyle: 'short',
      shirt: '#2f9e72',
      pants: '#2f3550',
      accent: '#4fc27a',
      accessory: 'none',
    },
  },
  courier: {
    id: 'courier',
    name: 'Zip',
    role: 'Courier',
    dept: 'ops',
    model: 'queue (plain code, no AI)',
    blurb: 'A real first-in-first-out queue: carries documents between desks. Not an AI.',
    look: {
      skin: '#e0a878',
      hair: '#a8472b',
      hairStyle: 'cap',
      shirt: '#a8703a',
      pants: '#3b3f5c',
      accent: '#7a4e2a',
      accessory: 'bag',
    },
  },
};

export function nameOf(id: AgentId | 'user'): string {
  return id === 'user' ? 'You' : ROSTER[id].name;
}
