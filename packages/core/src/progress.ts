export type ProgressEvent =
  | { type: 'start'; step: string; message: string }
  | { type: 'update'; step: string; message: string }
  | { type: 'succeed'; step: string; message?: string }
  | { type: 'fail'; step: string; message: string }

export interface ProgressReporter {
  emit(event: ProgressEvent): void
}

export const noopReporter: ProgressReporter = { emit() {} }

/**
 * Convert any reporter (or none) into a safe reporter. Core modules never write
 * to stdout/stderr by themselves: progress is always delegated to the caller.
 */
export function withReporter(reporter?: ProgressReporter | null): ProgressReporter {
  return reporter ?? noopReporter
}
