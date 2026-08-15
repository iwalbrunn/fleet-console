import { describe, expect, expectTypeOf, test } from 'vitest'
import { leererKnoten } from '../sessions'
import type {
  Anforderung as ServerAnforderung,
  FeedLine as ServerFeedLine,
  GraphNode as ServerGraphNode,
  NodeStatus as ServerNodeStatus,
  RollenBefund as ServerRollenBefund,
  RollenVerdict as ServerRollenVerdict,
  SessionState as ServerSessionState,
} from '../sessions'
import type {
  Anforderung,
  FeedLine,
  GraphNode,
  NodeStatus,
  RollenBefund,
  RollenVerdict,
  SessionState,
} from '../types'

describe('gemeinsame Session-Verträge', () => {
  test('Server und UI veröffentlichen dieselben Typen', () => {
    expectTypeOf<ServerAnforderung>().toEqualTypeOf<Anforderung>()
    expectTypeOf<ServerFeedLine>().toEqualTypeOf<FeedLine>()
    expectTypeOf<ServerGraphNode>().toEqualTypeOf<GraphNode>()
    expectTypeOf<ServerNodeStatus>().toEqualTypeOf<NodeStatus>()
    expectTypeOf<ServerRollenBefund>().toEqualTypeOf<RollenBefund>()
    expectTypeOf<ServerRollenVerdict>().toEqualTypeOf<RollenVerdict>()
    expectTypeOf<ServerSessionState>().toEqualTypeOf<SessionState>()
  })

  test('ein neuer Rollenknoten beginnt in einem neutralen Zustand', () => {
    expect(leererKnoten('senior-developer')).toEqual({
      id: 'senior-developer',
      status: 'idle',
      phase: '',
      tokensOut: 0,
      tokensIn: 0,
      anfragen: 0,
      calls: 0,
      order: null,
      auftrag: '',
      ergebnis: '',
      volltext: '',
      bericht: null,
      kostenUsd: 0,
      befunde: null,
      nachpruefungen: 0,
      quelle: null,
      startedAt: null,
      endedAt: null,
    })
  })
})
