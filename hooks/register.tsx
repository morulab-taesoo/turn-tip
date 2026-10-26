import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import type { Tip, TipKind, TurnStats, TurnSummary, View } from '../types'

const view = atom({ plugin: 'turn-tip', key: 'view' } as const, null)
const isHidden = atom({ plugin: 'turn-tip', key: 'isHidden' } as const, false)
const isCopying = atom({ plugin: 'turn-tip', key: 'isCopying' } as const, false)
const problem = atom({ plugin: 'turn-tip', key: 'problem' } as const, null)
// 이미 보여 준 팁: 세션 전용 ($.store 는 세션끼리 공유돼서 쓰지 않아요).
const seenTips = atom({ plugin: 'turn-tip', key: 'seen' } as const, [])
// 앞선 턴 요약: 다시 로드돼도 남게 $.state 에 둬요.
const recentTurns = atom({ plugin: 'turn-tip', key: 'recent' } as const, [])
const lastStats = atom({ plugin: 'turn-tip', key: 'stats' } as const, null)

export const NONE = 'NONE'
export const MAX_LENGTH = 120
export const SEEN_KEPT = 30
export const LOG_DIR = 'turn-tip'
export const LOG_PANE = 'turn-tip-log'
export const CLEAR_TEXT = '이번 턴에는 확인할 만한 것이 없어요'
export const CHECKING_TEXT = '확인할 것을 찾는 중…'
export const WORKING_TEXT = '응답이 끝나면 확인할 것을 찾아요'
// 질문 창이 떠 있는 동안은 턴이 끝나지 않아서 팁 대신 이 안내를 띄워요.
export const ASKING_TEXT = '질문에 답해 주세요'
export const QUESTION_KEPT = 100

// AskUserQuestion 입력에서 띠에 보일 첫 질문 (없거나 모양이 다르면 '').
export function firstQuestion(input: unknown): string {
  const questions = (input as { questions?: unknown } | null)?.questions
  const first = Array.isArray(questions) ? (questions[0] as { question?: unknown } | undefined)?.question : undefined
  if (typeof first !== 'string') return ''
  const extra = Array.isArray(questions) && questions.length > 1 ? ` 외 ${questions.length - 1}개` : ''
  return `${first.trim().slice(0, QUESTION_KEPT)}${extra}`
}
// 앱에 스피너 요소가 없어서, 타이머로 다시 그리며 글자를 돌려요.
// 응답 중과 확인 중을 스피너 모양·색으로 구분해요 (색은 테마를 따라가는 이름).
export const SPINNERS = {
  working: { frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], color: 'suggestion' },
  checking: { frames: ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'], color: 'claude' },
} as const
export const SPIN_MS = 120
export const SPIN_CELLS = 2
export const SPIN_LIMIT_MS = 30_000
// 턴 끝에서 팁을 기다리는 최대 시간.
export const TIP_WAIT_MS = 10_000
export const spinnerFrame = (now: number, kind: keyof typeof SPINNERS = 'working') => {
  const { frames } = SPINNERS[kind]
  return frames[Math.floor(now / SPIN_MS) % frames.length]
}
// 다시 그릴 때마다 버튼의 press 손잡이가 바뀌어서, 120ms 마다 그리면 데스크톱 클릭이 옛 손잡이로 가서 사라져요.
// 그래서 Svg 를 그리는 화면에서는 스스로 도는 SVG(SMIL)로 스피너를 그리고 타이머로 다시 그리지 않아요.
// SVG 는 테마 색 이름을 못 써서, 밝은·어두운 테마 양쪽에서 보이는 중간 색을 써요.
export const SVG_SPIN_COLOR = { working: '#4f8ef7', checking: '#d97757' } as const
export const spinnerSvg = (kind: keyof typeof SPINNERS) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14">` +
  `<circle cx="8" cy="8" r="6" fill="none" stroke="${SVG_SPIN_COLOR[kind]}" stroke-opacity="0.25" stroke-width="2"/>` +
  `<path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="${SVG_SPIN_COLOR[kind]}" stroke-width="2" stroke-linecap="round">` +
  `<animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="${kind === 'working' ? 0.9 : 1.4}s" repeatCount="indefinite"/>` +
  `</path></svg>`
export const logHeader = (sessionId: string) =>
  `# turn-tip 팁 기록\n\n세션 ${sessionId} 에서 턴이 끝날 때 띠에 뜬 팁과, '자세히'로 받은 설명이 쌓여요.\n`

export const ANSWER_KEPT = 1500
export const TOOLS_KEPT = 40
// 별칭('haiku')은 어느 모델이 답했는지 결과에 안 나와서, id 를 직접 적어요.
export const TIP_MODEL = 'claude-haiku-5-5'
// 팁 모델 단가 (100만 토큰당 달러, 입력·출력). 엔진이 호출별 비용을 안 알려 줘서 토큰으로 계산해요.
export const TIP_PRICE = { input: 0.1, output: 0.5 }
// 메인 모델의 프롬프트 캐시 유지 시간. 엔진은 알려 주지 않아서, 대화 기록에 남은 API 사용량에서 읽어요.
// 기록을 못 읽으면 Claude Code 기본값(1시간)으로 잡고, 띠에 '~' 를 붙여 추정임을 보여요.
export const CACHE_TTL_MS = 60 * 60 * 1000
export const TTL_MS = { '5m': 5 * 60 * 1000, '1h': 60 * 60 * 1000 } as const
// 기록 파일은 통째로만 읽을 수 있어서, 이보다 크면 읽지 않고 추정값을 써요.
export const TRANSCRIPT_READ_LIMIT = 30 * 1024 * 1024
const CACHE_CREATION_KEY = '"cache_creation":{'

// 대화 기록(jsonl)에서, 끝에서부터 캐시를 새로 쓴 가장 최근 응답의 TTL 을 찾아요.
// 캐시를 읽기만 한 응답은 0 이라 건너뛰어요 (읽기도 같은 TTL 로 캐시를 늘려요). 못 찾으면 undefined.
export function lastCacheTtl(transcript: string): '5m' | '1h' | undefined {
  let at = transcript.length
  for (let i = 0; i < 200; i++) {
    at = transcript.lastIndexOf(CACHE_CREATION_KEY, at - 1)
    if (at < 0) return undefined
    const body = transcript.slice(at, transcript.indexOf('}', at))
    const n = (key: string) => Number(new RegExp(`"${key}":(\\d+)`).exec(body)?.[1] ?? 0)
    if (n('ephemeral_1h_input_tokens') > 0) return '1h'
    if (n('ephemeral_5m_input_tokens') > 0) return '5m'
  }
  return undefined
}
export const TIP_SYSTEM =
  '답은 입력창 위 띠에 그대로 보여요. 사용자가 확인하거나 직접 해야 할 일을 "종류: 문장" 꼴로 한 줄에 하나씩, 또는 NONE 한 단어만 쓰세요. 생각·계획·설명·사과는 쓰지 마세요.'
