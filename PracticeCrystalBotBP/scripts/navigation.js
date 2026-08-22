// ── Navigation ──
// ブロックグリッド上の A* 経路探索。
// 「1歩先だけを見る」貪欲探索をやめ、壁・柱・穴・段差を回り込めるようにする。
// 経路はキャッシュしてから数tickかけて追従するため、毎tickの負荷は小さい。

import { globalSettings } from "./state.js";
import {
  getBlock, isSolidBlock, addVector, isLocationInsideBotBoundary,
} from "./utils.js";

// ── Block classification ──
const NAV_HAZARD_IDS = new Set([
  "minecraft:lava", "minecraft:flowing_lava", "minecraft:fire", "minecraft:soul_fire",
  "minecraft:magma", "minecraft:cactus", "minecraft:sweet_berry_bush",
  "minecraft:powder_snow", "minecraft:wither_rose", "minecraft:campfire",
  "minecraft:soul_campfire", "minecraft:end_portal", "minecraft:nether_portal",
]);

const NAV_LIQUID_IDS = new Set([
  "minecraft:water", "minecraft:flowing_water",
]);

export function navIsHazardBlock(block) {
  if (!block) return false;
  const typeId = block.typeId ?? "";
  if (NAV_HAZARD_IDS.has(typeId)) return true;
  try { if (block.isLiquid && (typeId.includes("lava"))) return true; } catch {}
  return false;
}

export function navIsWaterBlock(block) {
  if (!block) return false;
  if (NAV_LIQUID_IDS.has(block.typeId ?? "")) return true;
  try { return !!block.isLiquid && !`${block.typeId}`.includes("lava"); } catch { return false; }
}

// 体が通り抜けられるか（空気・草・水など）
export function navIsPassableBlock(block) {
  if (!block) return true; // 未読み込みチャンクは通行可能扱い（無限ループ防止）
  if (navIsHazardBlock(block)) return false;
  try { if (block.isAir) return true; } catch {}
  if (navIsWaterBlock(block)) return true;
  return !isSolidBlock(block);
}

// 足場として体を支えられるか
export function navIsSupportBlock(block) {
  if (!block) return false;
  if (navIsHazardBlock(block)) return false;
  return isSolidBlock(block);
}

function navBlockAt(dimension, x, y, z) {
  return getBlock(dimension, { x, y, z });
}

// 足元座標(整数)が立てる場所かどうか
export function navIsStandableCell(dimension, x, y, z, cache) {
  const key = cache ? `${x}|${y}|${z}` : "";
  if (cache && cache.has(key)) return cache.get(key);
  let result = 0; // 0=不可, 1=地上, 2=水中
  const feet = navBlockAt(dimension, x, y, z);
  const head = navBlockAt(dimension, x, y + 1, z);
  if (navIsPassableBlock(feet) && navIsPassableBlock(head)) {
    if (navIsWaterBlock(feet)) result = 2;
    else if (navIsSupportBlock(navBlockAt(dimension, x, y - 1, z))) result = 1;
  }
  if (cache) cache.set(key, result);
  return result;
}

// 体(幅0.6/高さ1.8)がその座標を占有できるか（連続座標版）
export function navCanOccupy(dimension, location, radius = 0.32, height = 1.85) {
  const yBase = Math.floor(location.y);
  const yTop = Math.floor(location.y + height - 0.01);
  for (let y = yBase; y <= yTop; y++) {
    for (const dx of [-radius, radius]) {
      for (const dz of [-radius, radius]) {
        const block = navBlockAt(dimension, Math.floor(location.x + dx), y, Math.floor(location.z + dz));
        if (!navIsPassableBlock(block)) return false;
      }
    }
  }
  return true;
}

// 足元の地面の高さ(トップ面のY)を返す。maxDrop 以内に無ければ undefined
export function navFindGroundY(dimension, location, maxDrop = 24, radius = 0.32) {
  const startY = Math.floor(location.y + 0.001);
  for (let dy = 0; dy <= maxDrop; dy++) {
    const y = startY - dy;
    for (const dx of [-radius, radius, 0]) {
      for (const dz of [-radius, radius, 0]) {
        const block = navBlockAt(dimension, Math.floor(location.x + dx), y - 1, Math.floor(location.z + dz));
        if (navIsSupportBlock(block)) return y;
      }
    }
  }
  return undefined;
}

export function navIsInsideBoundaryCell(x, y, z) {
  if (!globalSettings?.boundaryEnabled) return true;
  return isLocationInsideBotBoundary({ x: x + 0.5, y, z: z + 0.5 });
}

// ── Binary heap ──
class NavHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(node) {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].f <= items[i].f) break;
      const tmp = items[parent]; items[parent] = items[i]; items[i] = tmp;
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last !== undefined) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1, right = left + 1;
        let best = i;
        if (left < items.length && items[left].f < items[best].f) best = left;
        if (right < items.length && items[right].f < items[best].f) best = right;
        if (best === i) break;
        const tmp = items[best]; items[best] = items[i]; items[i] = tmp;
        i = best;
      }
    }
    return top;
  }
}

