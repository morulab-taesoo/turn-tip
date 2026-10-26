import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  askTip,
  cleanTip,
  formatDuration,
  formatTokens,
  formatUsd,
  modelName,
  newestFirst,
  parseTips,
  pickLogPath,
  restoredView,
  copyText,
  copyRows,
  firstQuestion,
  type SavedBand,
  spinnerFrame,
  cacheSurprise,
  countdown,
  isCacheHit,
  lastCacheTtl,
  formatSmallUsd,
  statsParts,
  tipUsd,
  TIP_KINDS,
  toolLine,
  turnStats,
} from './register'

const BAND = {
  plugin: 'turn-tip',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const USAGE = { input_tokens: 800, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const TIP = '/clear 로 대화를 비우면 토큰을 아껴요'
const EXPLANATION = '**/clear 쓰는 법**\n- 새 주제로 넘어갈 때 써요'

const settle = async () => {
  for (let i = 0; i < 20000; i++) await Promise.resolve()
}

// 엔진 밑바닥: 턴 종료·그리기·파일·모델을 메모리로 흉내 내요.
function world(on: On, tip = TIP, stored: Record<string, unknown> = {}) {
  const files = new Map<string, string>()
  const prompts: string[] = []
  // $.store: 시험에서 저장된 값을 들여다보게 Map 으로 흉내 내요.
  const store = new Map(Object.entries(stored))
  on('store.get', async (_, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', async (_, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined } as never
  })
  on('store.delete', async (_, e) => {
    store.delete(e.key)
    return { value: undefined } as never
  })
  on('store.keys', async () => ({ value: [...store.keys()] }) as never)
  mock.clock(on, { now: Date.UTC(2026, 9, 16, 12, 0) })
  mock.env(on, { USERPROFILE: 'C:/Users/t' })
  on('session.root', async () => ({ value: 'D:/MoruLab' }) as never)
  on('session.id', async () => ({ value: 's-test' }) as never)
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  // 엔진이 경로를 OS 식(\)으로 바꿔 넘겨서, 비교하기 쉽게 / 로 맞춰요.
  const key = (path: string) => path.split(String.fromCharCode(92)).join('/')
  on('fs.exists', async (_, e) => ({ value: files.has(key(e.path)) }) as never)
  on('fs.read', async (_, e) => ({ value: files.get(key(e.path)) ?? '' }) as never)
  on('fs.write', async (_, e) => {
    files.set(key(e.path), e.text)
    return { value: null } as never
  })
  // 턴 끝 팁은 Haiku(model.complete), '자세히' 설명은 fork 로 받아요.
  on('model.complete', async (_, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: tip, usage: USAGE } } as never
  })
  on('model.fork', async () => ({ value: { isAnswered: true, text: EXPLANATION, usage: USAGE } }) as never)
  const log = () => [...files.entries()].find(([k]) => k === 'C:/Users/t/.claude/projects/D--MoruLab/turn-tip/s-test.md')?.[1]
  return { files, prompts, log, store }
}

test('cleanTip 은 첫 줄만 다듬고 NONE 은 버려요', async () => {
  expect(cleanTip('- "Ctrl+J 로 줄바꿈해요"\n두 번째 줄')).toBe('Ctrl+J 로 줄바꿈해요')
  expect(cleanTip('NONE')).toBe(null)
  expect(cleanTip('위치를 알려 드렸고 할 일은 없어요. NONE')).toBe(null)
  expect(cleanTip('   \n  ')).toBe(null)
  expect(cleanTip('가'.repeat(200))?.length).toBe(120)
  expect(askTip(['이전 팁'], { prompt: '', tools: [], answer: '' })).toContain('- 이전 팁')
  expect(toolLine({ tool: 'Read', file_path: String.raw`C:\a\b\register.tsx` })).toBe('Read register.tsx')
  expect(toolLine({ tool: 'TodoWrite' })).toBe('TodoWrite')
  expect([spinnerFrame(0), spinnerFrame(120), spinnerFrame(1200)]).toEqual(['⠋', '⠙', '⠋'])
  expect([spinnerFrame(0, 'checking'), spinnerFrame(120, 'checking'), spinnerFrame(600, 'checking'), spinnerFrame(1200, 'checking')]).toEqual(['·', '✢', '✽', '·'])
  expect(newestFirst('# 머리\n\n## 1시\n하나\n\n## 2시\n둘\n')).toBe('## 2시\n둘\n\n---\n\n## 1시\n하나')
  expect(newestFirst('# 머리만\n')).toBe('')
  expect(cleanTip('터미널에서 `claude plugin test` 를 **직접** 실행해 주세요')).toBe('터미널에서 claude plugin test 를 직접 실행해 주세요')
  expect(cleanTip('사용자가 직접 할 일: 푸시할지 정해 주세요')).toBe('푸시할지 정해 주세요')
})

