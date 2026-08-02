type HomeDayPeriod =
  | 'late-night'
  | 'early-morning'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening'
  | 'night'

const TIME_COPIES: Readonly<Record<HomeDayPeriod, readonly string[]>> = {
  'late-night': [
    '夜深了，不必急着结束，也不必急着开始。',
    '四周安静下来以后，那些模糊的念头才开始显出轮廓。',
  ],
  'early-morning': [
    '天刚亮，一切都还来得及，也都不必急着决定。',
    '清晨把一天重新打开，答案可以晚一点出现。',
  ],
  morning: [
    '一天刚刚展开，许多事情都还保留着改变的余地。',
    '时间才走过一小段，不必太早为今天写下答案。',
  ],
  noon: [
    '一天走到中途，有些事情清楚了，有些还可以再等等。',
    '正午把时间分成两半，前面的过去了，后面的仍可展开。',
  ],
  afternoon: [
    '时间走到下午，有些事情依然值得再想一会儿。',
    '午后的节奏渐渐平稳，模糊的念头也开始有了轮廓。',
  ],
  evening: [
    '天色渐晚，白昼收起了声音，思绪反而慢慢清楚起来。',
    '一天正在慢慢收拢，有些念头却刚刚开始。',
  ],
  night: [
    '夜色安静下来，留一点时间给还没有成形的想法。',
    '这个夜晚还很长，答案可以晚一点到来。',
  ],
}

const WEEKDAY_COPIES: readonly (readonly string[])[] = [
  ['新的一周还在远处，今天仍然属于此刻。'],
  ['新的一周刚刚展开，不必急着把所有事情同时开始。'],
  ['一周已经走上轨道，今天也可以只是普通而完整的一天。'],
  ['一周走到中间，向前和停一停都还有余地。'],
  ['一周渐渐有了轮廓，尚未确定的部分仍然保留着可能。'],
  ['一周正在收尾，但今天不必只剩下匆忙。'],
  ['今天不必赶往哪里，时间也可以有自己的方向。'],
]

const GENERAL_COPIES = [
  '事情不总要从答案开始，有时一个问题就已经足够。',
  '有些念头还没有名字，但它们已经在慢慢发生。',
  '还没有想清楚的事情，也可以先在这里停留一会儿。',
  '不必急着把一切说清楚，模糊也有它存在的时间。',
  '一个想法不必等到完整，才值得被认真对待。',
  '有些答案需要寻找，有些只需要给它一点时间。',
] as const

const EMPHASIZED_WEEKDAYS = new Set([0, 1, 5, 6])

export function selectHomeAmbientCopy(now: Date = new Date()): string {
  const period = homeDayPeriod(now.getHours())
  const weekday = now.getDay()
  const weeklyCopies = copiesForWeekday(weekday, period)
  const selectionKey = [now.getFullYear(), now.getMonth() + 1, now.getDate(), period].join(':')
  const seed = hashText(selectionKey)
  const weeklyWeight = EMPHASIZED_WEEKDAYS.has(weekday) ? 30 : 15
  const timeWeight = EMPHASIZED_WEEKDAYS.has(weekday) ? 45 : 60
  const categoryRoll = seed % 100

  if (categoryRoll < weeklyWeight) {
    return pickCopy(weeklyCopies, hashText(`${selectionKey}:weekday`))
  }

  if (categoryRoll < weeklyWeight + timeWeight) {
    return pickCopy(TIME_COPIES[period], hashText(`${selectionKey}:time`))
  }

  return pickCopy(GENERAL_COPIES, hashText(`${selectionKey}:general`))
}

function homeDayPeriod(hour: number): HomeDayPeriod {
  if (hour < 5) return 'late-night'
  if (hour < 8) return 'early-morning'
  if (hour < 12) return 'morning'
  if (hour < 14) return 'noon'
  if (hour < 18) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}

function copiesForWeekday(weekday: number, period: HomeDayPeriod): readonly string[] {
  const copies = WEEKDAY_COPIES[weekday] ?? WEEKDAY_COPIES[0]!
  const momentCopy = weeklyMomentCopy(weekday, period)
  return momentCopy === undefined ? copies : [momentCopy, ...copies]
}

function weeklyMomentCopy(weekday: number, period: HomeDayPeriod): string | undefined {
  if (weekday === 1 && (period === 'early-morning' || period === 'morning')) {
    return '新的一周刚刚亮起来，所有事情都还保留着开始的余地。'
  }
  if (weekday === 5 && (period === 'evening' || period === 'night')) {
    return '一周正在慢慢收拢，未完成的也不必都留在今晚。'
  }
  if (weekday === 6 && (period === 'early-morning' || period === 'morning')) {
    return '周末的早晨没有固定方向，时间可以跟着兴趣慢慢走。'
  }
  if (weekday === 0 && (period === 'evening' || period === 'night')) {
    return '周末接近尾声，但不必提前把自己交给下一周。'
  }
  return undefined
}

function pickCopy(copies: readonly string[], seed: number): string {
  return copies[seed % copies.length]!
}

function hashText(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}
