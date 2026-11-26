# 데이터 모델 (원격 파일 형식 v1)

운동 세션은 월별로, 신체 측정값은 연도별로 나누어 저장합니다. 원격 파일은 비공개 `workout-data`에 둡니다. 운동 장소와 정확한 운동 시각은 기록하지 않습니다.

## 비공개 저장소 구조

```text
workout-data/
  schema.json
  workouts/
    2026-11.json
    2026-12.json
  body/
    2026.json
```

각 파일은 첫 저장 시 생성합니다.

### workouts/2026-11.json

```json
{
  "schemaVersion": 1,
  "month": "2026-11",
  "sessions": [
    {
      "id": "session-uuid",
      "date": "2026-11-10",
      "revision": 1,
      "deleted": false,
      "exercises": [
        {
          "id": "exercise-uuid",
          "exerciseKey": "lat-pulldown",
          "name": "랫풀다운",
          "restSeconds": 90,
          "sets": [
            {
              "id": "set-uuid",
              "weightKg": 40,
              "reps": 12,
              "completed": true
            }
          ]
        }
      ]
    }
  ],
  "tombstones": []
}
```

### body/2026.json

```json
{
  "schemaVersion": 1,
  "year": 2026,
  "measurements": [
    {
      "id": "measurement-uuid",
      "date": "2026-11-10",
      "weightKg": 74.2,
      "skeletalMuscleKg": 30.1,
      "bodyFatKg": 16.8,
      "bodyFatPercent": null,
      "heightCm": null,
      "notes": null,
      "revision": 1
    }
  ],
  "tombstones": []
}
```

위 수치는 스키마 설명용 합성 예시입니다.

## 모델 규칙

- 사용자 시간대를 기준으로 ISO 달력 날짜 `YYYY-MM-DD`를 사용합니다. 운동 시설 위치와 정확한 운동 시작·종료 시각은 원격 기록에 저장하지 않습니다.
- 기록과 전송 대기 작업에는 고정 UUID를 부여합니다. 저장된 기록을 수정하거나 삭제할 수 있어야 합니다.
- 세션 내 종목과 종목 내 세트에는 순서가 있습니다. 세트는 배열 위치와 별개인 UUID로 식별합니다.
- 수치 입력은 유한한 숫자여야 하며, 저장과 API 호출 전에 허용 범위를 검증합니다. 측정값은 선택 항목입니다.
- 파생값은 중복 저장하지 않습니다. 총 볼륨은 집계 대상인 완료 세트의 `weightKg * reps` 합계입니다. 준비 세트 포함 여부는 화면에 표시하도록 합니다.
- 체중과 골격근량은 인바디 장비나 측정 조건에 따라 차이가 날 수 있습니다. 단기 변동보다 추세를 확인할 수 있도록 표시합니다.
- 스키마 마이그레이션은 명시적으로 관리하며 가능한 범위에서 이전 버전과 호환합니다. 지원하지 않는 최신 버전은 가져오기를 거부하고 기존 로컬 데이터를 보존합니다.
- 충돌은 고유 ID, 리비전, 삭제 표식, 변경 전 스냅샷으로 감지합니다. 같은 기록에서 변경이 충돌하면 사용자가 해결합니다. 리비전 숫자만으로는 다른 기기의 변경을 읽었는지 확인할 수 없습니다.

## 운동 ID와 ChatGPT 기록

공식 운동 인스턴스의 `exerciseKey`는 카탈로그의 `exercises[].id`입니다. 사용자 종목 키와 기존 기록의 이전 키도 사용할 수 있습니다. 운동 세션, 운동 인스턴스, 세트는 각각 별도 UUID로 식별합니다. 카탈로그의 버전은 운동 데이터와 독립적으로 관리합니다. [운동 카탈로그](../data/exercise-catalog.json)와 [GPT 기록 프로토콜](exercise-recording-protocol.md)을 참고하세요.

## 인바디 CSV 원본과 확장 측정값

비공개 `workout-data/body/YYYY.json`은 위의 기본 필드에 더해 장비별 측정값을 지원합니다. InBody 370S CSV 하나에 여러 날짜의 측정 행이 들어갈 수 있습니다. 측정일은 각 행의 날짜를 사용합니다. 예를 들어 `InBody-20261126.csv`에 2026년 11월 5일, 14일, 22일 측정 행만 있다면 해당 세 날짜만 기록합니다.