// 답변 끝에 묻힌 '푸시 안 함'·'허락 필요'·'진행할까요' 를 놓치지 않게 프롬프트가 짚어 줘요.
test('askTip 은 안 한 마무리·허락 대기·괜한 진행 질문을 찾으라고 해요', async () => {
  const ask = askTip([], { prompt: '인계메모 고쳐서 커밋해 줘', tools: [], answer: '커밋했어요. 푸시는 안 했어요.' })
  expect(ask).toContain('푸시는 안 했어요')
  expect(ask).toContain('허락')
  expect(ask).toContain('허락 없이 할 수 있는데')
  expect(ask).not.toContain('대부분의 턴은')
})

test('기록 위치: 그 세션 메모리와 같은 projects/<프로젝트>/turn-tip', async () => {
  const transcriptPath = String.raw`C:\Users\t\.claude\projects\D--MoruLab\abc.jsonl`
  expect(pickLogPath({ transcriptPath, root: 'D:/MoruLab', home: 'C:/Users/t', sessionId: 'x' })).toBe('C:/Users/t/.claude/projects/D--MoruLab/turn-tip/abc.md')
  expect(pickLogPath({ root: String.raw`D:\MoruLab`, home: 'C:/Users/t', sessionId: 's1' })).toBe('C:/Users/t/.claude/projects/D--MoruLab/turn-tip/s1.md')
})

test('턴이 끝나면 팁이 띠에 뜨고 문서에 쌓여요', async ($, on) => {
  const { log } = world(on)
  await $.turn.complete({ answer: '끝', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await settle()

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /clear/ })).toBeDefined()
    for (const key of ['explain', 'log', 'hide']) expect(await ui.find({ key })).toBeDefined()
    await ui.unmount()
  }

  expect(log()).toContain('# turn-tip 팁 기록')
  expect(log()).toContain(`📌 ${TIP}`)
})

test('자세히를 누르면 설명이 띠에 뜨고 문서에도 붙어요', async ($, on) => {
  const { log } = world(on)
  await $.turn.complete({ answer: '끝', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'explain' })
  await settle()
  expect(await ui.find({ key: 'explanation' })).toBeDefined()
  await ui.press({ key: 'hide' })
  expect(await ui.find({ key: 'explanation' })).toBeUndefined()
  await ui.unmount()

  expect(log()).toContain('자세히 — ')
})

test('응답 중에도 기록 버튼을 누르면 기록 창이 열려요', async ($, on) => {
  world(on)
  const opened: string[] = []
  on('ui.open', async (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('prompt.submit', async (_, e) => ({ text: e.text }))
  await $.prompt.submit({ text: '안녕' })
  await settle()

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, isWorking: true } })
    expect(await ui.find({ type: 'Text', text: /응답이 끝나면/ })).toBeDefined()
    // 데스크톱은 스스로 도는 SVG 스피너 (타이머로 다시 그리면 클릭이 사라져요), 터미널은 글자 스피너.
    expect((await ui.find({ type: 'Svg' })) !== undefined).toBe(surface === 'desktop')
    await ui.press({ key: 'log' })
    await ui.unmount()
  }
  expect(opened).toEqual(['turn-tip-log', 'turn-tip-log'])
})

test('질문 창이 떠 있는 동안 띠에 답해 달라는 안내가 뜨고, 답하면 응답 중으로 돌아가요', async ($, on) => {
  world(on)
  let answer: () => void = () => {}
  on('tool.call', { tool: 'AskUserQuestion' }, () => new Promise(resolve => (answer = () => resolve({ result: '네' } as never))))
  on('prompt.submit', async (_, e) => ({ text: e.text }))
  await $.prompt.submit({ text: '고쳐 줘' })
  await settle()

  const asking = $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: '어느 쪽으로 할까요?', header: '방식', options: [], multiSelect: false }] } as never)
  await settle()
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, isWorking: true } })
    expect(await ui.find({ type: 'Text', text: /질문에 답해 주세요/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /어느 쪽으로 할까요/ })).toBeDefined()
    await ui.unmount()
  }

  answer()
  await asking
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, isWorking: true } })
  expect(await ui.find({ type: 'Text', text: /질문에 답해 주세요/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /응답이 끝나면/ })).toBeDefined()
  await ui.unmount()
})