export const MAX_TIPS = 3
// 종류마다 띠의 아이콘·글자 색 (색은 테마를 따라가는 이름), 그리고 모델에게 알려 줄 뜻.
export const TIP_KINDS: Record<TipKind, { icon: string; color: string; meaning: string }> = {
  allow: { icon: '🔑', color: 'permission', meaning: '훅·권한·보호 파일에 막혀 사용자의 허락·문구·결정을 기다림 → 무엇을 써 주면 되는지' },
  push: { icon: '⬆️', color: 'warning', meaning: '아직 하지 않은 마무리("푸시는 안 했어요", 커밋·배포·재시작·다시 불러오기 안 함) → 시킬지 정하기' },
  go: { icon: '▶️', color: 'success', meaning: '허락 없이 할 수 있는데 진행할지 물으며 멈춤 → 바로 진행하라고 답하면 됨' },
  check: { icon: '👀', color: 'suggestion', meaning: '사용자가 직접 실행할 명령, 화면에서 직접 볼 것, 아직 확인 못 한 결과' },
  risk: { icon: '⚠️', color: 'error', meaning: '되돌리기 어려운 변경이 있었거나 앞둠' },
  other: { icon: '📌', color: 'text', meaning: '위에 안 맞지만 사용자가 꼭 해야 할 일' },
}
const KIND_NAMES = Object.keys(TIP_KINDS) as TipKind[]
export const ANSWER_HEAD = 500
// 이번 턴을 포함해 읽는 턴 수. 앞선 턴은 줄여서 넘겨요.
export const TURNS_KEPT = 5
export const EARLIER_PROMPT_KEPT = 300
export const EARLIER_ANSWER_KEPT = 700

// 답변은 앞부분과 끝부분을 넘겨요 (해야 할 일·확인할 것은 보통 끝에 있어요).
export function answerPart(answer: string, head = ANSWER_HEAD, kept = ANSWER_KEPT): string {
  const text = answer.trim()
  if (text.length <= head + kept) return text
  return `${text.slice(0, head)}\n(…중략…)\n${text.slice(-kept)}`
}

// 앞선 턴은 요청과 답변 끝부분만 짧게 적어요.
export function earlierLines(earlier: readonly TurnSummary[]): string[] {
  if (earlier.length === 0) return []
  return [
    '앞선 턴들 (오래된 것부터, 줄여서):',
    ...earlier.flatMap((turn, i) => [
      `[${earlier.length - i}턴 전] 사용자 요청: ${turn.prompt.trim().slice(0, EARLIER_PROMPT_KEPT) || '(모름)'}`,
      `[${earlier.length - i}턴 전] 답변: ${answerPart(turn.answer, 0, EARLIER_ANSWER_KEPT) || '(없음)'}`,
    ]),
    '',
  ]
}

// Haiku 는 대화 기록을 못 보니, 최근 턴들의 요청·도구·답변을 요약해 넘겨요.
// 묻는 것: 기능 팁이 아니라, 사용자가 확인하거나 직접 해야 할 중요한 일.
export function askTip(seen: readonly string[], turn: TurnSummary, earlier: readonly TurnSummary[] = []): string {
  return [
    `아래는 Claude Code(데스크톱 앱 포함)에서 최근 ${earlier.length + 1}턴의 요약이에요. 마지막이 방금 끝난 이번 턴이에요.`,
    '',
    ...earlierLines(earlier),
    '이번 턴:',
    `사용자 요청: ${turn.prompt.trim().slice(0, ANSWER_KEPT) || '(모름)'}`,
    `쓴 도구: ${turn.tools.length > 0 ? turn.tools.join(' / ') : '(없음)'}`,
    `마지막 답변: ${answerPart(turn.answer) || '(없음)'}`,
    '',
    `이번 턴의 답변을 끝까지 읽고, 사용자가 다음에 해야 할 일을 급한 순서로 최대 ${MAX_TIPS}개 알려 주세요.`,
    ...(earlier.length > 0
      ? [
          '앞선 턴에서 사용자에게 남긴 할 일이 그 뒤 턴들에서 처리되지도, 사용자가 답하지도 않았다면 그것도 후보예요.',
          '이미 처리됐거나 사용자가 답한 일은 빼고, 이번 턴의 할 일이 있으면 그것을 먼저 고르세요.',
        ]
      : []),
    '종류는 이것들이에요 (답변 중간이나 끝에 묻혀 있어도 찾으세요):',
    ...KIND_NAMES.map(k => `- ${k}: ${TIP_KINDS[k].meaning}`),
    '답변에 이미 쓰인 요청이어도 사용자가 할 일이면 알려 주세요. 서로 다른 일은 줄을 나누고, 같은 일은 한 줄로 쓰세요.',
    '기능 소개·사용 팁·칭찬·작업 요약은 쓰지 마세요.',
    '한 줄에 하나씩 "종류: 문장" 꼴로 쓰세요 (예: "allow: …해 주세요"). 종류는 위의 영어 이름 그대로요.',
    '문장은 사용자 요청에 쓰인 언어로 80자 안쪽, 머리말·따옴표·마크다운 없이 쓰세요.',
    'Claude 가 할 일이 아니라 사용자가 할 일을 "~해 주세요" 꼴로 쓰세요.',
    '답변에 실제로 쓰인 것만 근거로 삼고, 답변에 없는 할 일을 지어내지 마세요. 답변 내용을 옮겨 쓰지도 마세요.',
    `위와 같은 일이 정말 없을 때(설명만 한 턴, 다 끝나고 확인까지 된 턴)만 ${NONE} 한 단어를 쓰세요.`,
    ...(seen.length > 0 ? ['이미 알려 준 것(같은 내용은 다시 쓰지 마세요):', ...seen.map(t => `- ${t}`)] : []),
  ].join('\n')
}

