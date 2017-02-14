/* @flow */

import { last, removeInPlace, hash, clone, genUid, rearray, repeat, calculatePostfixLength, removeTail, calculatePrefixLength, substring, restring, all } from './utils.js'
import { map } from 'wu'
import { IOperator, IApplier, IInferrer } from './operations.js'


//

type Insert = string
type Remove = number // always negative
type Retain = number // always positive

type O = Insert | Remove | Retain

export function generateInsertion(pos: number, text: string): O[] {
  return [ retainOp(pos), insertOp(text) ]
}

export function generateDeletion(pos: number, n: number): O[] {
  return [ retainOp(pos), removeOp(n) ]
}

//


function removeOp(num: number): Remove {
  return - Math.abs(num)
}

function retainOp(o: number | string): Retain {
  if (typeof(o) === 'string') {
    return o.length
  } else {
    let num: number = o
    if (num < 0) {
      throw new Error('wat retains should be positive')
    }
    return num
  }
}

function insertOp(text: string): Insert {
  return text
}

function isRetain(op: O): boolean {
  return typeof(op) === 'number' && op >= 0
}

function isInsert(op: O): boolean {
  return typeof(op) === 'string'
}

function isRemove(op: O): boolean {
  return typeof(op) === 'number' && op < 0
}

function opSwitch<R>(
  op: O,
  f: {
    insert: (i: Insert) => R,
    retain: (i: Retain) => R,
    remove: (i: Remove) => R,
  }
): R {
  if (typeof(op) === 'string') { // insert
    let insert: Insert = op
    return f.insert(insert)

  } else if (typeof(op) === 'number' && op < 0) { // remove
    let remove: Remove = op
    return f.remove(remove)

  } else if (typeof(op) === 'number' && op >= 0) { // retain
    let retain: Retain = op
    return f.retain(retain)
  }

  throw new Error('wat unknown op', op)
}

function split(op: O, offset: number): [O, O] {
  return opSwitch(op, {
    insert: (insert: Insert) => {
      if (offset < 0 || offset > insert.length) {
        throw new Error()
      }
      return [
        insertOp(insert.substring(0, offset)),
        insertOp(insert.substring(offset))
      ]
    },
    remove: (remove: Remove) => {
      let num = length(remove)
      if (offset < 0 || offset > num) {
        throw new Error()
      }
      return [
        removeOp(offset),
        removeOp(num - offset)
      ]
    },
    retain: (retain: Retain) => {
      if (offset < 0 || offset > retain) {
        throw new Error()
      }
      return [
        retainOp(offset),
        retainOp(retain - offset)
      ]
    }
  })
}

function length(op: O): number {
  let l = opSwitch(op, {
    insert: (insert: Insert) => insert.length,
    remove: (remove: Remove) => - remove,
    retain: (retain: Retain) => retain
  })
  if (l < 0) {
    throw new Error('wat op has negative length', op)
  }
  return l
}

function joinInsert(insert0: Insert, op1: O): ?O {
  return opSwitch(op1, {
    insert: (insert1: Insert) => insertOp(insert0 + insert1),
    remove: () => undefined,
    retain: () => undefined
  })
}

function joinRetain(retain0: Retain, op1: O): ?O {
  return opSwitch(op1, {
    insert: () => undefined,
    retain: (retain1: Retain) => retainOp(retain0 + retain1),
    remove: () => undefined
  })
}

function joinRemove(remove0: Remove, op1: O): ?O {
  return opSwitch(op1, {
    insert: () => undefined,
    retain: () => undefined,
    remove: (remove1: Remove) => removeOp(remove0 + remove1)
  })
}

function join(op0: O, op1: O): ?O {
  return opSwitch(op0, {
    insert: insert => joinInsert(insert, op1),
    remove: remove => joinRemove(remove, op1),
    retain: retain => joinRetain(retain, op1)
  })
}

//

