import type { Fault, MachineState, Status } from './types'

interface MachineSnap {
  state: MachineState
  fault: Fault | null
}

interface Core {
  snapshot(): MachineSnap
  restart(): void
  provideInput(text: string): void
}

/** Результат одного кроку автоматичного виконання: продовжити через `wait` мс або зупинитися зі статусом. */
export type Outcome = { wait: number } | { status: Status }

/** Статус для машини, що перестала бути готовою до наступної команди. */
export function stoppedStatus(snap: MachineSnap): Status {
  switch (snap.state) {
    case 'blockedOnInput':
      return { key: 'waitingInput' }
    case 'paused':
      return { key: 'breakpoint' }
    case 'halted':
      return { key: 'halted' }
    case 'fault':
      return { key: 'fault', fault: snap.fault }
    default:
      return { key: 'idle' }
  }
}

/**
 * Керування автоматичним виконанням, спільне для симулятора й тракту даних:
 * запуск за таймером, зупинка, очікування вводу, рестарт.
 */
export function createControl<Mode extends string>(spec: {
  core: () => Core
  running: () => Mode | null
  refresh: (patch?: { running?: Mode | null; status?: Status }) => void
  /** Виконує один крок у режимі `mode`. */
  advance: (mode: Mode) => Outcome
  /** Пауза перед першим кроком після старту. */
  startDelay: () => number
  /** Режим, яким команда Input доводиться до кінця, коли автоматичного запуску немає. */
  afterInput: Mode | null
}) {
  let timer: ReturnType<typeof setTimeout> | undefined

  const halt = () => {
    clearTimeout(timer)
    timer = undefined
  }

  const tick = () => {
    const mode = spec.running()
    if (!mode) return
    const outcome = spec.advance(mode)
    if ('wait' in outcome) {
      spec.refresh()
      timer = setTimeout(tick, outcome.wait)
      return
    }
    timer = undefined
    // Поки машина чекає вводу, режим зберігається: після вводу виконання продовжиться.
    const waiting = spec.core().snapshot().state === 'blockedOnInput'
    spec.refresh({ running: waiting ? mode : null, status: outcome.status })
  }

  const begin = (mode: Mode) => {
    spec.refresh({ running: mode, status: { key: 'running' } })
    timer = setTimeout(tick, spec.startDelay())
  }

  return {
    /** Скасовує запланований крок, не змінюючи стан. */
    halt,

    start(mode: Mode) {
      const { state } = spec.core().snapshot()
      if (state === 'noProgram' || state === 'blockedOnInput') return
      if (spec.running()) {
        spec.refresh({ running: mode })
        return
      }
      // Після зупинки програма стартує заново, як в оригіналі.
      if (state === 'halted' || state === 'fault') spec.core().restart()
      begin(mode)
    },

    stop() {
      if (!spec.running()) return
      halt()
      const waiting = spec.core().snapshot().state === 'blockedOnInput'
      spec.refresh({ running: null, status: { key: waiting ? 'waitingInput' : 'stopped' } })
    },

    /** Значення для команди Input. */
    provideInput(text: string) {
      if (spec.core().snapshot().state !== 'blockedOnInput') return
      spec.core().provideInput(text)
      const snap = spec.core().snapshot()
      const mode = spec.running() ?? spec.afterInput
      if (snap.state !== 'ready') spec.refresh({ running: null, status: stoppedStatus(snap) })
      else if (mode) begin(mode)
      else spec.refresh({ status: { key: 'pressStep' } })
    },

    restart() {
      halt()
      spec.core().restart()
      const loaded = spec.core().snapshot().state !== 'noProgram'
      spec.refresh({ running: null, status: { key: loaded ? 'pressRun' : 'idle' } })
    },
  }
}
