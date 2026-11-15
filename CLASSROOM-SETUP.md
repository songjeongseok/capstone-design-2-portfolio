# 캡스톤디자인2 공동 저장 수업 개설

수업별 Supabase 프로젝트 하나에 학생 계정과 설계 기록을 보관합니다. 인증 메일은 그 프로젝트에 연결한 발신 계정에서 보냅니다. 서술형 AI 의견은 학생이 자신의 기록에서 요청할 때만 Vercel AI Gateway를 거쳐 생성됩니다.

## 1. 공동 저장과 교수자 계정

1. [Supabase](https://supabase.com/dashboard/projects)에서 수업용 프로젝트를 선택하거나 만드세요. **SQL Editor → New query**에서 [classroom.sql](supabase/classroom.sql) 전체를 실행하세요. Data API가 활성화되어 있고 공개 함수가 있는 `public` 스키마를 노출해야 합니다. 테이블이 있는 `capstone` 스키마는 비공개로 두세요.
2. **Authentication → Sign In / Providers**에서 Email 및 신규 가입을 활성화하고 이메일 확인을 켜세요. **Email Templates**에서 **Confirm signup**과 **Magic link** 템플릿 본문 양쪽에 아래 문구를 넣으세요. 첫 가입과 이후 로그인에 사용합니다.

   `<p>동강대학교 건축과 캡스톤디자인2 인증번호는 <strong>{{ .Token }}</strong>입니다.</p>`

3. **Authentication → SMTP Settings**에 학교에서 허용한 SMTP 서비스 또는 발신 도메인 검증이 끝난 메일 서비스의 발신 주소, 호스트, 포트, 사용자 이름, 비밀번호를 입력하세요. **Authentication → Rate Limits**에서 수강생이 동시에 로그인할 때 필요한 시간당 메일 수를 확인하세요. 기본 메일 발송은 프로젝트 팀 구성원에게 제한됩니다. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
4. 아래 Vercel 설정을 마친 후 협업 사이트에서 교수자 본인도 **학생 계정 만들기**로 처음 한 번 메일 인증번호를 입력하세요. 승인 대기 화면이 나오면 SQL Editor에서 아래 이메일을 방금 인증한 주소로 바꾸고 실행하세요. 한 행에 실제 교수자 계정이 반환되는지 확인하세요.

   ```sql
   update capstone.members m
      set role='instructor', status='active'
     from auth.users u
    where u.id=m.id and u.email_confirmed_at is not null
      and lower(u.email)=lower('교수자 본인이 인증한 이메일')
   returning m.name,m.email,m.role,m.status;
   ```

5. **승인 상태 새로고침 → 교수자 화면**에서 수강 명단과 대조한 뒤 학생을 승인하세요.

## 2. Vercel 프로젝트 연결

[duda-ai / capstone-design-2-portfolio 환경변수](https://vercel.com/duda-ai/capstone-design-2-portfolio/settings/environment-variables)에서 다음 값을 **Production**에 입력한 다음 **Deployments → Redeploy**로 새 빌드를 배포하세요. GitHub 연동에 사용하는 Vercel 프로젝트에서 설정합니다.

| 변수 | 입력할 값 |
|---|---|
| `SUPABASE_URL` | 수업 프로젝트의 Project URL. 예시 형식은 `https://프로젝트참조.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase 프로젝트 Settings → API Keys의 Publishable key. 브라우저가 이메일 인증과 본인 자료 조회에 사용 |
| `SUPABASE_SECRET_KEY` | 같은 프로젝트의 Secret key. Vercel의 Sensitive 환경변수로 보관. AI 서버가 검토 결과를 기록할 때 사용 |
| `AI_GATEWAY_API_KEY` | Vercel 환경에서 Gateway용 OIDC 토큰을 제공하지 않으면 같은 팀의 AI Gateway에서 발급한 키를 Sensitive로 입력 |
| `CAPSTONE_AI_MODEL` | 선택 사항. 기본 모델은 `openai/gpt-4o-mini` |

Vercel AI Gateway에서 해당 팀이 모델을 호출할 수 있는지, 잔액과 사용 한도를 확인하세요. API 키를 채팅이나 GitHub 파일에 붙여 넣지 마세요. Preview로 시험할 때는 별도 시험용 Supabase 프로젝트의 키를 Preview에 지정할 수 있습니다. [Gateway 인증](https://vercel.com/docs/ai-gateway/authentication-and-byok)

## 3. 실제 개설 확인

- [협업 화면](https://capstone-design-2-portfolio.vercel.app/collaboration/)에서 이메일 인증번호를 받아 입력하세요. 운영 화면은 ‘공동 저장 모드 · 이메일 인증번호 로그인’으로 표시됩니다. 인증번호 오류·만료 시에는 새 번호를 요청할 수 있습니다.
- 수강 승인된 시험 학생 계정으로 제목·설명·이미지를 1건 제출하세요. 다른 기기에서 같은 계정으로 확인하고, 교수자 화면에서도 해당 학생의 기록·첨부가 열리는지 확인하세요.
- 그 기록의 **AI 설계 검토 요청**을 누르면 제목·설명만 전송됩니다. 응답이 오면 의견이 새 버전으로 저장됩니다. 파일과 계정 필드는 전송하지 않습니다. 모델은 도면을 판독하지 않습니다. 사용자별 24시간에 최대 5회이며 제공자의 오류도 시도 횟수에 포함됩니다. 설정 여부와 호출 성공은 별개입니다.
- 기존 자료는 원래 브라우저의 [기존 자료 열기·백업](https://capstone-design-2-portfolio.vercel.app/collaboration/?local=1)에서 보관하세요. 공동 저장 계정으로 로그인 후 **자료 백업·가져오기**에서 같은 이메일의 본인 제출물만 복사할 수 있습니다. 자동 이관은 없습니다. 학습 예시와 기존 정적 페이지는 계속 이용할 수 있습니다.
- 검증 명령은 `npm test`입니다. [PostgreSQL 권한·버전 시험](tests/classroom-postgres.sql)은 **빈 일회용 테스트 DB 전용**입니다. 실제 수업 프로젝트에는 [운영 스키마](supabase/classroom.sql)만 실행하세요.
