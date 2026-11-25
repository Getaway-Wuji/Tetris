import { BOARD_ROWS, type Cell } from './frame';

export interface SupportReaction {
  group: number;
  x: number;
  y: number;
  strength: number;
  delayMs: number;
}

export interface ImpactContact {
  x: number;
  y: number;
  floor: boolean;
  offset: number;
  supports: readonly SupportReaction[];
}

type Face = { x: number; y: number; group?: number; floor: boolean };
type Load = { x: number; y: number; weight: number };

const TRANSMISSION = 0.36;
const TRANSMISSION_DELAY_MS = 23;

function key(x: number, y: number) {
  return `${x}:${y}`;
}

function groupOf(cell: Cell) {
  return cell.group && cell.group > 0 ? cell.group : undefined;
}

function contactsFor(footprint: readonly Cell[], stack: ReadonlyMap<string, Cell>): Face[] {
  const own = new Set(footprint.map(cell => key(cell.x, cell.y)));
  const faces: Face[] = [];
  for (const cell of footprint) {
    const { x, y } = cell;
    const group = groupOf(cell);
    const below = key(x, y + 1);
    if (own.has(below)) continue;
    if (y + 1 === BOARD_ROWS) {
      faces.push({ x, y: y + 0.5, floor: true });
      continue;
    }
    const support = stack.get(below);
    if (support && (!group || support.group !== group)) {
      faces.push({ x, y: y + 0.5, group: groupOf(support), floor: false });
    }
  }
  return faces;
}

function addLoad(loads: Map<number, Load>, { x, y, group }: Face, weight: number) {
  if (!group) return;
  const load = loads.get(group) ?? { x: 0, y: 0, weight: 0 };
  load.x += x * weight;
  load.y += y * weight;
  load.weight += weight;
  loads.set(group, load);
}

function reactions(loads: ReadonlyMap<number, Load>, delayMs: number): SupportReaction[] {
  return Array.from(loads, ([group, load]) => ({
    group,
    x: load.x / load.weight,
    y: load.y / load.weight,
    strength: Math.min(load.weight, 1),
    delayMs,
  }));
}

/** Cell-center coordinates, with the floor at BOARD_ROWS - 0.5 and positive y pointing down. */
export function resolveImpact(incoming: readonly Cell[], locked: readonly Cell[]): ImpactContact | null {
  const incomingGroups = new Set(incoming.map(groupOf));
  const supports = locked.filter(cell => !groupOf(cell) || !incomingGroups.has(groupOf(cell)));
  const stack = new Map(supports.map(cell => [key(cell.x, cell.y), cell]));
  const faces = contactsFor(incoming, stack);
  if (!faces.length) return null;

  const x = faces.reduce((sum, face) => sum + face.x, 0) / faces.length;
  const y = faces.reduce((sum, face) => sum + face.y, 0) / faces.length;
  const massX = incoming.reduce((sum, cell) => sum + cell.x, 0) / incoming.length;
  const direct = new Map<number, Load>();
  for (const face of faces) addLoad(direct, face, 1 / faces.length);

  const transmitted = new Map<number, Load>();
  for (const [group, load] of direct) {
    const underneath = contactsFor(supports.filter(cell => cell.group === group), stack);
    for (const face of underneath) {
      if (face.group && !direct.has(face.group)) addLoad(transmitted, face, load.weight * TRANSMISSION / underneath.length);
    }
  }

  return {
    x, y, floor: faces.some(face => face.floor), offset: massX - x,
    supports: [...reactions(direct, 0), ...reactions(transmitted, TRANSMISSION_DELAY_MS)],
  };
}