// 도구 호출을 "Read register.tsx" 처럼 짧게 적어요.
export function toolLine(e: { tool: string } & Record<string, unknown>): string {
  const pick = ['file_path', 'path', 'pattern', 'description', 'command', 'url', 'query']
    .map(k => e[k])
    .find((v): v is string => typeof v === 'string' && v.length > 0)
  const target = pick === undefined ? '' : ` ${pick.split(/[\\/]/).pop()?.slice(0, 60) ?? ''}`
  return `${e.tool}${target}`
}

// ── '응답 완료' 제목 옆 숫자 ──
export const DONE_TITLE = '응답 완료'

// "claude-opus-5-5" → "Opus 5.5". 모양이 다르면 받은 그대로.
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/.exec(id)
  if (m === null) return id
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] === undefined ? '' : `.${m[3]}`}`
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}초`
  const m = Math.floor(s / 60)
  return s % 60 === 0 ? `${m}분` : `${m}분 ${s % 60}초`
}

export const formatUsd = (usd: number) => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`)
// formatUsd 는 1센트 밑을 뭉뚱그려서, 팁 비용처럼 작은 값은 그대로 보여 줘요.
export const formatSmallUsd = (usd: number) => (usd >= 0.01 ? formatUsd(usd) : usd < 0.0001 ? '<$0.0001' : `$${usd.toFixed(4)}`)

// 끝난 턴에서 숫자를 모아요. 입력은 캐시로 읽고 쓴 것까지 합쳐요.
export function turnStats(
  e: { turnId: string; durationMs: number; usage?: { model: string; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } },
  usd: number | undefined,
): TurnStats {
  const u = e.usage
  return {
    turnId: e.turnId,
    durationMs: e.durationMs,
    ...(u === undefined
      ? {}
      : {
          model: u.model,
          inputTokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
          outputTokens: u.output_tokens,
        }),
    ...(usd === undefined || usd < 0 ? {} : { usd }),
  }
}

// 남은 시간: "59:12", 한 시간 이상이면 "1:00:00".
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

// 캐시가 식을 때까지 1초마다 띠를 다시 그려 남은 시간을 줄여요. 식으면 멈추고 '캐시 만료'로 한 번 더 그려요.
// (턴이 끝난 뒤의 다시 그리기는 타이머에서 해야 데스크톱 앱에 반영돼요.)
function cacheTicker($: EngineInterface, msLeft: number): { cancel: () => void } {
  const tick = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
  const end = $.clock.after(msLeft + 1000, () => {
    tick.cancel()
    $.ui.invalidate('ui.render')
  })
  return {
    cancel: () => {
      tick.cancel()
      end.cancel()
    },
  }
}

// 제목 옆에 붙일 조각들: 모델 · 토큰 · 비용 · 시간 · 캐시 남은 시간.
export function statsParts(s: TurnStats, now: number): string[] {
  return [
    ...(s.model === undefined ? [] : [modelName(s.model)]),
    ...(s.inputTokens === undefined || s.outputTokens === undefined
      ? []
      : [`입력 ${formatTokens(s.inputTokens)} · 출력 ${formatTokens(s.outputTokens)} tok`]),
    // 이번 턴 비용 / 세션 총 비용. 한쪽만 알면 그쪽만.
    ...(s.usd === undefined && s.sessionUsd === undefined
      ? []
      : [[s.usd === undefined ? '' : formatUsd(s.usd), s.sessionUsd === undefined ? '' : `총 ${formatUsd(s.sessionUsd)}`].filter(t => t !== '').join(' / ')]),
    formatDuration(s.durationMs),
    ...cachePart(s, now),
  ]
}

// 캐시 표시 한 조각: 아이콘 + 남은 시간. 🔗 이어 씀(이미 쌓인 캐시를 이어 씀), 🌱 새로 씀(캐시를 새로 심음),
// 뒤에 ❗ 가 붙으면 지난 턴의 만료 예상과 실제가 달랐다는 뜻이에요 (예: 🌱❗ = 예상보다 일찍 식음, 🔗❗ = 예상보다 오래 유지).
export function cachePart(s: TurnStats, now: number): string[] {
  const icon = s.cacheHit === undefined ? '' : `${s.cacheHit ? '🔗' : '🌱'}${s.cacheSurprise === undefined ? '' : '❗'}`
  const left =
    s.cacheUntil === undefined
      ? ''
      : now < s.cacheUntil
        ? `캐시 ${s.cacheTtlGuessed === true ? '~' : ''}${countdown(s.cacheUntil - now)}`
        : '캐시 만료'
  const text = [icon, left].filter(t => t !== '').join(' ')
  return text === '' ? [] : [text]
}

// 첫 요청의 입력 중 캐시에서 읽은 몫이 절반 이상이면 이어 쓴 걸로 봐요.
// (식었으면 대화 전체를 캐시에 새로 쓰고, 읽은 몫은 시스템 프롬프트 정도뿐이에요.)
export function isCacheHit(u: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): boolean {
  const all = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return all > 0 && u.cache_read_input_tokens / all >= 0.5
}

// 지난 턴의 만료 예상(prevUntil)과 이번 턴 시작 시각을 실제 결과와 견줘요.
export function cacheSurprise(prevUntil: number | undefined, startedAt: number, hit: boolean): 'early' | 'late' | undefined {
  if (prevUntil === undefined) return undefined
  const expectedHit = startedAt < prevUntil
  if (expectedHit === hit) return undefined
  return hit ? 'late' : 'early'
}

// 점검 모델 몫: "🔍 Haiku 5.5 · 3.1k tok · $0.0004".
// 띠 버튼은 아이콘만 그려요. 데스크톱 앱은 버튼 안쪽(children)이 아니라 label 을 그려서, label 에 아이콘을 넣어요.
export const ICONS = { explain: '💬', copy: '📋', log: '🕘', hide: '✕' } as const

export const MAIN_LABEL = '주 모델'
export const TIP_LABEL = '보조 모델'
export const tipStatsText = (tip: NonNullable<TurnStats['tip']>) =>
  `${modelName(tip.model)} · 팁 찾기 · ${formatTokens(tip.tokens)} tok · ${formatSmallUsd(tip.usd)}`

export function tipUsd(usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): number {
  const input = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  return (input * TIP_PRICE.input + usage.output_tokens * TIP_PRICE.output) / 1_000_000
}

export const tipsText = (tips: readonly Tip[]) => tips.map(t => t.text).join(' / ')

// ── 복사 ──
// 데스크톱 앱은 띠의 Text·Markdown 을 드래그로 선택하지 못하게 하고, $.ui.copy 도 원격 화면엔 아직 안 돼요.
// 입력칸(Input) 안의 글자는 선택·복사가 돼서, '복사'를 누르면 팁·설명을 입력칸에 담아 보여 줘요.
export const COPY_ROWS_MAX = 8

// 입력칸에 담을 글. 담을 게 없는 상태면 null.
export function copyText(v: View | null): string | null {
  if (v === null) return null
  if (v.kind === 'explained') return v.explanation
  if (v.kind === 'tip' || v.kind === 'explaining') return v.tips.map(t => `${TIP_KINDS[t.kind].icon} ${t.text}`).join('\n')
  return null
}

// 줄 수만큼 (긴 줄은 접혀서 한 줄 더), 최대 COPY_ROWS_MAX 줄.
export const copyRows = (text: string) =>
  Math.min(COPY_ROWS_MAX, text.split('\n').reduce((n, line) => n + 1 + Math.floor(line.length / 60), 0))

export function askExplain(tips: readonly Tip[]): string {
  // fork 는 이 글을 사용자 메시지 자리에 붙여 보내요. 모델이 사용자가 쓴 글로 착각하지 않게 밝혀 둬요.
  return [
    '[turn-tip 플러그인의 자동 요청] 이 글은 사용자가 쓴 게 아니에요. 사용자 대화창에는 보이지 않고,',
    '답은 입력창 위 띠에만 표시돼요.',
    '',
    '앞서 띠에 사용자가 확인할 것을 이렇게 보여 줬어요:',
    ...tips.map(t => `- ${t.text}`),
    '사용자가 띠의 \'자세히\' 버튼을 눌렀어요. 방금 이 세션에서 한 작업에 비추어, 각각 왜 확인해야 하는지,',
    '사용자가 정확히 무엇을 하면 되는지(명령·위치·순서), 하지 않으면 어떻게 되는지 설명해 주세요.',
    `대화에 쓰인 언어로, 굵은 제목 한 줄과 짧은 글머리표 ${tips.length > 1 ? '할 일마다 1~2개' : '3~5개'}, 150단어 안쪽으로 쓰세요.`,
    '설명만 쓰세요. 이 요청 자체나 플러그인·버튼·메시지가 들어온 경위에 대해서는 언급하지 마세요.',
  ].join('\n')
}

// 모델 답을 띠에 올릴 한 줄로 다듬어요. 올릴 게 없으면 null.
export function cleanTip(raw: string): string | null {
  const line = raw
    .split('\n')
    .map(s => s.trim())
    .find(s => s.length > 0)
  if (line === undefined) return null
  const text = line
    .replace(/^[-*•\s]+/, '')
    // "사용자가 직접 할 일:" 같은 머리말을 떼요.
    .replace(/^(사용자가?\s*)?(직접\s*|다음에\s*)?(해야\s*)?할\s*일\s*[:：]\s*/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/`+|\*\*/g, '')
    .trim()
  // "할 일은 없어요. NONE" 처럼 문장에 붙여 써도 없음으로 봐요.
  if (text.length === 0 || new RegExp(`\\b${NONE}\\b`).test(text.toUpperCase())) return null
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text
}

