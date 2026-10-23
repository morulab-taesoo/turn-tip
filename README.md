# turn-tip

Claude Code의 턴이 끝날 때, 사용자가 확인하거나 직접 해야 할 일이 있으면 입력창 위 띠에 한 줄로 띄우는 모드예요.

- 답변 끝에 묻힌 "푸시는 안 했어요", 허락을 기다리는 일, 직접 실행해 볼 명령 같은 것을 🔑 ⬆️ ▶️ 👀 ⚠️ 📌 아이콘과 함께 최대 3줄로 보여 줘요. 없으면 `✓ 이번 턴에는 확인할 만한 것이 없어요`.
- 띠 맨 위에는 그 턴의 모델·토큰·비용·시간과 프롬프트 캐시가 식기까지 남은 시간이 떠요.
- **자세히**: 왜 확인해야 하는지, 무엇을 하면 되는지 지금 대화에 비추어 설명해 줘요.
- **복사**: 팁·설명을 입력칸에 담아 복사할 수 있게 해요.
- **기록**: 이 세션에서 뜬 팁과 설명을 모아 보여 줘요. 기록은 `~/.claude/projects/<프로젝트>/turn-tip/<세션 id>.md`에 쌓여요.

팁은 턴이 끝날 때 Haiku(`claude-haiku-5-5`)에게 최근 턴의 요약을 보내 받아요 (한 번에 1센트의 몇 분의 1). '자세히'는 지금 대화를 이어 받는 메인 모델이 답해요. 띠 글자는 한국어예요.

## 설치

Claude Code 터미널의 입력창에서:

```
/plugin install turn-tip --marketplace morulab-taesoo/turn-tip
```

셸에서:

```bash
claude plugin install turn-tip --marketplace morulab-taesoo/turn-tip
```

데스크톱 앱에서 `/plugin` 이 안 되면: 입력창 옆 **+** → **Plugins** → **Add marketplace** 에 `morulab-taesoo/turn-tip` → **Add plugin**.

[모드 런처](https://github.com/morulab-taesoo/mod-launcher-releases)를 쓰면 런처의 **설치** 버튼 하나로 깔리고, 켜고 끄기도 런처에서 할 수 있어요.

## 업데이트

```bash
claude plugin update turn-tip@morulab
```

그다음 열린 세션에서 `/reload-plugins`.
