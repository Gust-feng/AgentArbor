type HomeDayPeriod =
  | 'late-night'
  | 'early-morning'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening'
  | 'night'

export interface HomeAmbientCopyPair {
  readonly lead: string
  readonly idleTail: string
  readonly activeTail: string
}

const TIME_COPIES: Readonly<Record<HomeDayPeriod, readonly HomeAmbientCopyPair[]>> = {
  'late-night': [
    {
      lead: '夜深了，留一点安静给自己，',
      idleTail: '今晚还想从哪里开始？',
      activeTail: '你写下的事情，今晚就有了方向。',
    },
    {
      lead: '四周安静下来以后，',
      idleTail: '今天还想把什么理清楚？',
      activeTail: '你写下的事情，正从安静里找到方向。',
    },
  ],
  'early-morning': [
    {
      lead: '天刚亮，一切都还来得及，',
      idleTail: '今天想先让什么发生？',
      activeTail: '你写下的事情，正好从今天开始。',
    },
    {
      lead: '清晨把一天重新打开，',
      idleTail: '今天想从哪件事开始？',
      activeTail: '你写下的事情，已经有了今天的起点。',
    },
  ],
  morning: [
    {
      lead: '一天刚刚展开，',
      idleTail: '今天想把什么向前推进？',
      activeTail: '你写下的事情，已经有了起点。',
    },
    {
      lead: '时间才走过一小段，',
      idleTail: '今天想先处理哪件事？',
      activeTail: '你写下的事情，正变成接下来的一步。',
    },
  ],
  noon: [
    {
      lead: '一天走到中途，',
      idleTail: '接下来想处理什么？',
      activeTail: '你写下的事情，正把后面的时间带向前。',
    },
    {
      lead: '正午把时间分成两半，',
      idleTail: '今天还想为哪件事留出位置？',
      activeTail: '你写下的事情，已经给下午留下方向。',
    },
  ],
  afternoon: [
    {
      lead: '时间走到下午，',
      idleTail: '今天还有什么值得完成？',
      activeTail: '你写下的事情，正变成下一步。',
    },
    {
      lead: '午后的节奏渐渐平稳，',
      idleTail: '今天想让哪件事更清楚？',
      activeTail: '你写下的事情，正在变得清楚。',
    },
  ],
  evening: [
    {
      lead: '天色渐晚，白昼收起了声音，',
      idleTail: '今晚想为哪件事留一点时间？',
      activeTail: '你写下的事情，正好在今天有了着落。',
    },
    {
      lead: '一天正在慢慢收拢，',
      idleTail: '今晚还想把什么向前推进？',
      activeTail: '你写下的事情，正从这里开始。',
    },
  ],
  night: [
    {
      lead: '夜色安静下来，',
      idleTail: '今晚想为哪件事留一点时间？',
      activeTail: '你写下的事情，值得从现在开始。',
    },
    {
      lead: '这个夜晚还很长，',
      idleTail: '今天还想把什么慢慢完成？',
      activeTail: '你写下的事情，正在向一个结果靠近。',
    },
  ],
}

const WEEKDAY_COPIES: readonly HomeAmbientCopyPair[] = [
  {
    lead: '新的一周还在远处，',
    idleTail: '今天想先做什么？',
    activeTail: '你写下的事情，让今天有了方向。',
  },
  {
    lead: '新的一周刚刚展开，',
    idleTail: '今天想从什么开始？',
    activeTail: '你写下的事情，正好成为这一周的起点。',
  },
  {
    lead: '一周已经走上轨道，',
    idleTail: '今天想把什么推进一步？',
    activeTail: '你写下的事情，已经在向前了。',
  },
  {
    lead: '一周走到中间，',
    idleTail: '今天想处理哪件事？',
    activeTail: '你写下的事情，正从中间找到出口。',
  },
  {
    lead: '一周渐渐有了轮廓，',
    idleTail: '今天还想完成什么？',
    activeTail: '你写下的事情，正在变得清楚。',
  },
  {
    lead: '一周正在收尾，',
    idleTail: '今天想把什么落下来？',
    activeTail: '你写下的事情，正好在今天有了着落。',
  },
  {
    lead: '今天不必赶往哪里，',
    idleTail: '想让什么事情慢慢发生？',
    activeTail: '你写下的事情，正沿着自己的节奏展开。',
  },
]

const GENERAL_COPIES: readonly HomeAmbientCopyPair[] = [
  {
    lead: '事情不总要从答案开始，',
    idleTail: '今天想先问问什么？',
    activeTail: '第一步已经从这里出现。',
  },
  {
    lead: '有些念头还没有名字，',
    idleTail: '今天想先让哪一个留下？',
    activeTail: '它已经有了可以继续的形状。',
  },
  {
    lead: '还没有想清楚的事情，',
    idleTail: '今天想先从哪里看起？',
    activeTail: '模糊的部分正在变得清楚。',
  },
  {
    lead: '不必急着把一切说清楚，',
    idleTail: '今天想先整理什么？',
    activeTail: '这件事已经可以开始整理。',
  },
  {
    lead: '一个想法不必等到完整，',
    idleTail: '今天想先把它写下来吗？',
    activeTail: '这个想法正在变得完整。',
  },
  {
    lead: '有些答案需要寻找，',
    idleTail: '今天想先从哪一步开始？',
    activeTail: '寻找已经有了下一步。',
  },
] as const

const EMPHASIZED_WEEKDAYS = new Set([0, 1, 5, 6])

export function selectHomeAmbientCopy(now: Date = new Date()): HomeAmbientCopyPair {
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

function copiesForWeekday(weekday: number, period: HomeDayPeriod): readonly HomeAmbientCopyPair[] {
  const copies = [WEEKDAY_COPIES[weekday] ?? WEEKDAY_COPIES[0]!]
  const momentCopy = weeklyMomentCopy(weekday, period)
  return momentCopy === undefined ? copies : [momentCopy, ...copies]
}

function weeklyMomentCopy(weekday: number, period: HomeDayPeriod): HomeAmbientCopyPair | undefined {
  if (weekday === 1 && (period === 'early-morning' || period === 'morning')) {
    return {
      lead: '新的一周刚刚亮起来，',
      idleTail: '今天想从什么开始？',
      activeTail: '你写下的事情，正好成为这一周的起点。',
    }
  }
  if (weekday === 5 && (period === 'evening' || period === 'night')) {
    return {
      lead: '一周正在慢慢收拢，',
      idleTail: '今天还想把什么留下？',
      activeTail: '你写下的事情，正好在今天有了着落。',
    }
  }
  if (weekday === 6 && (period === 'early-morning' || period === 'morning')) {
    return {
      lead: '周末的早晨没有固定方向，',
      idleTail: '今天想让什么自然发生？',
      activeTail: '你写下的事情，正沿着自己的节奏展开。',
    }
  }
  if (weekday === 0 && (period === 'evening' || period === 'night')) {
    return {
      lead: '周末接近尾声，',
      idleTail: '今天还有什么想完成？',
      activeTail: '你写下的事情，正好为下一周留下起点。',
    }
  }
  return undefined
}

function pickCopy(copies: readonly HomeAmbientCopyPair[], seed: number): HomeAmbientCopyPair {
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
