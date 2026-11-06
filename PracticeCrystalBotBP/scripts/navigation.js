// ── Navigation ──
// ブロックグリッド上の A* 経路探索。
// [0.10.0] 改修ポイント:
//   1. すでに空いている道（既存の通路・階段・穴・段差）を最大限活かす:
//      - 掘りやブロック設置に頼る前に、広い範囲(maxExpansions=640, maxFall=6)で既存の通行可能ルートを探索する。
//      - 登り・進行時は斜め(diagonal)よりも直線(cardinal: X軸またはZ軸の4方向)を優先し、
//        特に段差登り(dy=+1)は直線4方向のみ許可（斜め段差ジャンプによる角引っかかり・斜め登りを根絶）。
//   2. 経路平滑化(string-pulling)を強化し、空いている直線通路をジグザグせず真っ直ぐ走り抜ける。

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

export const NAV_CARDINAL_DIRECTIONS = [
  { x: 1, z: 0 }, { x: -1, z: 0 },
  { x: 0, z: 1 }, { x: 0, z: -1 },
];

// [0.10.0] 任意の2Dベクトルを最も近い直線4方向(東/西/南/北)へスナップする。
// 「上に上がりたい時に斜めに掘ったり進んだりして引っかかる」現象を根絶するため、
// 階段掘りや段差登りは必ずこの直線4方向で行う。
export function navSnapToCardinal2D(dir) {
  const ax = Math.abs(dir?.x ?? 0);
  const az = Math.abs(dir?.z ?? 0);
  if (ax < 0.0001 && az < 0.0001) return { x: 1, y: 0, z: 0 };
  if (ax >= az) {
    return { x: (dir.x >= 0 ? 1 : -1), y: 0, z: 0 };
  }
  return { x: 0, y: 0, z: (dir.z >= 0 ? 1 : -1) };
}

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
  return (straight - diagonal) + diagonal * 1.41 + dy * 1.05;
}

// 周囲の空間の広さボーナス（壁際ギリギリより、既に空いている広い通路の中心を優先させる）
function navOpenSpacePenalty(dimension, x, y, z) {
  let walls = 0;
  for (const c of NAV_CARDINAL_DIRECTIONS) {
    if (!navIsPassableBlock(navBlockAt(dimension, x + c.x, y, z + c.z)) ||
        !navIsPassableBlock(navBlockAt(dimension, x + c.x, y + 1, z + c.z))) {
      walls++;
    }
  }
  // 既に空いている道（周囲が開けているセル）はペナルティ0、狭い壁際はわずかにコスト増
  return walls >= 3 ? 0.32 : walls === 2 ? 0.12 : 0;
}

/**
 * A* 経路探索。
 * [0.10.0] すでに空いている道・既存の階段・通路を最優先で見つけ出し、
 * 段差登り(dy=+1)や降り(dy<0)は直線4方向(cardinal)を優先する。
 * @returns {{ waypoints: {x,y,z}[], complete: boolean } | undefined}
 */