| 구분 | 선택 필드 |
| --- | --- |
| 원본 정보 | `device`, `source`, `measuredAtLocal` |
| 요약 지표 | `bmi`, `basalMetabolicRateKcal`, `inbodyScore` |
| 부위별 근육량 | `rightArmMuscleKg`, `leftArmMuscleKg`, `trunkMuscleKg`, `rightLegMuscleKg`, `leftLegMuscleKg` |
| 부위별 체지방량 | `rightArmBodyFatKg`, `leftArmBodyFatKg`, `trunkBodyFatKg`, `rightLegBodyFatKg`, `leftLegBodyFatKg` |
| 체성분 상세 | `waistHipRatio`, `visceralFatLevel`, `totalBodyWaterL`, `proteinKg`, `mineralKg`, `smiKgPerM2` |
| 미측정 항목 | `missingFields`에는 CSV에서 값이 없거나 `-`로 표시된 항목명을 넣습니다. |

보고되지 않은 값은 추정하지 않습니다. 원본이 숫자 0을 보고하면 그대로 보존합니다. `measuredAtLocal`은 원본에서 옮긴 현지 시각이며 시간대 정보가 없습니다. 날짜와 시각을 비교할 때는 이 차이를 고려합니다.

앱은 위 필드를 지원하고, 기록에 추가로 들어 있는 JSON 필드도 가져오기·수정·내보내기에서 보존합니다. 기본 지표에 값이 없으면 `null`로 처리하고 선택 지표는 생략된 상태로 둘 수 있습니다. 화면 정렬과 차트에는 `date`를 사용하고, `measuredAtLocal`은 원본 정보로 보존합니다. 기기에서 작성한 측정 조건 메모는 `measurementConditions`에 저장합니다.

## 확장 세트와 로컬 백업

- `measurementType`은 세트의 기록 방식을 지정합니다. 지원 값은 중량·횟수 `weight-reps`, 횟수 `reps`, 유지 시간 `duration`, 좌우 개별 중량·횟수 `unilateral-weight-reps`입니다.
- `completed`는 수행을 기록했는지를 나타내며, 선택 필드 `successful`은 수행 결과를 나타냅니다. 월별 운동 파일에서 `completed`가 생략된 세트는 수행이 기록된 것으로 처리합니다. 중량이나 횟수가 없으면 `null`로 가져옵니다.
- `reps`, `leftReps`, `rightReps`에는 성공 횟수를 저장합니다. 실패 위치는 `failedAttemptRep`, `leftFailedAttemptRep`, `rightFailedAttemptRep`에 따로 저장합니다. 볼륨에는 완료 세트에서 중량과 성공 횟수를 아는 부분을 반영하고, 좌우는 개별 계산 후 합산합니다. 좌우 중량이 명시적으로 `null`이면 미측정으로 처리합니다. 좌우별 필드가 생략된 경우 공통 `weightKg`를 사용할 수 있습니다.
- `durationSeconds`, `restSeconds`, `repsEstimated`, 좌우 반복 횟수의 추정 플래그, `durationEstimated`, `restSecondsEstimated`, `formUnstable`, `notes`에는 원본 세트의 정보와 추정 여부를 저장합니다.
- Dexie v2는 원본 파일의 메타데이터를 저장할 공간을 추가합니다. 기존 테이블과 기록 ID는 유지합니다. 앱 백업 v2는 `sessions`, `measurements`, `catalog`, `sources`로 구성되며, 가져오기는 앱 백업 v1과 문서에 정의된 월별·연별 v1 파일도 지원합니다. 메타데이터에는 원본 기간과 삭제 표식을 보존합니다. 로컬로 가져올 때는 삭제 표식을 적용하지 않습니다.
- 파일 전체를 검증한 후 새 기록을 하나의 트랜잭션으로 저장합니다. 로컬에 같은 운동 날짜나 기록 ID가 있으면 건너뜁니다. 신체 측정은 날짜와 현지 측정 시각으로도 중복을 확인합니다. 시각이 없으면 날짜, 장비, 측정값을 비교합니다. 가져오기 전에는 로컬 기록을 JSON으로 내보내 백업할 수 있습니다.
