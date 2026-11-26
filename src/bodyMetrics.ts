const metric = <K extends string>(key: K, label: string, unit: string, max = 10000) => ({ key, label, unit, max })

export const bodyTrends = [
  metric('weightKg', '체중', 'kg', 500),
  metric('skeletalMuscleKg', '골격근량', 'kg', 250),
  metric('bodyFatKg', '체지방량', 'kg', 500),
  metric('bodyFatPercent', '체지방률', '%', 100),
]
export const coreBodyMetrics = [...bodyTrends, metric('heightCm', '키', 'cm', 300)]
export const detailedBodyMetrics = [
  metric('bmi', 'BMI', 'kg/m²'),
  metric('basalMetabolicRateKcal', '기초대사량', 'kcal'),
  metric('inbodyScore', '인바디 점수', '점'),
  metric('waistHipRatio', '복부지방률 (WHR)', ''),
  metric('visceralFatLevel', '내장지방 레벨', ''),
  metric('totalBodyWaterL', '체수분', 'L'),
  metric('proteinKg', '단백질', 'kg'),
  metric('mineralKg', '무기질', 'kg'),
  metric('smiKgPerM2', 'SMI', 'kg/m²'),
]
export const segments = [
  { label: '오른팔', muscle: 'rightArmMuscleKg', fat: 'rightArmBodyFatKg' },
  { label: '왼팔', muscle: 'leftArmMuscleKg', fat: 'leftArmBodyFatKg' },
  { label: '몸통', muscle: 'trunkMuscleKg', fat: 'trunkBodyFatKg' },
  { label: '오른다리', muscle: 'rightLegMuscleKg', fat: 'rightLegBodyFatKg' },
  { label: '왼다리', muscle: 'leftLegMuscleKg', fat: 'leftLegBodyFatKg' },
] as const
export const segmentMetrics = segments.flatMap(({ label, muscle, fat }) => [
  metric(muscle, label + ' 근육량', 'kg'),
  metric(fat, label + ' 체지방량', 'kg'),
])