export function navFindPath(dimension, start, goal, options = {}) {
  const maxExpansions = Math.max(64, Math.floor(options.maxExpansions ?? 640));
  const maxFall = Math.max(1, Math.floor(options.maxFall ?? 6));
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
    parent: undefined, closed: false, jump: false, dirX: 0, dirZ: 0,
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
    if (heuristic <= 1.05 && Math.abs(current.y - goalCell.y) <= 1) { goalNode = current; break; }

    for (const direction of NAV_DIRECTIONS) {
      const nx = current.x + direction.x;
      const nz = current.z + direction.z;
      if (direction.diagonal) {
        // [0.10.0] 斜め移動は「両脇の直線セルが完全に空いていて歩ける平地」の時だけ許可する。
        // 片側でも壁や段差があると角に引っかかってスタックする主因になるため厳格化。
        const sideA = navIsStandableCell(dimension, current.x + direction.x, current.y, current.z, cache);
        const sideB = navIsStandableCell(dimension, current.x, current.y, current.z + direction.z, cache);
        if (!sideA || !sideB) continue;
      }

      // 段差候補: +1(登り) / 0(平地) / -1..-maxFall(降下)
      for (let dy = 1; dy >= -maxFall; dy--) {
        // [0.10.0] 上に上がる時(dy === 1)は斜め登りを禁止し、必ず直線4方向(cardinal)で上がる！
        if (dy === 1 && direction.diagonal) continue;
        // 2段以上の降下も直線4方向を優先（斜め落下による壁引っかかり防止）
        if (dy <= -2 && direction.diagonal) continue;

        const ny = current.y + dy;
        if (respectBoundary && !navIsInsideBoundaryCell(nx, ny, nz)) continue;
        const standable = navIsStandableCell(dimension, nx, ny, nz, cache);
        if (!standable) continue;
        if (standable === 2 && !allowWater) continue;
        if (dy === 1) {
          // 登るには自分の頭上2マス分の余裕が必要
          if (!navHasHeadroom(dimension, current.x, current.y + 1, current.z, 1)) continue;
        } else if (dy < 0) {
          // 降りる先の頭上も空いている必要がある
          if (!navIsPassableBlock(navBlockAt(dimension, nx, current.y + 1, nz))) continue;
        }

        let cost = direction.diagonal ? 1.48 : 1.0;
        // 直進継続ボーナス（無意味なジグザグを抑え、直線の通路・階段を真っ直ぐ進む）
        if ((current.dirX !== 0 || current.dirZ !== 0) &&
            (current.dirX !== direction.x || current.dirZ !== direction.z)) {
          cost += 0.08;
        }
        if (dy === 1) cost += 0.45; // 既存の階段・段差があるなら積極的に登る
        else if (dy < 0) cost += Math.abs(dy) * 0.28;
        if (standable === 2) cost += 1.2; // 水中は遅い
        cost += navOpenSpacePenalty(dimension, nx, ny, nz);

        navRelax(open, nodes, current, nx, ny, nz, cost, goalCell, dy === 1, direction.x, direction.z);
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
            navRelax(open, nodes, current, jx, jy, jz, gap * 1.15 + 0.5, goalCell, true, direction.x, direction.z);
            break;
          }
        }
      }
    }
  }

  const endNode = goalNode ?? bestNode;
  if (!endNode || endNode === startNode) return undefined;
  const rawWaypoints = [];
  let cursor = endNode;
  while (cursor && cursor !== startNode) {
    rawWaypoints.push({ x: cursor.x + 0.5, y: cursor.y, z: cursor.z + 0.5, jump: !!cursor.jump });
    cursor = cursor.parent;
  }
  rawWaypoints.reverse();

  // [0.10.0] 空いている直線通路のウェイポイントを間引き（String-pulling）、
  // 既に空いている道をカクつかずスムーズに直進できるようにする
  const waypoints = navSmoothWaypoints(dimension, start, rawWaypoints);
  return { waypoints, complete: !!goalNode };
}

function navSmoothWaypoints(dimension, start, rawWaypoints) {
  if (!rawWaypoints || rawWaypoints.length <= 2) return rawWaypoints;
  const smoothed = [];
  let anchor = { x: start.x, y: Math.floor(start.y + 0.001), z: start.z };
  let i = 0;
  while (i < rawWaypoints.length) {
    // ジャンプ必須点や段差登り点は省略せず残す（直線階段を確実に1段ずつ登るため）
    if (rawWaypoints[i].jump || Math.abs(rawWaypoints[i].y - anchor.y) >= 1) {
      smoothed.push(rawWaypoints[i]);
      anchor = rawWaypoints[i];
      i++;
      continue;
    }
    let furthest = i;
    const maxLookahead = Math.min(rawWaypoints.length - 1, i + 6);
    for (let j = maxLookahead; j > i; j--) {
      if (rawWaypoints[j].jump || Math.abs(rawWaypoints[j].y - anchor.y) >= 1) continue;
      if (navHasWalkableLine(dimension, anchor, rawWaypoints[j], 0, 1)) {
        furthest = j;
        break;
      }
    }
    smoothed.push(rawWaypoints[furthest]);
    anchor = rawWaypoints[furthest];
    i = furthest + 1;
  }
  return smoothed;
}