function simplify(ops: O[]): O[] {
  for (let i = 0; i < ops.length; i ++) {
    if (length(ops[i]) === 0) {
      removeInPlace(ops, i)
      i --
    }
  }

  for (let i = 1; i < ops.length; i ++) {
    let newOp = join(ops[i - 1], ops[i])
    if (newOp != null) {
      ops[i - 1] = newOp
      removeInPlace(ops, i) // remove extra op
      i --
    }
  }

  if (ops.length > 0 && isRetain(last(ops))) {
    ops.pop() // remove trailing retain
  }

  return ops
}

export class Operator {
  constructor() {
    (this: IOperator<O>)
  }
  _transformConsumeOps(a: ?O, b: ?O)
  : [[?O, ?O], [?O, ?O]] {
    // returns [[aP, bP], [a, b]]

    if (a != null && isInsert(a)) {
      return [
        [a, retainOp(a)],
        [undefined, b]
      ]
    }

    if (b != null && isInsert(b)) {
      return [
        [retainOp(b), b],
        [a, undefined]
      ]
    }

    // neither is null
    if (a != null && b != null) {
      let minLength = Math.min(length(a), length(b))

      let [aHead, aTail] = split(a, minLength)
      let [bHead, bTail] = split(b, minLength)

      if (length(aHead) === 0) { aHead = undefined }
      if (length(aTail) === 0) { aTail = undefined }
      if (length(bHead) === 0) { bHead = undefined }
      if (length(bTail) === 0) { bTail = undefined }

      if (isRetain(a) && isRetain(b)) {
        return [[aHead, bHead], [aTail, bTail]]
      }
      if (isRemove(a) && isRetain(b)) {
        return [[aHead, undefined], [aTail, bTail]]
      }
      if (isRetain(a) && isRemove(b)) {
        return [[undefined, bHead], [aTail, bTail]]
      }
      if (isRemove(a) || isRemove(b)) {
        return [[undefined, undefined], [aTail, bTail]] // both do the same thing
      }
      if (isInsert(a) || isInsert(b)) {
        throw new Error('wat, should be handled already')
      }
      throw new Error('wat')
    }

    // one is null
    if (a != null) { return [[a, undefined], [undefined, b]] }
    if (b != null) { return [[undefined, b], [a, undefined]] }

    throw new Error('wat')
  }
  transformNullable(clientOps: ?O[], serverOps: ?O[])
  : [?O[], ?O[]] {
    if (clientOps != null && serverOps != null) {
      let [newClientOps, newServerOps] = this.transform(clientOps, serverOps)
      return [newClientOps, newServerOps]
    } else {
      return [clientOps, serverOps]
    }
  }
  transform(clientOps: O[], serverOps: O[])
  : [O[], O[]] {
    let ops1 = clientOps
    let ops2 = serverOps

    let ops1P = []
    let ops2P = []

    let i1 = 0
    let i2 = 0

    let op1: ?O = undefined
    let op2: ?O = undefined

    while (true) {
      if (op1 == null) { op1 = ops1[i1]; i1++ }
      if (op2 == null) { op2 = ops2[i2]; i2++ }

      if (op1 == null && op2 == null) { break }

      if ((op1 != null && length(op1) <= 0)) {
        op1 = null;
        continue
      }

      if ((op2 != null && length(op2) <= 0)) {
        op2 = null;
        continue
      }

      let [[op1P, op2P], [newOp1, newOp2]] = this._transformConsumeOps(op1, op2)

      if (op1P != null) { ops1P.push(op1P) }
      if (op2P != null) { ops2P.push(op2P) }

      [op1, op2] = [newOp1, newOp2]
    }

    return [simplify(ops1P), simplify(ops2P)]
  }
  composeNullable (ops1: ?O[], ops2: ?O[])
  : ?O[] {
    if (ops1 != null && ops2 != null) {
      return this.compose(ops1, ops2)
    } else if (ops1 != null) {
      return ops1
    } else if (ops2 != null) {
      return ops2
    } else {
      return undefined
    }
  }
  _composeConsumeOps(a: ?O, b: ?O)
  : [?O, [?O, ?O]] {
    // returns [newOp, [a, b]]

    if (a != null && isRemove(a)) {
      return [a, [undefined, b]]
    }

    if (b != null && isInsert(b)) {
      return [b, [a, undefined]]
    }

    // neither op is null!
    if (a != null && b != null) {
      let minLength = Math.min(length(a), length(b))

      let [aHead, aTail] = split(a, minLength)
      let [bHead, bTail] = split(b, minLength)

      if (length(aHead) === 0) { aHead = undefined }
      if (length(aTail) === 0) { aTail = undefined }
      if (length(bHead) === 0) { bHead = undefined }
      if (length(bTail) === 0) { bTail = undefined }

      if (isRetain(a) && isRetain(b)) {
        return [aHead, [aTail, bTail]]
      }
      if (isInsert(a) && isRetain(b)) {
        return [aHead, [aTail, bTail]]
      }
      if (isRetain(a) && isRemove(b)) {
        return [bHead, [aTail, bTail]]
      }
      if (isInsert(a) && isRemove(b)) {
        return [undefined, [aTail, bTail]] // delete the inserted portion
      }
      if (isRemove(a) && isInsert(b)) {
        throw new Error('wat, should be handled already')
      }
      if (isRemove(a) && isRemove(b)) {
        throw new Error('wat, should be handled already')
      }
      if (isInsert(a) && isInsert(b)) {
        throw new Error('wat, should be handled already')
      }
      throw new Error('wat')
    }

    // one of the two ops is null!
    if (a != null) { return [a, [undefined, b]] }
    if (b != null) { return [b, [a, undefined]] }

    throw new Error('wat')
  }
  compose(ops1: O[], ops2: O[])
  : O[] {
    // compose (ops1, ops2) to composed s.t.
    // apply(apply(text, ops1), ops2) === apply(text, composed)

    // code borrowed from https://github.com/Operational-Transformation/ot.py/blob/master/ot/text_operation.py#L219

    let composed = []

    let i1 = 0
    let i2 = 0

    let op1: ?O = undefined
    let op2: ?O = undefined

    while (true) {
      if (op1 == null) { op1 = ops1[i1]; i1++ }
      if (op2 == null) { op2 = ops2[i2]; i2++ }

      if (op1 == null && op2 == null) { break }

      if ((op1 != null && length(op1) <= 0)) {
        op1 = null;
        continue
      }

      if ((op2 != null && length(op2) <= 0)) {
        op2 = null;
        continue
      }

      let [composedOp, [newOp1, newOp2]] = this._composeConsumeOps(op1, op2)

      if (composedOp != null) { composed.push(composedOp) }
      [op1, op2] = [newOp1, newOp2]
    }

    return simplify(composed)
  }
  composeMany(ops: Iterable<O[]>)
  : O[] {
    let composed: O[] = []
    for (let op of ops) {
      composed = this.compose(composed, op)
    }
    return composed
  }
}