// 모델 답을 "종류: 문장" 줄들로 읽어요. 종류가 없거나 모르는 것이면 other. 올릴 게 없으면 빈 배열.
export function parseTips(raw: string): Tip[] {
  const tips: Tip[] = []
  for (const line of raw.split('\n')) {
    const bare = line.trim().replace(/^([-*•]|\d+[.)])\s*/, '')
    const tagged = /^\**([a-zA-Z]+)\**\s*[:：]\s*(.*)$/.exec(bare)
    const name = tagged?.[1].toLowerCase()
    const kind: TipKind = name !== undefined && name in TIP_KINDS ? (name as TipKind) : 'other'
    const text = cleanTip(tagged !== null && kind !== 'other' ? tagged[2] : bare)
    if (text === null || tips.some(t => t.text === text)) continue
    tips.push({ kind, text })
  }
  return tips.slice(0, MAX_TIPS)
}

export function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 기록 문서를 '## 시각' 단위로 잘라 최신이 위로 오게 뒤집어요 (머리말은 뺌).
export function newestFirst(text: string): string {
  const parts = text.split(/\n(?=## )/)
  const entries = parts.filter(part => part.startsWith('## '))
  return entries.reverse().map(part => part.trim()).join('\n\n---\n\n')
}

export const tipEntry = (at: string, tips: readonly Tip[]) =>
  `\n## ${at}\n${tips.map(t => `${TIP_KINDS[t.kind].icon} ${t.text}`).join('  \n')}\n`
export const explainEntry = (at: string, tip: string, explanation: string) =>
  `\n### ${at} 자세히 — ${tip}\n${explanation}\n`

// 턴이 끝난 뒤엔 앱이 띠를 다시 그리지 않아서, 타이머(자기 dispatch)에서도 다시 그려 달라고 해요.
export const REDRAW_AFTER_MS = [300, 1500] as const

function redraw($: EngineInterface) {
  $.ui.invalidate('ui.render')
  for (const ms of REDRAW_AFTER_MS) $.clock.after(ms, () => $.ui.invalidate('ui.render'))
}

// 대화 기록 파일에서 실제 캐시 TTL 을 읽어요. 경로를 모르거나, 너무 크거나, 못 읽으면 undefined.
async function readCacheTtl($: EngineInterface, transcriptPath: string | undefined): Promise<'5m' | '1h' | undefined> {
  if (transcriptPath === undefined) return undefined
  try {
    const stat = await $.fs.stat(transcriptPath)
    if (stat.kind !== 'file' || stat.size > TRANSCRIPT_READ_LIMIT) return undefined
    const text = await $.fs.read(transcriptPath)
    return typeof text === 'string' ? lastCacheTtl(text) : undefined
  } catch {
    return undefined
  }
}

// 이 세션이 지금까지 쓴 비용(달러). 엔진이 모르면 undefined.
async function sessionUsd($: EngineInterface): Promise<number | undefined> {
  try {
    return (await $.session.usage()).cost?.usd
  } catch {
    return undefined
  }
}

export const describe = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err))