// ── Neighbors ──
const NAV_DIRECTIONS = [
  { x: 1, z: 0, diagonal: false }, { x: -1, z: 0, diagonal: false },
  { x: 0, z: 1, diagonal: false }, { x: 0, z: -1, diagonal: false },
  { x: 1, z: 1, diagonal: true }, { x: 1, z: -1, diagonal: true },
  { x: -1, z: 1, diagonal: true }, { x: -1, z: -1, diagonal: true },
];

function navHasHeadroom(dimension, x, y, z, levels) {
  for (let i = 0; i < levels; i++) {
    if (!navIsPassableBlock(navBlockAt(dimension, x, y + 1 + i, z))) return false;
  }
  return true;
}

function navOctileHeuristic(ax, ay, az, bx, by, bz) {
  const dx = Math.abs(ax - bx), dz = Math.abs(az - bz), dy = Math.abs(ay - by);
  const straight = Math.max(dx, dz);
  const diagonal = Math.min(dx, dz);
  return (straight - diagonal) + diagonal * 1.4 + dy * 1.15;
}

/**
 * A* 経路探索。
 * @returns {{ waypoints: {x,y,z}[], complete: boolean } | undefined}
 */
export function navFindPath(dimension, start, goal, options = {}) {
  const maxExpansions = Math.max(32, Math.floor(options.maxExpansions ?? 320));
  const maxFall = Math.max(1, Math.floor(options.maxFall ?? 4));
  const maxJumpGap = Math.max(0, Math.floor(options.maxJumpGap ?? 3));
  const allowWater = options.allowWater !== false;
  const respectBoundary = options.respectBoundary !== false;

  const cache = new Map();
  const startCell = { x: Math.floor(start.x), y: Math.floor(start.y + 0.001), z: Math.floor(start.z) };
  const goalCell = { x: Math.floor(goal.x), y: Math.floor(goal.y + 0.001), z: Math.floor(goal.z) };
  if (startCell.x === goalCell.x && startCell.y === goalCell.y && startCell.z === goalCell.z) {
    return { waypoints: [], complete: true };
  }

  const startKey = `${startCell.x}|${startCell.y}|${startCell.z}`;
  const open = new NavHeap();
  const nodes = new Map();
  const startNode = {
    x: startCell.x, y: startCell.y, z: startCell.z,
    g: 0, f: navOctileHeuristic(startCell.x, startCell.y, startCell.z, goalCell.x, goalCell.y, goalCell.z),
    parent: undefined, closed: false, jump: false,
  };
  nodes.set(startKey, startNode);
  open.push(startNode);

  let expansions = 0;
  let bestNode = startNode;
  let bestScore = startNode.f;
  let goalNode;

  while (open.size > 0 && expansions < maxExpansions) {
    const current = open.pop();
    if (!current || current.closed) continue;
    current.closed = true;
    expansions++;

    if (current.x === goalCell.x && current.y === goalCell.y && current.z === goalCell.z) {
      goalNode = current;
      break;
    }
    const heuristic = navOctileHeuristic(current.x, current.y, current.z, goalCell.x, goalCell.y, goalCell.z);
    if (heuristic < bestScore) { bestScore = heuristic; bestNode = current; }
    // 隣接1マス以内まで来たら成功扱い（ゴールが壁の中でも詰まらない）
    if (heuristic <= 1.05) { goalNode = current; break; }

    for (const direction of NAV_DIRECTIONS) {
      const nx = current.x + direction.x;
      const nz = current.z + direction.z;
      if (direction.diagonal) {
        // 角抜け防止：両側の直線方向が通れる必要がある
        const sideA = navIsStandableCell(dimension, current.x + direction.x, current.y, current.z, cache);
        const sideB = navIsStandableCell(dimension, current.x, current.y, current.z + direction.z, cache);
        const clearA = navIsPassableBlock(navBlockAt(dimension, current.x + direction.x, current.y, current.z)) &&
                       navIsPassableBlock(navBlockAt(dimension, current.x + direction.x, current.y + 1, current.z));
        const clearB = navIsPassableBlock(navBlockAt(dimension, current.x, current.y, current.z + direction.z)) &&
                       navIsPassableBlock(navBlockAt(dimension, current.x, current.y + 1, current.z + direction.z));
        if (!(clearA && clearB) && !(sideA && sideB)) continue;
      }

      // 段差候補: +1(登り) / 0(平地) / -1..-maxFall(降下)
      for (let dy = 1; dy >= -maxFall; dy--) {
        const ny = current.y + dy;
        if (respectBoundary && !navIsInsideBoundaryCell(nx, ny, nz)) continue;
        const standable = navIsStandableCell(dimension, nx, ny, nz, cache);
        if (!standable) continue;
        if (standable === 2 && !allowWater) continue;
        if (dy === 1) {
          // 登るには自分の頭上2マス分の余裕が必要
          if (!navHasHeadroom(dimension, current.x, current.y + 1, current.z, 1)) continue;
        }
        let cost = direction.diagonal ? 1.42 : 1;
        if (dy === 1) cost += 0.7;
        else if (dy < 0) cost += Math.abs(dy) * 0.35;
        if (standable === 2) cost += 1.2; // 水中は遅い
        navRelax(open, nodes, current, nx, ny, nz, cost, goalCell, dy === 1);
        break; // 同じ方向では一番上の候補のみ採用
      }

      // ギャップジャンプ（直線方向のみ）
      if (!direction.diagonal && maxJumpGap >= 2) {
        for (let gap = 2; gap <= maxJumpGap; gap++) {
          const jx = current.x + direction.x * gap;
          const jz = current.z + direction.z * gap;
          let gapIsOpen = true;
          for (let step = 1; step < gap; step++) {
            const mx = current.x + direction.x * step;
            const mz = current.z + direction.z * step;
            if (navIsStandableCell(dimension, mx, current.y, mz, cache)) { gapIsOpen = false; break; }
            if (!navIsPassableBlock(navBlockAt(dimension, mx, current.y, mz)) ||
                !navIsPassableBlock(navBlockAt(dimension, mx, current.y + 1, mz))) { gapIsOpen = false; break; }
          }
          if (!gapIsOpen) continue;
          for (let dy = 0; dy >= -1; dy--) {
            const jy = current.y + dy;
            if (respectBoundary && !navIsInsideBoundaryCell(jx, jy, jz)) continue;
            if (!navIsStandableCell(dimension, jx, jy, jz, cache)) continue;
            if (!navHasHeadroom(dimension, current.x, current.y + 1, current.z, 1)) continue;
            navRelax(open, nodes, current, jx, jy, jz, gap * 1.15 + 0.5, goalCell, true);
            break;
          }
        }
      }
    }
  }

  const endNode = goalNode ?? bestNode;
  if (!endNode || endNode === startNode) return undefined;
  const waypoints = [];
  let cursor = endNode;
  while (cursor && cursor !== startNode) {
    waypoints.push({ x: cursor.x + 0.5, y: cursor.y, z: cursor.z + 0.5, jump: !!cursor.jump });
    cursor = cursor.parent;
  }
  waypoints.reverse();
  return { waypoints, complete: !!goalNode };
}