test('firstQuestion 은 첫 질문과 남은 개수를 적어요', async () => {
  expect(firstQuestion({ questions: [{ question: ' 하나? ' }] })).toBe('하나?')
  expect(firstQuestion({ questions: [{ question: '하나?' }, { question: '둘?' }] })).toBe('하나? 외 1개')
  expect(firstQuestion({})).toBe('')
  expect(restoredView({ kind: 'asking', question: '하나?' })).toBe(null)
})

test('다음 턴에는 이미 보여 준 팁을 프롬프트에 넘겨요', async ($, on) => {
  const { prompts } = world(on)
  await $.turn.complete({ answer: '끝', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await settle()
  await $.turn.complete({ answer: '끝', durationMs: 1000, isAborted: false, turnId: 't2', reason: 'answer' })
  await settle()
  expect(prompts.length).toBe(2)
  expect(prompts[0]).toContain('마지막 답변: 끝')
  expect(prompts[1]).toContain(`- ${TIP}`)
})

test('parseTips 는 "종류: 문장" 줄들을 읽고, 모르는 종류는 other 로 둬요', async () => {
  expect(parseTips('allow: 규칙·훅 수정 허락이라고 써 주세요\n- push: 커밋 730b70a 를 푸시할지 정해 주세요\n\n그냥 문장이에요')).toEqual([
    { kind: 'allow', text: '규칙·훅 수정 허락이라고 써 주세요' },
    { kind: 'push', text: '커밋 730b70a 를 푸시할지 정해 주세요' },
    { kind: 'other', text: '그냥 문장이에요' },
  ])
  expect(parseTips('NONE')).toEqual([])
  expect(parseTips('a: 1\nb: 2\nc: 3\nd: 4').length).toBe(3)
  expect(parseTips('**go**: 바로 진행하라고 답해 주세요')).toEqual([{ kind: 'go', text: '바로 진행하라고 답해 주세요' }])
})

test('할 일이 여러 개면 줄마다 종류별 아이콘·색으로 그려요', async ($, on) => {
  const { log } = world(on, 'allow: 허락을 써 주세요\npush: 푸시할지 정해 주세요')
  await $.turn.complete({ answer: '끝', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const first = await ui.find({ type: 'Text', text: /^🔑/ })
  const second = await ui.find({ type: 'Text', text: /^⬆️/ })
  expect(first?.props.color).toBe(TIP_KINDS.allow.color)
  expect(second?.props.color).toBe(TIP_KINDS.push.color)
  await ui.unmount()
  expect(log()).toContain(`${TIP_KINDS.allow.icon} 허락을 써 주세요`)
  expect(log()).toContain(`${TIP_KINDS.push.icon} 푸시할지 정해 주세요`)
})

test('응답 완료 숫자: 모델 이름·토큰·비용·시간을 짧게 적어요', async () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('gpt-x')).toBe('gpt-x')
  expect([formatTokens(950), formatTokens(1234), formatTokens(45_600), formatTokens(2_300_000)]).toEqual(['950', '1.2k', '46k', '2.3M'])
  expect([formatDuration(8_400), formatDuration(60_000), formatDuration(83_000)]).toEqual(['8초', '1분', '1분 23초'])
  expect([formatUsd(0.004), formatUsd(0.4251)]).toEqual(['<$0.01', '$0.43'])
  const usage = { model: 'claude-opus-5-5', input_tokens: 200, output_tokens: 1500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2000 }
  expect(statsParts(turnStats({ turnId: 't', durationMs: 83_000, usage }, 0.4251), 0)).toEqual(['Opus 5.5', '입력 42k · 출력 1.5k tok', '$0.43', '1분 23초'])
  expect(statsParts(turnStats({ turnId: 't', durationMs: 5_000 }, undefined), 0)).toEqual(['5초'])
  // 세션 총 비용을 알면 이번 턴 비용 옆에 '총'으로 붙여요.
  expect(statsParts({ turnId: 't', durationMs: 5_000, usd: 0.07, sessionUsd: 3.214 }, 0)).toEqual(['$0.07 / 총 $3.21', '5초'])
  expect(statsParts({ turnId: 't', durationMs: 5_000, sessionUsd: 3.214 }, 0)).toEqual(['총 $3.21', '5초'])
  expect(statsParts({ turnId: 't', durationMs: 5_000, cacheUntil: 1000 }, 2000)).toEqual(['5초', '캐시 만료'])
  expect(statsParts({ turnId: 't', durationMs: 5_000, cacheUntil: 3_600_000 }, 48_000)).toEqual(['5초', '캐시 59:12'])
  expect([countdown(3_600_000), countdown(59_001), countdown(0)]).toEqual(['1:00:00', '01:00', '00:00'])
  expect(statsParts({ turnId: 't', durationMs: 5_000, cacheHit: false, cacheSurprise: 'early' }, 0)).toEqual(['5초', '🌱❗'])
  expect(statsParts({ turnId: 't', durationMs: 5_000, cacheHit: true, cacheUntil: 3_600_000 }, 48_000)).toEqual(['5초', '🔗 캐시 59:12'])
  expect(statsParts({ turnId: 't', durationMs: 5_000, cacheHit: false, cacheUntil: 1000 }, 2000)).toEqual(['5초', '🌱 캐시 만료'])
  expect(tipUsd({ input_tokens: 800, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }).toFixed(5)).toBe("0.00018")
  expect([formatSmallUsd(0.00018), formatSmallUsd(0.00001), formatSmallUsd(0.25)]).toEqual(['$0.0002', '<$0.0001', '$0.25'])
})

test('대화 기록에서 캐시를 새로 쓴 가장 최근 응답의 TTL 을 읽어요', async () => {
  const line = (m5: number, h1: number) =>
    `{"type":"assistant","message":{"usage":{"input_tokens":3,"cache_creation":{"ephemeral_5m_input_tokens":${m5},"ephemeral_1h_input_tokens":${h1}}}}}`
  expect(lastCacheTtl([line(0, 3966), line(0, 0)].join('\n'))).toBe('1h')
  expect(lastCacheTtl([line(0, 3966), line(1200, 0), line(0, 0)].join('\n'))).toBe('5m')
  // 키 순서가 바뀌어도 읽어요
  expect(lastCacheTtl('{"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":77}}')).toBe('5m')
  expect(lastCacheTtl([line(0, 0), line(0, 0)].join('\n'))).toBeUndefined()
  expect(lastCacheTtl('')).toBeUndefined()
  expect(statsParts({ turnId: 't', durationMs: 1000, cacheUntil: 300_000 }, 0)).toEqual(['1초', '캐시 05:00'])
})

test('첫 요청 사용량으로 캐시를 이어 썼는지 보고, 지난 예상과 견줘요', async () => {
  // 이어 씀: 대화 대부분을 캐시에서 읽고 새 몫만 씀
  expect(isCacheHit({ input_tokens: 50, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 3_000 })).toBe(true)
  // 새로 씀: 캐시가 식어서 대화 전체를 다시 씀 (시스템 프롬프트만 읽힘)
  expect(isCacheHit({ input_tokens: 50, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 190_000 })).toBe(false)
  expect(isCacheHit({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(false)
  // 예상: 1000 까지 유지
  expect(cacheSurprise(1000, 500, true)).toBeUndefined()
  expect(cacheSurprise(1000, 1500, false)).toBeUndefined()
  expect(cacheSurprise(1000, 500, false)).toBe('early')
  expect(cacheSurprise(1000, 1500, true)).toBe('late')
  expect(cacheSurprise(undefined, 1500, true)).toBeUndefined()
})

test('턴이 끝나면 띠 맨 위에 응답 완료 제목과 숫자가 떠요', async ($, on) => {
  world(on)
  const usage = { model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  await $.turn.complete({ answer: '끝', durationMs: 12_000, isAborted: false, turnId: 't1', reason: 'answer', usage })
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /응답 완료/ })).toBeDefined()

  // 숫자는 모델마다 한 줄: 주 모델(대화), 보조 모델(팁 찾기).
  expect((await ui.find({ type: 'Text', text: /Opus 5.5/ }))?.text).toBe('주 모델  Opus 5.5 · 입력 100 · 출력 900 tok · 12초 · 캐시 ~1:00:00')
  expect((await ui.find({ type: 'Text', text: /Haiku/ }))?.text).toBe('보조 모델  Haiku 5.5 · 팁 찾기 · 1.0k tok · $0.0002')
  // 버튼은 아이콘만, 이름은 label 로 남아요.
  for (const [key, icon] of [['explain', '💬'], ['copy', '📋'], ['log', '🕘'], ['hide', '✕']] as const) {
    expect((await ui.find({ key }))?.text).toBe(icon)
  }
  await ui.unmount()
})

test('앞선 턴은 최대 4개까지 줄여서 프롬프트에 넘겨요', async ($, on) => {
  const { prompts } = world(on, 'NONE')
  for (let i = 1; i <= 6; i++) {
    await $.turn.complete({ answer: `답변${i}`, durationMs: 1000, isAborted: false, turnId: `t${i}`, reason: 'answer' })
    await settle()
  }
  expect(prompts[0]).not.toContain('앞선 턴들')
  expect(prompts[0]).toContain('최근 1턴')
  const last = prompts[5]
  expect(last).toContain('최근 5턴')
  expect(last).toContain('[4턴 전] 답변: 답변2')
  expect(last).toContain('[1턴 전] 답변: 답변5')
  expect(last).not.toContain('답변1')
  expect(last).toContain('마지막 답변: 답변6')
})

test('확인할 것이 없으면 없다는 문구를 띄우고 기록에는 남기지 않아요', async ($, on) => {
  const { log } = world(on, 'NONE')
  await $.turn.complete({ answer: '끝', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /확인할 만한 것이 없어요/ })).toBeDefined()
  expect(await ui.find({ key: 'explain' })).toBeUndefined()
  expect(await ui.find({ key: 'log' })).toBeDefined()
  await ui.unmount()
  expect(log()).toBeUndefined()
})

test('하위 에이전트의 턴에는 팁을 묻지 않아요', async ($, on) => {
  const { prompts } = world(on)
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })
  await settle()
  expect(prompts.length).toBe(0)
})

