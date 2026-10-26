// 할 일의 종류: 띠에서 아이콘·글자 색을 달리해요.
export type TipKind = 'allow' | 'push' | 'go' | 'check' | 'risk' | 'other'
export type Tip = { kind: TipKind; text: string }

export type View =
  | { kind: 'working' }
  // 턴 도중 Claude 가 질문 창(AskUserQuestion)을 띄우고 답을 기다리는 중. question 은 첫 질문.
  | { kind: 'asking'; question: string }
  | { kind: 'checking'; turnId: string }
  | { kind: 'clear'; turnId: string }
  | { kind: 'tip'; tips: readonly Tip[]; turnId: string }
  | { kind: 'explaining'; tips: readonly Tip[]; turnId: string }
  | { kind: 'explained'; tips: readonly Tip[]; turnId: string; explanation: string }

export type TurnSummary = { prompt: string; tools: readonly string[]; answer: string }

// 끝난 턴의 모델·토큰·비용·시간: 띠의 '응답 완료' 제목 옆에 보여요. 모르는 값은 없음.
export type TurnStats = {
  turnId: string
  durationMs: number
  model?: string
  inputTokens?: number
  outputTokens?: number
  usd?: number
  // 메인 모델의 프롬프트 캐시가 식는 시각 ($.clock.now() 의 ms).
  cacheUntil?: number
  // 대화 기록에서 TTL 을 못 읽어 1시간으로 짐작했으면 true (띠에 '~' 표시).
  cacheTtlGuessed?: boolean
  // 이 턴의 첫 요청이 캐시를 이어 썼는지(true) 새로 썼는지(false).
  cacheHit?: boolean
  // 지난 턴의 만료 예상과 실제가 달랐으면: early = 예상보다 일찍 식음, late = 예상보다 오래 살아 있음.
  cacheSurprise?: 'early' | 'late'
  // 이 턴 끝에 turn-tip 이 팁을 찾느라 쓴 모델·토큰·비용 (답을 받은 뒤 채워져요).
  tip?: { model: string; tokens: number; usd: number }
}

declare module 'claude-code' {
  interface PluginState {
    'turn-tip': {
      view: View | null
      isHidden: boolean
      // '복사'를 눌러 팁·설명을 입력칸에 담아 보여 주는 중 (띠 글자는 드래그로 선택이 안 돼요).
      isCopying: boolean
      problem: string | null
      seen: readonly string[]
      // 이번 턴 앞의 턴들 (오래된 것부터, 최대 TURNS_KEPT - 1개).
      recent: readonly TurnSummary[]
      stats: TurnStats | null
    }
  }
}