function navRelax(open, nodes, current, nx, ny, nz, cost, goalCell, jump, dirX = 0, dirZ = 0) {
  const key = `${nx}|${ny}|${nz}`;
  const g = current.g + cost;
  const existing = nodes.get(key);
  if (existing) {
    if (existing.closed || existing.g <= g) return;
    existing.g = g;
    existing.f = g + navOctileHeuristic(nx, ny, nz, goalCell.x, goalCell.y, goalCell.z) * 1.08;
    existing.parent = current;
    existing.jump = jump;
    existing.dirX = dirX;
    existing.dirZ = dirZ;
    open.push(existing);
    return;
  }
  const node = {
    x: nx, y: ny, z: nz, g,
    f: g + navOctileHeuristic(nx, ny, nz, goalCell.x, goalCell.y, goalCell.z) * 1.08,
    parent: current, closed: false, jump, dirX, dirZ,
  };
  nodes.set(key, node);
  open.push(node);
}

// ── [0.10.0] 既存の空いている道・階段入口の探索 ──
// ターゲットが高所や壁の向こうにいる時、いきなり掘ったり柱を積んだりするのではなく、
// 周囲に「すでに空いている登り口・通路・高所ルート」があるかを探し、A*で到達可能ならそこを経由する。
export function navFindOpenAscendingRoute(dimension, start, targetLocation, searchRadius = 10) {
  const cache = new Map();
  const baseX = Math.floor(targetLocation.x);
  const baseY = Math.floor(targetLocation.y);
  const baseZ = Math.floor(targetLocation.z);
  const startY = Math.floor(start.y + 0.001);

  const candidates = [];
  for (let dy = 1; dy >= -2; dy--) {
    const y = baseY + dy;
    if (y <= startY) continue;
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dz = -searchRadius; dz <= searchRadius; dz++) {
        const x = baseX + dx, z = baseZ + dz;
        if (!navIsInsideBoundaryCell(x, y, z)) continue;
        if (navIsStandableCell(dimension, x, y, z, cache) !== 1) continue;
        // 頭上が空いている既存の足場のみ
        if (!navIsPassableBlock(navBlockAt(dimension, x, y + 2, z))) continue;
        const distToTarget = Math.hypot(x + 0.5 - targetLocation.x, z + 0.5 - targetLocation.z);
        const distFromStart = Math.hypot(x + 0.5 - start.x, z + 0.5 - start.z);
        const score = distToTarget * 1.4 + distFromStart * 0.4 + Math.abs(y - baseY) * 1.2;
        candidates.push({ x: x + 0.5, y, z: z + 0.5, score });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  const topCandidates = candidates.slice(0, 4);
  for (const cand of topCandidates) {
    const path = navFindPath(dimension, start, cand, {
      maxExpansions: 520,
      maxFall: 5,
      maxJumpGap: 2,
    });
    if (path && path.complete && path.waypoints.length > 0) {
      return { goal: cand, path };
    }
  }
  return undefined;
}

// ── Goal helpers ──
// 指定座標の近くで立てる場所を探す（ゴールが空中/壁の中の時に使う）
export function navFindStandableNear(dimension, location, radius = 4, verticalRadius = 5) {
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
          // 既に周囲が開けている場所を優先
          const openBonus = navOpenSpacePenalty(dimension, x, y, z);
          const score = Math.hypot(dx, dz) + Math.abs(signedDy) * 1.3 + openBonus;
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
  const steps = Math.ceil(horizontal / 0.4);
  let previousY = Math.floor(from.y + 0.001);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t, z = from.z + dz * t;
    const targetY = from.y + (to.y - from.y) * t;
    // 体の幅(±0.28)でも壁に擦らないか確認（角引っかかりショートカット防止）
    if (!navCanOccupy(dimension, { x, y: previousY, z }, 0.26, 1.8)) {
      if (maxStepUp <= 0 || !navCanOccupy(dimension, { x, y: previousY + 1, z }, 0.26, 1.8)) {
        return false;
      }
    }
    let found;
    for (let dy = maxStepUp; dy >= -maxStepDown; dy--) {
      const y = Math.floor(targetY) + dy;
      if (!navIsStandableCell(dimension, Math.floor(x), y, Math.floor(z))) continue;
      if (y - previousY > maxStepUp || previousY - y > maxStepDown) continue;
      found = y;
      break;
    }
    if (found === undefined) return false;
    previousY = found;
  }
  return true;
}
