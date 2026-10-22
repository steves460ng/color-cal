# Color Cal · CMYK 단색 캘리브레이션

HTML5 / CSS3 / Vanilla JavaScript ES Modules로 구현한 한국어 정적 웹 앱입니다. 서버 API, 외부 폰트, CDN 또는 런타임 패키지 없이 실행됩니다. 데이터는 현재 브라우저의 IndexedDB에 저장합니다.

## 실행

Python 3으로 저장소 루트에서 실행합니다.

```sh
python3 -m http.server 8000
```

브라우저에서 해당 서버에 접속합니다. `file://`로 직접 열면 ES Modules와 IndexedDB가 정상 작동하지 않을 수 있습니다. Hash Routing과 상대 경로를 사용하므로 GitHub Pages의 `/color-cal/` 하위 경로도 지원합니다. 개발 서버는 로컬 실행용이며 배포 시 서버가 필요하지 않습니다.

## 작업 순서

1. 프로젝트를 만들고 장비·용지·잉크·측색 조건을 기록합니다.
2. 채널, 증분, 정수값 모드를 설정합니다. 기본값은 CMYK / 5% / 정수 ON입니다.
3. 1차 가이드 수치로 직접 패치를 제작·인쇄하고 Lab를 입력합니다.
4. 1차 결과를 검토하고 전체 또는 한 채널의 보정 버전을 생성합니다.
5. 2차 가이드의 제작값으로 패치를 만들고 **실제 제작값과 Lab를 각각 기록**합니다.
6. 최종 결과에서 검증한 뒤 버전을 확정합니다.
7. 계산기에서 확정 버전을 사용합니다. 미보정 채널은 원본값을 통과시킵니다.
8. CSV 내보내기 및 프로젝트 전체 JSON 백업을 사용합니다.

보정은 종이색 대비 ΔE76을 정규화한 단색 계조를 목표로 합니다. PAVA 단조 회귀와 역선형 보간을 사용합니다. [수학적 정의와 제한](docs/algorithm.md)을 확인하세요. 혼합색 Lab 예측, ICC 프로파일 생성, 색상 일치 보장은 제공하지 않습니다.

## 테스트

계산·검증·백업 단위 테스트는 Node.js 22 이상에서 실행합니다. 개발 의존성 설치 없이도 가능합니다.

```sh
npm test
```

브라우저 통합 테스트는 Playwright를 사용합니다. **앱 실행에는 npm 의존성이 필요하지 않습니다.**

```sh
npm ci
npx playwright install --with-deps chromium firefox
# 별도 터미널에서 위의 Python 서버 실행
npm run test:browser
BROWSER=firefox npm run test:browser
npm run test:resilience
npm run test:persistence
```

시스템 Chromium을 사용하려면 `BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:browser`를 실행합니다. 다른 서버 주소는 `BASE_URL`로 지정합니다. Edge는 `npx playwright install msedge` 후 `BROWSER=msedge npm run test:browser`로 확인합니다. 통합 테스트의 데이터는 테스트 전용 브라우저 컨텍스트 안에서만 생성됩니다.

현재 환경에서 단위 테스트와 시스템 Chromium 통합 테스트를 실행했습니다. Firefox와 Edge의 실제 검증 결과는 CI 실행 결과를 별도로 확인해야 합니다. `.github/workflows/test.yml`은 세 엔진과 프로젝트 하위 경로에서 통합 검증하도록 구성되어 있습니다.

## GitHub Pages 배포

빌드 과정은 없습니다. `main`의 루트 파일을 그대로 배포합니다.

1. GitHub 저장소 **Settings → Pages**를 엽니다.
2. **Deploy from a branch**를 선택합니다.
3. **main / (root)**를 선택하고 저장합니다.
4. Pages 배포 작업이 완료되면 `https://steves460ng.github.io/color-cal/`에서 확인합니다.

`.nojekyll`이 포함되어 있습니다. 테스트에 사용하는 `node_modules/`, `test-results/`는 Git에 포함하지 않습니다. 이 환경에서는 GitHub 설정 API 접근이 차단되어 Pages 설정 변경과 공개 URL의 배포 완료 여부를 검증하지 못했습니다. 파일 푸시나 CI 설정 자체가 공개 배포 성공을 뜻하지는 않습니다.

## 데이터 보존

프로젝트 CRUD·복제, 입력 초안 자동 저장, 최근 프로젝트·작업 단계·채널·입력 셀 복원을 지원합니다. 설정을 바꿔도 기존 측정값은 삭제하지 않습니다. 각 보정 버전은 설정, 원본 1차 Lab, 내부 보정값, 제작 반올림값, 실제 2차 입력·Lab와 확정 상태를 독립 보존합니다. 확정된 버전은 읽기 전용입니다.

사이트 데이터 삭제, 다른 브라우저·기기 사용, 프라이빗 창 종료는 데이터 손실 또는 별도 저장 공간을 뜻합니다. **중요 작업 전후에 JSON 백업**을 내려받으세요. JSON 복원은 새 ID의 별도 프로젝트로 이루어져 기존 데이터를 덮어쓰지 않습니다. 백업은 프로젝트별이며 최대 30MB입니다. CSV는 분석·제작용으로, 복원에는 JSON을 사용합니다. 내부 보정값은 원래 JavaScript 수치 정밀도로 내보냅니다.

자세한 내용: [사용자 매뉴얼](docs/user-guide.md), [데이터 스키마](docs/data-schema.md), [요구사항과 검증 범위](docs/requirements.md).