//

interface IApplierDelegate<S> {
  initial(): S,
  stateHash(s: S): string,
  apply(state: S, ops: O[]): [S, O[]]
}

class DelegatingApplier<S> {
  delegate: IApplierDelegate<S>
  constructor(delegate: IApplierDelegate<S>) {
    (this: IApplier<O,S>)
    this.delegate = delegate
  }
  initial(): S {
    return this.delegate.initial()
  }
  stateHash(s: S): string {
    return this.delegate.stateHash(s)
  }
  apply(state: S, ops: O[]): [S, O[]] {
    return this.delegate.apply(state, ops)
  }
  applyNullable(state: S, ops: ?O[]): [S, ?O[]] {
    if (ops == null) {
      return [state, undefined]
    }
    let [newState, undo] = this.apply(state, ops)
    return [newState, undo]
  }
  applySimple(state: S, ops: O[]): S {
    let [newState, undo] = this.apply(state, ops)
    return newState
  }
  applyNullableSimple(state: S, ops: ?O[]): S {
    if (ops == null) {
      return state
    }
    let [newState, undo] = this.apply(state, ops)
    return newState
  }
}

class TextApplierDelegate {
  constructor() {
    (this: IApplierDelegate<string>)
  }
  initial(): string {
    return ''
  }
  stateHash(text: string): string {
    return text
  }
  apply(text: string, ops: O[])
  : [string, O[]] { // returns [state, undo]
    let i = 0
    let undo = []
    for (let op of ops) {
      opSwitch(op, {
        insert: (insert: Insert) => {
          undo.push(- insert.length)
          text = text.slice(0, i) + insert + text.slice(i)
          i += length(insert)
        },
        remove: (remove: Remove) => {
          let num = length(remove)
          if (i + num > text.length) { throw new Error('wat, trying to delete too much') }
          undo.push(text.slice(i, i + num))
          text = text.slice(0, i) + text.slice(i + num)
        },
        retain: (retain: Retain) => {
          undo.push(retain)
          i += length(retain)
        }
      })

      // make sure we didn't accidentally overshoot
      if (i > text.length) { throw new Error('wat, overshot') }
    }

    return [text, simplify(undo)]
  }
}

