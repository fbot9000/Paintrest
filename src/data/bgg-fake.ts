/**
 * Simulated BoardGameGeek search. No network call is made and these are NOT
 * real BGG records: names and thing ids (9000xx) are invented for the prototype.
 * The real lookup belongs in the application layer (skjema §4, §10).
 */
import type { BggCandidate } from '../domain/commands';

const FAKE: BggCandidate[] = [
  {
    thing_id: 900001, primary_name: 'Avalon: The Riven Veil', year_published: 2026, publishers: ['Shadowborne Games'],
    expansions: [
      { thing_id: 900011, name: 'Mistwalkers', year_published: 2026 },
      { thing_id: 900012, name: 'Myths & Monsters', year_published: 2026 },
    ],
  },
  { thing_id: 900002, primary_name: 'Avalon Skirmish', year_published: 2019, publishers: ['Eksempelforlaget'], expansions: [] },
  {
    thing_id: 900003, primary_name: 'Zombie Street Siege', year_published: 2021, publishers: ['Eksempelforlaget'],
    expansions: [{ thing_id: 900031, name: 'Night Shift', year_published: 2022 }],
  },
  { thing_id: 900004, primary_name: 'Dungeon of the Iron Wolf', year_published: 2024, publishers: ['Northpeak'], expansions: [] },
];

export async function searchBgg(query: string): Promise<BggCandidate[]> {
  await new Promise((r) => setTimeout(r, 350));
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return FAKE.filter((c) => c.primary_name.toLowerCase().includes(q));
}
