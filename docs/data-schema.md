# 데이터 스키마 v1

IndexedDB 데이터베이스 `color-cal`, 버전 1, 객체 저장소 `projects`, 키 `id`를 사용합니다. 서버로 측정 데이터를 보내지 않습니다. 최근 프로젝트 ID만 localStorage에 보조 저장하며 사용 불가 시 최신 수정 프로젝트로 돌아갑니다.

```text
Project
  id: UUID
  schemaVersion: 1
  meta: name, printer, paper, ink, resolution, rip, instrument, condition, notes
  settings: channels[], step, integer, precision (0..4)
  conditionsRevision: 출력 조건 편집 이력 (기존 데이터는 0으로 처리)
  storageRevision: 로컬 저장 충돌 검사용 번호 (복원·복제 시 초기화)
  first: { "C:5": { L, a, b }, ... }
  versions: CorrectionVersion[]
  history: [{ at: ISO 날짜, action: 한국어 작업 기록 }]
  createdAt, updatedAt: ISO 날짜
  location: { route, channel, versionId, cell }

CorrectionVersion
  id: UUID
  number: 프로젝트 내 증가하는 번호
  algorithm: paper-deltaE76-isotonic-linear-v1
  settings: 생성 시점 설정 사본
  conditions: 생성 시점 장비·용지·잉크·출력/측색 조건 사본
  rounding: decimal-half-up-v1 (없는 과거 버전은 이전 반올림을 보존)
  channels: 이 버전에 실제 보정이 있는 채널
  source: 해당 채널의 1차 Lab 스냅샷
  signature: 설정과 원본을 직렬화한 일치 확인 문자열
  tables: { C: [{ target, internal, production }], ... }
  second: { "C:5": { actual, L, a, b }, ... }
  warnings: 비단조 / 초과 경고 문자열[]
  createdAt, confirmedAt (null 또는 ISO 날짜)
```

Lab와 실제 제작값은 입력 중 초안 문자열로 저장할 수 있습니다. 빈값·잘못된 숫자는 완료로 계산하지 않습니다. 계산 시 유한 수치로 변환합니다. 1차 실제 입력은 측정 키의 계조이며 다른 채널은 0입니다. 2차 `actual`은 보정 권장값에서 추정하지 않고 사용자가 직접 기록합니다. 목표 ID는 반올림으로 제작값이 중복되어도 별개입니다.

`internal`은 JavaScript IEEE-754 배정밀도 원값이고 `production`은 해당 버전 설정에서 파생된 제작값입니다. 버전별 설정, 원본, 제작값은 현재 설정 변화로 재작성하지 않습니다. `signature`는 변경 검출용 비교 문자열로 암호학적 서명이 아닙니다.

확정에는 해당 버전의 모든 2차 실제 입력 및 Lab, 실제 제작값과 테이블 제작값의 일치, 그리고 현재 출력 조건·설정·1차 원본과의 일치가 필요합니다. 확정 후 UI 편집을 잠급니다. 현재 설정·1차 값과 맞지 않는 버전은 조회·내보내기가 가능하지만 계산기 적용을 금지합니다.

JSON 백업 봉투는 `{format:"color-cal-backup", schemaVersion:1, exportedAt, project}`입니다. 복원 시 타입·수치 범위·테이블 단조성·원본 일치·버전 중복·확정 완료 조건을 검증합니다. 새로운 프로젝트 ID로 저장하고 이력을 추가합니다. 유효하지 않은 백업은 기존 데이터 변경 없이 거부합니다.

저장은 직렬 큐로 순서를 유지하며 IndexedDB 트랜잭션 완료 후에만 완료 상태를 표시합니다. 저장 실패 시 화면의 입력을 유지하고 경고 및 종료 경고를 표시합니다. 이 경우 JSON 백업을 먼저 보관하세요. JSON은 미완성·잘못된 입력 초안도 보관합니다. 제작용 CSV 열은 유효한 수치만 내보내며 미입력·오류 실제 제작값은 빈칸입니다.

보정 버전 일치 여부는 Lab의 숫자와 명시된 필드로 비교합니다. `60`, `60.0`, `"60.000"` 또는 JSON 키 순서 차이는 보정값의 변경으로 취급하지 않습니다. 프로젝트 이름과 메모는 출력 조건 일치 검사에서 제외합니다.

JSON 복원 시 원본 스냅샷에서 보정 곡선을 재계산해 내부값과 대조합니다. 형식·범위·단조성이 맞더라도 원본에서 유도되지 않은 테이블은 거부합니다. 저장된 원본과 과거 제작값을 덮어쓰는 방식으로 보정하지 않습니다.

조건 사본이 없는 과거 버전은 과거의 실제 장비·용지를 복구할 수 없습니다. 이후 앱에서 출력 조건을 편집하면 해당 버전을 무효화하며, 새 버전부터 조건 사본을 저장합니다. 정상 수치라도 검증 오차가 계산 범위를 벗어나면 확정할 수 없습니다.