export class TextApplier extends DelegatingApplier<string> {
  constructor() {
    super(new TextApplierDelegate())
  }
}

export class TextInferrer {
  constructor() {
    (this: IInferrer<O, string>)
  }
  infer(oldText: string, newText: string)
  : ?O[] {
    if (oldText.length === newText.length) {
      // we have a no-op
      if (oldText === newText) {
        return undefined;
      }
    }

    if (newText.length === 0) {
      return [ - oldText.length ]
    }

    if (oldText.length === 0) {
      return [ newText ]
    }

    // or we have a selection being overwritten.
    let postfixLength = calculatePostfixLength(oldText, newText)
    let newTextLeftover = removeTail(newText, postfixLength)
    let oldTextLeftover = removeTail(oldText, postfixLength)
    let prefixLength = calculatePrefixLength(oldTextLeftover, newTextLeftover)

    let start = prefixLength
    let endOld = oldText.length - postfixLength
    let endNew = newText.length - postfixLength

    return [ // update
      start,
      - (endOld - start),
      restring(substring(newText, {start: start, stop: endNew}))
    ]
  }
}

//

export type CursorState = {start: number, end: number}

class CursorApplier {
  constructor() {}
  initial(): CursorState {
    return {start: 0, end: 0}
  }
  stateHash(state: CursorState): string {
    throw new Error('not implemented')
  }
  _adjustPosition(pos: number, ops: O[]): number {
    let i = 0
    for (let op of ops) {
      if (i >= pos) { break }

      opSwitch(op, {
        insert: (insert: Insert) => {
          i += length(insert)
          pos += length(insert)
        },
        remove: (remove: Remove) => {
          pos -= length(remove)
        },
        retain: (retain: Retain) => {
          i += length(retain)
        }
      })
    }
    return pos
  }
  apply(state: CursorState, ops: O[]): CursorState {
    return {
      start: this._adjustPosition(state.start, ops),
      end: this._adjustPosition(state.end, ops)
    }
  }
}

//

export type DocumentState = {cursor: CursorState, text: string}

class DocumentApplierDelegate {
  cursorApplier: CursorApplier
  textApplier: TextApplier

  constructor() {
    (this: IApplierDelegate<DocumentState>)
    this.cursorApplier = new CursorApplier() // no DI :()
    this.textApplier = new TextApplier()
  }
  initial(): DocumentState {
    return { cursor: this.cursorApplier.initial(), text: this.textApplier.initial() }
  }
  stateHash(state: DocumentState): string {
    return this.textApplier.stateHash(state.text)
  }
  apply(state: DocumentState, ops: O[]): [DocumentState, O[]] {
    let [text, undo] = this.textApplier.apply(state.text, ops)
    let cursor = this.cursorApplier.apply(state.cursor, ops)
    return [
      { cursor: cursor, text: text },
      undo
    ]
  }
}

export class DocumentApplier extends DelegatingApplier<DocumentState> {
  constructor() {
    super(new DocumentApplierDelegate())
  }
}
