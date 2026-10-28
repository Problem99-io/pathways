#!/usr/bin/env node
// Git merge driver for Pathways files: a three-way merge of JSON, field by
// field, so two people changing different fields of the same step (or goal,
// path, reference…) both keep their change. Lists of things with ids merge by
// id; lists of plain values (dependsOn, assignees) merge as sets. Only when both
// changed the very same field differently does one side win: the more recently
// updated one, else the change being merged in.
//
// Set up by the app in the workspace repo (.gitattributes `*.json merge=pathways`):
//   git config merge.pathways.driver "node <this file> %O %A %B"
// Exit 0 = merged (written to %A); 1 = can't merge, git falls back to a conflict.

import fs from 'node:fs'

const [baseFile, oursFile, theirsFile] = process.argv.slice(2)
const read = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return undefined
  }
}
const base = read(baseFile) // missing when both sides added the file
const ours = read(oursFile)
const theirs = read(theirsFile)
if (ours === undefined || theirs === undefined) process.exit(1)

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const byId = (list) => Array.isArray(list) && list.every((x) => isObj(x) && typeof x.id === 'string')
const plain = (list) => Array.isArray(list) && list.every((x) => x === null || typeof x !== 'object')

// a true clash goes to the side updated last, when both say when
const stamp = (v) => (isObj(v) && typeof v.updatedAt === 'string' ? v.updatedAt : '')
const winner = stamp(ours) > stamp(theirs) ? 'ours' : 'theirs'

function merge(o, a, b, w) {
  if (same(a, b)) return a
  if (same(o, a)) return b
  if (same(o, b)) return a
  if (isObj(a) && isObj(b)) {
    const oo = isObj(o) ? o : {}
    const out = {}
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const v = merge(oo[k], a[k], b[k], w)
      if (v !== undefined) out[k] = v
    }
    return out
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const oo = Array.isArray(o) ? o : []
    if (byId(a) && byId(b) && byId(oo)) return mergeById(oo, a, b, w)
    if (plain(a) && plain(b) && plain(oo)) {
      // a set: keep what either added, drop what either removed
      const removed = oo.filter((x) => !a.includes(x) || !b.includes(x))
      return [...new Set([...a, ...b])].filter((x) => !removed.includes(x))
    }
  }
  return w === 'ours' ? a : b
}

function mergeById(o, a, b, w) {
  const get = (list, id) => list.find((x) => x.id === id)
  const out = []
  for (const x of a) {
    const ob = get(o, x.id)
    const bx = get(b, x.id)
    if (!bx) {
      // they removed it: gone, unless we changed it meanwhile
      if (ob && same(ob, x)) continue
      out.push(x)
    } else out.push(merge(ob, x, bx, w))
  }
  for (const x of b) {
    if (get(a, x.id)) continue
    const ob = get(o, x.id)
    // we removed it: gone, unless they changed it meanwhile
    if (ob && same(ob, x)) continue
    out.push(x)
  }
  return out
}

const result = merge(base, ours, theirs, winner)
fs.writeFileSync(oursFile, JSON.stringify(result, null, 2) + '\n')
process.exit(0)