// 어느 단계에서 무엇이 실패했는지 띠에 남겨요 (원인 찾기용).
async function report($: EngineInterface, step: string, err: unknown) {
  try {
    await update($, problem, () => `${step}: ${describe(err)}`.slice(0, 200))
    redraw($)
  } catch {
    return
  }
}

export type LogPlace = { transcriptPath?: string; root: string; home?: string; sessionId: string }

// 기록 위치: 그 세션의 자동 메모리(memory/)와 같은 ~/.claude/projects/<프로젝트>/ 아래 turn-tip/.
// 대화 기록 경로를 알면 그 폴더를, 모르면 Claude Code 와 같은 규칙으로 프로젝트 폴더 이름을 만들어요.
// 파일은 세션마다 따로: 대화 기록(<세션 id>.jsonl)과 같은 이름의 <세션 id>.md.
export function pickLogPath(place: LogPlace): string {
  const slash = (p: string) => p.split(String.fromCharCode(92)).join('/')
  if (place.transcriptPath !== undefined && place.transcriptPath.length > 0) {
    const t = slash(place.transcriptPath)
    const name = t.slice(t.lastIndexOf('/') + 1).replace(/\.jsonl$/, '')
    return `${t.slice(0, t.lastIndexOf('/'))}/${LOG_DIR}/${name}.md`
  }
  const slug = place.root.replace(/[^a-zA-Z0-9]/g, '-')
  return `${slash(place.home ?? '~')}/.claude/projects/${slug}/${LOG_DIR}/${place.sessionId}.md`
}