function navRelax(open, nodes, current, nx, ny, nz, cost, goalCell, jump) {
  const key = `${nx}|${ny}|${nz}`;
  const g = current.g + cost;
  const existing = nodes.get(key);
  if (existing) {
    if (existing.closed || existing.g <= g) return;
    existing.g = g;
    existing.f = g + navOctileHeuristic(nx, ny, nz, goalCell.x, goalCell.y, goalCell.z) * 1.12;
    existing.parent = current;
    existing.jump = jump;
    open.push(existing);
    return;
  }
  const node = {
    x: nx, y: ny, z: nz, g,
    f: g + navOctileHeuristic(nx, ny, nz, goalCell.x, goalCell.y, goalCell.z) * 1.12,
    parent: current, closed: false, jump,
  };
  nodes.set(key, node);
  open.push(node);
}

// ── Goal helpers ──
// 指定座標の近くで立てる場所を探す（ゴールが空中/壁の中の時に使う）
export function navFindStandableNear(dimension, location, radius = 3, verticalRadius = 4) {
  const cache = new Map();
  const baseX = Math.floor(location.x), baseY = Math.floor(location.y), baseZ = Math.floor(location.z);
  let best, bestScore = Number.POSITIVE_INFINITY;
  for (let dy = 0; dy <= verticalRadius; dy++) {
    for (const signedDy of dy === 0 ? [0] : [dy, -dy]) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const x = baseX + dx, y = baseY + signedDy, z = baseZ + dz;
          if (!navIsInsideBoundaryCell(x, y, z)) continue;
          if (!navIsStandableCell(dimension, x, y, z, cache)) continue;
          const score = Math.hypot(dx, dz) + Math.abs(signedDy) * 1.4;
          if (score < bestScore) { bestScore = score; best = { x: x + 0.5, y, z: z + 0.5 }; }
        }
      }
    }
    if (best) break; // できるだけ近い高さを優先
  }
  return best;
}

// 直線で歩いて行けるか（経路のショートカット判定に使用）
export function navHasWalkableLine(dimension, from, to, maxStepUp = 1, maxStepDown = 3) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const horizontal = Math.hypot(dx, dz);
  if (horizontal < 0.001) return Math.abs(to.y - from.y) < 0.01;
  const steps = Math.ceil(horizontal / 0.45);
  let previousY = from.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t, z = from.z + dz * t;
    const targetY = from.y + (to.y - from.y) * t;
    let found;
    for (let dy = maxStepUp; dy >= -maxStepDown; dy--) {
      const y = Math.floor(targetY) + dy;
      if (!navIsStandableCell(dimension, Math.floor(x), y, Math.floor(z))) continue;
      if (Math.abs(y - previousY) > Math.max(maxStepUp, maxStepDown)) continue;
      found = y;
      break;
    }
    if (found === undefined) return false;
    if (!navCanOccupy(dimension, { x, y: found, z })) return false;
    previousY = found;
  }
  return true;
}
