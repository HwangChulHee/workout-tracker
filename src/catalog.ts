import source from '../data/exercise-catalog.json'
import type { CatalogEntry, Exercise, MeasurementType } from './model'

export const officialCatalog = source.exercises.map((entry): CatalogEntry => ({
  id: entry.id,
  name: entry.nameKo,
  nameEn: entry.nameEn,
  aliases: entry.aliases,
  equipment: entry.equipment,
  modifiers: entry.modifiers,
  measurementType: entry.measurementType as CatalogEntry['measurementType'],
  restSeconds: entry.defaultRestSeconds,
}))

const officialByKey = new Map(officialCatalog.map((entry) => [entry.id, entry]))
const legacyKeys = new Set(['bench-press', 'squat', 'deadlift', 'overhead-press', 'seated-row'])
const normalize = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[\s-]+/g, '')
const ambiguous = new Map(Object.entries(source.ambiguousTerms).map(([term, keys]) => [normalize(term), keys]))

export const isLegacyExercise = (key: string) => legacyKeys.has(key)
export const officialExercise = (key: string) => officialByKey.get(key)

export function exerciseMeasurementType(exercise: Exercise): MeasurementType {
  const type = exercise.measurementType ?? officialExercise(exercise.exerciseKey)?.measurementType
  if (type) return type
  if (exercise.sets.some((set) => set.leftReps != null || set.rightReps != null
    || set.leftWeightKg != null || set.rightWeightKg != null)) return 'unilateral-weight-reps'
  return exercise.sets.some((set) => set.durationSeconds != null) ? 'duration' : 'weight-reps'
}

export function availableExercises(saved: CatalogEntry[]) {
  const savedByKey = new Map(saved.map((entry) => [entry.id, entry]))
  return [
    ...officialCatalog.map((entry) => ({ ...entry, restSeconds: savedByKey.get(entry.id)?.restSeconds ?? entry.restSeconds })),
    ...saved.filter((entry) => !officialByKey.has(entry.id) && !legacyKeys.has(entry.id)),
  ]
}

function names(entry: CatalogEntry) {
  return [entry.name, entry.nameEn ?? '', ...(entry.aliases ?? [])].map(normalize)
}

export function searchExercises(entries: CatalogEntry[], query: string) {
  const term = normalize(query)
  const candidates = ambiguous.get(term)
  if (candidates) return entries.filter((entry) => candidates.includes(entry.id))
  return entries.filter((entry) => [...names(entry), normalize(entry.equipment ?? ''),
    ...(entry.modifiers ?? []).map(normalize)].some((name) => name.includes(term)))
}

export function resolveExerciseName(query: string, entries = officialCatalog) {
  const term = normalize(query)
  if (!term) return { status: 'unknown' } as const
  if (ambiguous.has(term)) return { status: 'ambiguous' } as const
  const matches = entries.filter((entry) => names(entry).includes(term))
  if (matches.length === 1) return { status: 'matched', key: matches[0].id } as const
  return { status: matches.length > 1 ? 'ambiguous' : 'unknown' } as const
}