// 팁 기록 문서 끝에 덧붙여요. 실패해도 띠는 그대로 보여요.
async function appendLog($: EngineInterface, text: string, transcriptPath: string | undefined) {
  let step = 'place'
  try {
    const sessionId = await $.session.id()
    const path = pickLogPath({
      transcriptPath,
      root: await $.session.root(),
      home: (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')),
      sessionId,
    })
    step = 'fs.exists'
    const isThere = await $.fs.exists(path)
    step = 'fs.read'
    const before = isThere ? await $.fs.read(path) : logHeader(sessionId)
    step = 'fs.write'
    await $.fs.write(path, before + text)
  } catch (err) {
    await report($, `문서 ${step}`, err)
  }
}

// 팁을 받아 띠와 기록 문서에 올려요.
async function findTip($: EngineInterface, turnId: string, turn: TurnSummary, transcriptPath: string | undefined) {
  await update($, problem, () => null)
  const seen = await read($, seenTips)
  const earlier = await read($, recentTurns)
  // 묻기 전에 이번 턴을 쌓아 둬요 (모델이 실패해도 다음 턴에 읽혀요).
  await update($, recentTurns, before => [...before, turn].slice(-(TURNS_KEPT - 1)))
  const reply = await $.model.complete({
    model: TIP_MODEL,
    system: TIP_SYSTEM,
    prompt: askTip(seen, turn, earlier),
    effort: 'low',
    maxTokens: 1000,
  })
  if (!reply.isAnswered) {
    await update($, view, () => ({ kind: 'clear', turnId }))
    return report($, '팁 모델', reply.reason)
  }
  const { usage } = reply
  const tipCost = {
    model: TIP_MODEL,
    tokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens,
    usd: tipUsd(usage),
  }
  await update($, lastStats, s => (s?.turnId === turnId ? { ...s, tip: tipCost } : s))
  const tips = parseTips(reply.text)
  if (tips.length === 0) {
    // 지난 턴의 확인할 것이 이번 턴 것처럼 남지 않게 '없음'으로 바꿔 보여 줘요 (기록 문서에는 남아 있어요).
    await update($, view, () => ({ kind: 'clear', turnId }))
    await update($, isHidden, () => false)
    redraw($)
    return
  }
  const fresh: View = { kind: 'tip', tips, turnId }
  await update($, view, () => fresh)
  await update($, isHidden, () => false)
  redraw($)
  await update($, seenTips, before => [...before, ...tips.map(t => t.text)].slice(-SEEN_KEPT))
  await appendLog($, tipEntry(stamp(await $.clock.now()), tips), transcriptPath)
}

// ── 앱을 껐다 켜도 띠가 남게 ──
// $.state 는 다시 불러오기(/reload-plugins)만 버티고, 앱을 끄거나 쉬다가 세션 프로세스가 새로 뜨면 비어요.
// 그래서 띠 상태를 세션 id 별로 $.store 에 남겨 두고, 새로 뜬 세션에서 되살려요.
export const SAVE_PREFIX = 'band:'
export const SAVED_SESSIONS = 20
export type SavedBand = {
  view: View | null
  isHidden: boolean
  stats: TurnStats | null
  seen: readonly string[]
  recent: readonly TurnSummary[]
}

// 진행 중이던 상태는 이어 갈 수 없어서 바꿔요: 응답 중·확인 중은 비우고, 설명 받는 중은 팁으로.
export function restoredView(v: View | null): View | null {
  if (v === null || v.kind === 'working' || v.kind === 'asking' || v.kind === 'checking') return null
  if (v.kind === 'explaining') return { kind: 'tip', tips: v.tips, turnId: v.turnId }
  return v
}

async function persist($: EngineInterface) {
  try {
    const key = `${SAVE_PREFIX}${await $.session.id()}`
    const saved: SavedBand = {
      view: await read($, view),
      isHidden: await read($, isHidden),
      stats: await read($, lastStats),
      seen: await read($, seenTips),
      recent: await read($, recentTurns),
    }
    // 지웠다 다시 써서 최근 세션이 맨 뒤로 가게 하고, 오래된 세션 것은 지워요.
    await $.store.delete(key)
    await $.store.set(key, saved)
    const keys = (await $.store.keys()).filter(k => k.startsWith(SAVE_PREFIX))
    for (const old of keys.slice(0, -SAVED_SESSIONS)) await $.store.delete(old)
    await trace($, `저장 ${saved.view?.kind ?? 'null'}`)
  } catch (err) {
    await report($, '상태 저장', err)
  }
}

// 앱을 켤 때 무슨 일이 있었는지 $.store 'trace' 에 짧게 남겨요 (껐다 켠 뒤 띠가 안 뜨면 이걸 봐요).
export const TRACE_KEY = 'trace'
export const TRACE_KEPT = 30

// 읽고 덧붙여 쓰는 사이에 다른 trace 가 끼면 한쪽이 사라져서, 한 줄씩 차례로 써요.
let traceQueue: Promise<void> = Promise.resolve()

function trace($: EngineInterface, text: string): Promise<void> {
  traceQueue = traceQueue.then(async () => {
    try {
      const at = new Date(await $.clock.now()).toISOString()
      const sid = (await $.session.id()).slice(0, 8)
      const before = ((await $.store.get(TRACE_KEY)) as string[] | undefined) ?? []
      await $.store.set(TRACE_KEY, [...before, `${at} ${sid} ${text}`].slice(-TRACE_KEPT))
    } catch {
      return
    }
  })
  return traceQueue
}

// $.state 가 비어 있을 때만 (새 프로세스) 저장해 둔 띠를 되살려요. 무엇을 했는지 한 마디로 돌려줘요.
async function restore($: EngineInterface): Promise<string> {
  const now = await read($, view)
  if (now !== null || (await read($, lastStats)) !== null) return `있음(${now?.kind ?? 'stats'})`
  const saved = (await $.store.get(`${SAVE_PREFIX}${await $.session.id()}`)) as SavedBand | undefined
  if (saved === undefined) return '저장 없음'
  await update($, view, () => restoredView(saved.view))
  await update($, isHidden, () => saved.isHidden)
  await update($, lastStats, () => saved.stats)
  await update($, seenTips, () => saved.seen)
  await update($, recentTurns, () => saved.recent)
  return `되살림(${saved.view?.kind ?? 'null'}${saved.isHidden ? ', 닫힘' : ''})`
}

// 앱을 켠 직후엔 화면이 늦게 붙어서, 몇 초에 걸쳐 여러 번 다시 그려요.
export const WAKE_REDRAW_MS = [300, 1500, 5000, 15_000] as const

function wakeRedraw($: EngineInterface) {
  $.ui.invalidate('ui.render')
  for (const ms of WAKE_REDRAW_MS) $.clock.after(ms, () => $.ui.invalidate('ui.render'))
}

// 기록 창: 이 세션의 팁 기록 문서를 읽어요.
async function logText($: EngineInterface, transcriptPath: string | undefined): Promise<{ path: string; text: string }> {
  const path = pickLogPath({
    transcriptPath,
    root: await $.session.root(),
    home: (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')),
    sessionId: await $.session.id(),
  })
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  return { path, text }
}

export const register: Register = on => {
  // 이번 턴 요약 (모듈 변수라 다시 로드되면 비어요).
  let prompt = ''
  // 그 세션의 대화 기록 경로 (~/.claude/projects/<프로젝트>/<세션>.jsonl). 기록 위치를 정해요.
  let transcriptPath: string | undefined
  let tools: string[] = []

  on('classic.UserPromptSubmit', async ($, e, next) => {
    transcriptPath = e.transcript_path
    return next(e)
  })

  // 스피너: 채팅을 보낸 순간부터 확인이 끝날 때까지 돌아요.
  let spin: Timer | undefined
  let limit: Timer | undefined
  // 글자 스피너를 그린 화면(터미널)이 있을 때만 타이머로 다시 그려요. SVG 스피너는 스스로 돌아요.
  let drawsTextSpinner = false
  // 띠를 마지막으로 그린 조건 (바뀔 때만 trace 에 남겨요).
  let lastRender = ''
  const stopSpin = () => {
    spin?.cancel()
    limit?.cancel()
    spin = undefined
    limit = undefined
  }

  // 턴 비용 = 끝날 때 세션 누계 − 시작할 때 누계 (엔진은 세션 누계만 알려 줘요). 모르면 undefined.
  let costBase: number | undefined
  // 캐시 확인: 턴 첫 요청의 사용량, 턴 시작 시각, 지난 턴이 예상한 만료 시각.
  let firstStep: { turnId: string; hit: boolean } | undefined
  let startedAt: number | undefined
  let prevCacheUntil: number | undefined
  // 캐시 남은 시간을 1초마다 줄이는 타이머 (턴마다 새로).
  let cacheTick: { cancel: () => void } | undefined

  // 다시 불렸을 때(/reload-plugins) 모듈 변수는 비지만 $.state 는 남아요: 캐시가 살아 있으면 카운트다운을 다시 돌려요.
  // 앱을 껐다 켜서 새 프로세스면 $.state 도 비어서, $.store 에 남긴 띠를 먼저 되살려요.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      await trace($, `session.start ${await restore($)}`)
    } catch (err) {
      await trace($, `session.start 실패 ${describe(err)}`)
      await report($, '상태 되살리기', err)
    }
    wakeRedraw($)
    const until = (await read($, lastStats))?.cacheUntil
    const now = await $.clock.now()
    if (until !== undefined && until > now) {
      prevCacheUntil = until
      cacheTick = cacheTicker($, until - now)
    }
    return result
  })

  // 데스크톱 화면은 session.start 보다 늦게 붙어요: 붙을 때 한 번 더 되살리고 다시 그려요.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    try {
      await trace($, `session.attach ${e.surface} ${await restore($)}`)
    } catch (err) {
      await trace($, `session.attach 실패 ${describe(err)}`)
    }
    wakeRedraw($)
    return result
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId === undefined && e.index === 0 && result.usage !== null) {
      firstStep = { turnId: e.turnId, hit: isCacheHit(result.usage) }
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta !== true) {
      prompt = e.text
      tools = []
      costBase = await sessionUsd($)
      startedAt = await $.clock.now()
      prevCacheUntil = (await read($, lastStats))?.cacheUntil ?? prevCacheUntil
      await update($, lastStats, () => null)
      // 이전 턴의 문구가 이번 턴 것처럼 보이지 않게 바로 바꿔요.
      await update($, view, () => ({ kind: 'working' }))
      await update($, isHidden, () => false)
      await update($, isCopying, () => false)
      $.ui.invalidate('ui.render')
      await persist($)
      stopSpin()
      spin = $.clock.every(SPIN_MS, () => {
        if (drawsTextSpinner) $.ui.invalidate('ui.render')
      })
    }
    return next(e)
  })

  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined && tools.length < TOOLS_KEPT) {
      tools.push(toolLine(e as unknown as { tool: string } & Record<string, unknown>))
    }
    return next(e)
  })

  // 질문 창은 턴 안의 도구라 turn.complete 가 오지 않아요: 창이 떠 있는 동안 띠에 안내를 띄워요.
  // next(e) 가 질문 창을 띄우고 답을 받을 때(또는 닫힐 때) 끝나요.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await update($, view, () => ({ kind: 'asking', question: firstQuestion(e) }))
    await update($, isHidden, () => false)
    $.ui.invalidate('ui.render')
    void trace($, '질문 창')
    try {
      return await next(e)
    } finally {
      await update($, view, v => (v?.kind === 'asking' ? { kind: 'working' } : v))
      $.ui.invalidate('ui.render')
    }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // 메인 대화의 정상 종료만 봐요 (하위 에이전트·중단된 턴 제외).
    if (e.agentId !== undefined) return result
    if (e.isAborted) {
      // 멈춘 턴은 확인하지 않아요: 스피너를 멈추고 띠를 비워요.
      stopSpin()
      await update($, view, () => null)
      $.ui.invalidate('ui.render')
      await persist($)
      return result
    }

    const usdNow = await sessionUsd($)
    const stats = turnStats(e, costBase === undefined || usdNow === undefined ? undefined : usdNow - costBase)
    if (usdNow !== undefined) stats.sessionUsd = usdNow
    // 요청이 있었던 턴만: 마지막 요청(턴 끝)부터 캐시가 유지돼요. 식으면 '캐시 만료'로 다시 그려요.
    if (firstStep?.turnId === e.turnId) {
      stats.cacheHit = firstStep.hit
      const surprise = startedAt === undefined ? undefined : cacheSurprise(prevCacheUntil, startedAt, firstStep.hit)
      if (surprise !== undefined) stats.cacheSurprise = surprise
    }
    if (e.usage !== undefined) {
      const ttl = await readCacheTtl($, transcriptPath)
      const ttlMs = ttl === undefined ? CACHE_TTL_MS : TTL_MS[ttl]
      if (ttl === undefined) stats.cacheTtlGuessed = true
      stats.cacheUntil = (await $.clock.now()) + ttlMs
      prevCacheUntil = stats.cacheUntil
      cacheTick?.cancel()
      cacheTick = cacheTicker($, ttlMs)
    }
    await update($, lastStats, () => stats)
    costBase = usdNow
    await update($, view, () => ({ kind: 'checking', turnId: e.turnId }))
    await update($, isHidden, () => false)
    $.ui.invalidate('ui.render')
    spin ??= $.clock.every(SPIN_MS, () => {
      if (drawsTextSpinner) $.ui.invalidate('ui.render')
    })
    limit?.cancel()
    limit = $.clock.after(SPIN_LIMIT_MS, stopSpin)
    const finding = findTip($, e.turnId, { prompt, tools: [...tools], answer: e.answer }, transcriptPath)
      .catch(err => report($, '팁 받기', err))
      .finally(() => {
        stopSpin()
        return persist($)
      })
    // 데스크톱 앱은 턴이 끝나는 순간에만 띠를 그리러 와요 (그 뒤 상태를 바꾸거나 invalidate 해도 안 와요).
    // 그래서 팁을 받을 때까지 턴 끝을 잠깐 미뤄요. 너무 오래 걸리면 기다리지 않고 끝내요.
    await Promise.race([finding, new Promise<void>(resolve => $.clock.after(TIP_WAIT_MS, resolve))])

    return result
  })

  on('ui.render', { component: 'Pane', requestId: LOG_PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    let shown
    try {
      const { path, text } = await logText($, transcriptPath)
      const body = newestFirst(text)
      shown = (
        <Box width="100%" flexDirection="column" gap="sm">
          <Text key="path" size="footnote" dimColor>{path}</Text>
          {body.length === 0 ? (
            <Text key="empty" dimColor>아직 이 세션에 쌓인 팁이 없어요.</Text>
          ) : (
            <Markdown key="log" text={body} />
          )}
        </Box>
      )
    } catch (err) {
      shown = <Text key="error" dimColor>기록을 못 읽었어요: {describe(err)}</Text>
    }
    return (
      <Box width="100%" flexDirection="column" gap="sm">
        {shown}
        <Box width="100%" justifyContent="flex-end">
          <Button key="log-close" role="dismiss" label="닫기" onPress={() => $.ui.close({ id: LOG_PANE })} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, view)
    const issue = await read($, problem)
    // 띠가 안 뜰 때 원인을 찾으려고, 그리러 온 화면·상태가 바뀔 때마다 trace 에 한 줄 남겨요.
    const seenAs = `render ${e.surface} survey=${e.props.hasSurvey} working=${e.props.isWorking} view=${current?.kind ?? 'null'} hidden=${await read($, isHidden)}`
    if (seenAs !== lastRender) {
      lastRender = seenAs
      void trace($, seenAs)
    }
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Input, Markdown, Svg, Text } = $.ui.resolve(e)
    const warning = issue === null ? null : <Text key="problem" size="footnote" dimColor>turn-tip · {issue}</Text>
    // '응답 완료' 제목과 그 턴의 숫자 (응답이 끝난 뒤의 상태에서만).
    const stats = await read($, lastStats)
    const isDone = stats !== null && current !== null && current.kind !== 'working' && current.kind !== 'asking' && current.turnId === stats.turnId
    // 숫자는 모델마다 한 줄: 주 모델(대화)과 보조 모델(팁 찾기). 제목 줄엔 버튼만 있어서 숫자가 띠 폭을 다 써요.
    const statsLine = (key: string, name: string, text: string) => (
      <Text key={key} size="footnote" dimColor>
        {name}  {text}
      </Text>
    )
    const statsLines =
      !isDone || stats === null
        ? null
        : [
            statsLine('done-stats', MAIN_LABEL, statsParts(stats, await $.clock.now()).join(' · ')),
            stats.tip === undefined ? null : statsLine('tip-stats', TIP_LABEL, tipStatsText(stats.tip)),
          ]
    const header = (buttons: RenderChildren = null) =>
      !isDone && buttons === null ? null : (
        <Box width="100%" flexDirection="column">
          <Box width="100%" columnGap="sm" alignItems="center">
            <Box flexGrow={1} flexShrink={1}>
              {isDone ? <Text key="done-title" weight="bold">✅ {DONE_TITLE}</Text> : null}
            </Box>
            {buttons === null ? null : (
              <Box flexShrink={0} columnGap="xs" alignItems="center">
                {buttons}
              </Box>
            )}
          </Box>
          {statsLines}
        </Box>
      )
    const title = header()
    // 팁이 없거나 닫았어도 오류는 보여요.
    if (current === null || (await read($, isHidden))) {
      return warning ?? next(e)
    }

    const hide = (
      <Button
        key="hide"
        role="dismiss"
        label={ICONS.hide}
        onPress={async () => {
          await update($, isHidden, () => true)
          await update($, isCopying, () => false)
          $.ui.invalidate('ui.render')
          await persist($)
        }}
      />
    )
    const openLog = (
      <Button
        key="log"
        variant="secondary"
        hotkey="r"
        label={ICONS.log}
        onPress={() => $.ui.open({ id: LOG_PANE, title: '팁 기록', focus: true, closeOnEscape: true })}
      />
    )
    const toCopy = copyText(current)
    const setCopying = (isOn: boolean) => async () => {
      await update($, isCopying, () => isOn)
      $.ui.invalidate('ui.render')
    }
    const copy =
      toCopy === null ? null : (
        <Button key="copy" variant="secondary" hotkey="c" label={ICONS.copy} onPress={setCopying(true)} />
      )
    if (toCopy !== null && (await read($, isCopying))) {
      // 팁 자리가 입력칸이 돼요. 입력칸이 옆에 제 '완료'(Enter)를 그려서, 제목 줄엔 완료 버튼을 따로 두지 않아요.
      // Input 은 폭을 못 정해서 세로 Box 바로 아래에 둬야 띠 폭을 다 써요 (가로 Box 면 글자 폭으로 찌그러져요).
      return (
        <Box width="100%" flexDirection="column" gap="xs">
          {header([openLog, hide])}
          <Input key="copy-field" value={toCopy} rows={copyRows(toCopy)} autoFocus submitLabel="완료" onSubmit={setCopying(false)} />
          {warning}
        </Box>
      )
    }

    if (current.kind === 'asking') {
      return (
        <Box width="100%" flexDirection="column" gap="xs">
          <Box width="100%" columnGap="sm" alignItems="center">
            <Box flexGrow={1} flexShrink={1} flexDirection="column">
              <Text key="asking" weight="bold" color="permission">❓ {ASKING_TEXT}</Text>
              {current.question === '' ? null : (
                <Text key="question" size="footnote" dimColor>{current.question}</Text>
              )}
            </Box>
            <Box flexShrink={0}>{openLog}</Box>
          </Box>
          {warning}
        </Box>
      )
    }

    if (current.kind === 'working' || current.kind === 'checking') {
      const isSvg = Svg !== undefined
      if (!isSvg) drawsTextSpinner = true
      return (
        <Box width="100%" flexDirection="column" gap="xs">
          {title}
          <Box width="100%" columnGap="sm" alignItems="center">
            {/* 글자마다 폭이 달라 문장이 밀리지 않게, 스피너는 폭이 고정된 칸에 넣어요. */}
            <Box width={SPIN_CELLS} flexShrink={0} justifyContent="center">
              {isSvg ? (
                <Svg key="spinner" source={spinnerSvg(current.kind)} alt="…" width={14} height={14} isInteractive />
              ) : (
                <Text key="spinner" color={SPINNERS[current.kind].color}>
                  {spinnerFrame(await $.clock.now(), current.kind)}
                </Text>
              )}
            </Box>
            <Box flexGrow={1}>
              <Text key="checking" color={SPINNERS[current.kind].color}>
                {current.kind === 'working' ? WORKING_TEXT : CHECKING_TEXT}
              </Text>
            </Box>
            <Box flexShrink={0}>{openLog}</Box>
          </Box>
          {warning}
        </Box>
      )
    }

    if (current.kind === 'clear') {
      return (
        <Box width="100%" flexDirection="column" gap="xs">
          {header([openLog, hide])}
          <Text key="clear" dimColor>✓ {CLEAR_TEXT}</Text>
          {warning}
        </Box>
      )
    }

    if (current.kind === 'explained') {
      return (
        <Box width="100%" flexDirection="column" gap="sm">
          {header([copy, openLog, hide])}
          <Markdown key="explanation" text={current.explanation} />
          {warning}
        </Box>
      )
    }

    // 예전 모양(text 한 줄)으로 남은 상태는 그리지 않아요.
    if (!Array.isArray(current.tips)) return warning ?? next(e)

    const explain = async () => {
      const { tips } = current
      const back = async () => {
        await update($, view, () => ({ kind: 'tip', tips, turnId: current.turnId }))
        $.ui.invalidate('ui.render')
      }
      await update($, problem, () => null)
      await update($, view, () => ({ kind: 'explaining', tips, turnId: current.turnId }))
      $.ui.invalidate('ui.render')
      let reply
      try {
        reply = await $.model.fork({ prompt: askExplain(tips) })
      } catch (err) {
        await back()
        return report($, '설명 fork 예외', err)
      }
      const explanation = reply.isAnswered ? reply.text.trim() : ''
      if (explanation.length === 0) {
        await back()
        return report($, '설명 fork', reply.isAnswered ? 'empty' : reply.reason)
      }
      await update($, view, v =>
        v?.turnId === current.turnId ? { kind: 'explained', tips, turnId: current.turnId, explanation } : v,
      )
      $.ui.invalidate('ui.render')
      await persist($)
      await appendLog($, explainEntry(stamp(await $.clock.now()), tipsText(tips), explanation), transcriptPath)
    }

    return (
      <Box width="100%" flexDirection="column" gap="xs">
        {header([
          current.kind === 'explaining' ? (
            <Text key="explaining" size="footnote" dimColor>설명 받는 중…</Text>
          ) : (
            <Button key="explain" variant="primary" hotkey="d" label={ICONS.explain} onPress={explain} />
          ),
          copy,
          openLog,
          hide,
        ])}
        {/* 할 일마다 한 줄: 종류에 따라 아이콘·글자 색이 달라요. */}
        {current.tips.map((tip, i) => (
          <Text key={`tip-${i}`} color={TIP_KINDS[tip.kind].color}>
            {TIP_KINDS[tip.kind].icon} <Text weight="medium" color={TIP_KINDS[tip.kind].color}>{tip.text}</Text>
          </Text>
        ))}
        {warning}
      </Box>
    )
  })
}