test('띠 상태를 세션별로 $.store 에 남겨요', async ($, on) => {
  const { store } = world(on)
  await $.turn.complete({ answer: '끝', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await settle()
  const saved = store.get('band:s-test') as SavedBand
  expect(saved.view).toEqual({ kind: 'tip', tips: [{ kind: 'other', text: TIP }], turnId: 't1' })
  expect(saved.stats?.turnId).toBe('t1')
  expect(saved.seen).toEqual([TIP])
})

test('앱을 껐다 켜서 새로 뜬 세션은 남겨 둔 띠를 되살려요', async ($, on) => {
  const saved: SavedBand = {
    view: { kind: 'explaining', tips: [{ kind: 'push', text: '푸시할지 정해 주세요' }], turnId: 't9' },
    isHidden: false,
    stats: { turnId: 't9', durationMs: 5000 },
    seen: ['푸시할지 정해 주세요'],
    recent: [],
  }
  world(on, TIP, { 'band:s-test': saved })
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /푸시할지 정해 주세요/ })).toBeDefined()
  // 설명 받던 중이었으면 다시 누를 수 있게 '자세히' 버튼으로 돌아와요.
  expect(await ui.find({ key: 'explain' })).toBeDefined()
  await ui.unmount()
  expect(restoredView({ kind: 'working' })).toBe(null)
})

test('화면이 늦게 붙어도 session.attach 에서 띠를 되살리고 흔적을 남겨요', async ($, on) => {
  const saved: SavedBand = {
    view: { kind: 'tip', tips: [{ kind: 'check', text: '앱에서 직접 확인해 주세요' }], turnId: 't9' },
    isHidden: false,
    stats: null,
    seen: [],
    recent: [],
  }
  const { store } = world(on, TIP, { 'band:s-test': saved })
  on('session.attach', async (_, e) => ({ clientId: e.clientId }))
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /앱에서 직접 확인해 주세요/ })).toBeDefined()
  await ui.unmount()
  const traced = store.get('trace') as string[]
  expect(traced.some(line => line.includes('session.attach desktop 되살림(tip)'))).toBe(true)
  expect(traced.some(line => line.includes('render desktop survey=false working=false view=tip hidden=false'))).toBe(true)
})

test('복사를 누르면 팁 자리에 입력칸이 뜨고, 완료로 돌아와요', async ($, on) => {
  world(on)
  await $.turn.complete({ answer: '끝', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await settle()

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'copy' })
    const field = await ui.find({ key: 'copy-field' })
    expect(field).toBeDefined()
    expect(JSON.stringify(field)).toContain(`📌 ${TIP}`)
    // 완료는 입력칸의 Enter 하나뿐이에요 (제목 줄에 완료 버튼을 따로 두지 않아요).
    expect(await ui.find({ key: 'copy-done' })).toBeUndefined()
    await ui.input({ key: 'copy-field', text: `📌 ${TIP}` })
    expect(await ui.find({ key: 'copy-field' })).toBeUndefined()
    expect(await ui.find({ key: 'explain' })).toBeDefined()
    await ui.unmount()
  }
  expect(copyText({ kind: 'clear', turnId: 't1' })).toBe(null)
  expect(copyRows('a\nb')).toBe(2)
})
