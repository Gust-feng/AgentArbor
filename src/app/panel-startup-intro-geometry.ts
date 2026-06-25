export type StartupIntroTextBox = {
  readonly width: number;
  readonly height: number;
};

export type StartupIntroWindowSize = {
  readonly width: number;
  readonly height: number;
};

export const STARTUP_INTRO_TEXT = "今天想处理什么？";

const STARTUP_INTRO_DESKTOP_VIEWPORT_WIDTH = 1440;
const STARTUP_INTRO_DESKTOP_VIEWPORT_HEIGHT = 960;
export const STARTUP_INTRO_TEXT_FONT_SIZE_PX = 48;
const STARTUP_INTRO_TEXT_LINE_HEIGHT = 1;

export function createStartupIntroDefaultWindowSize(text = STARTUP_INTRO_TEXT): StartupIntroWindowSize {
  return createStartupIntroWindowSize(
    STARTUP_INTRO_DESKTOP_VIEWPORT_WIDTH,
    STARTUP_INTRO_DESKTOP_VIEWPORT_HEIGHT,
    estimateStartupIntroTextBox(text)
  );
}

export function estimateStartupIntroTextBox(text: string): StartupIntroTextBox {
  const widthUnits = Array.from(text).reduce((total, character) => total + startupIntroCharacterWidthUnit(character), 0);
  return {
    width: Math.round(widthUnits * STARTUP_INTRO_TEXT_FONT_SIZE_PX),
    height: Math.round(STARTUP_INTRO_TEXT_FONT_SIZE_PX * STARTUP_INTRO_TEXT_LINE_HEIGHT),
  };
}

export function createStartupIntroWindowSize(
  viewportWidth: number,
  viewportHeight: number,
  textBox?: StartupIntroTextBox
): StartupIntroWindowSize {
  const safeViewportWidth = Math.max(1, Math.round(viewportWidth));
  const safeViewportHeight = Math.max(1, Math.round(viewportHeight));
  const measuredTextBox = textBox ?? estimateStartupIntroTextBox(STARTUP_INTRO_TEXT);
  const isMobile = safeViewportWidth <= 520;
  const isCompact = safeViewportWidth <= 920;
  const maxWidth = Math.max(
    1,
    Math.min(
      safeViewportWidth - (isMobile ? 24 : isCompact ? 48 : 96),
      isMobile ? 480 : isCompact ? 680 : 720
    )
  );
  const maxHeight = Math.max(
    1,
    Math.min(
      safeViewportHeight - (isMobile ? 24 : isCompact ? 38 : 80),
      isMobile ? 128 : isCompact ? 154 : 168
    )
  );
  const horizontalPadding = clamp(
    Math.round(measuredTextBox.width * 0.24),
    isMobile ? 40 : isCompact ? 64 : 80,
    isMobile ? 64 : isCompact ? 88 : 96
  );
  const verticalPadding = clamp(
    Math.round(measuredTextBox.height * 0.92),
    isMobile ? 24 : isCompact ? 34 : 40,
    isMobile ? 34 : isCompact ? 44 : 50
  );
  const textDrivenWidth = measuredTextBox.width + horizontalPadding * 2;
  const textDrivenHeight = measuredTextBox.height + verticalPadding * 2;
  const minimumSoftwareFrameWidth = textDrivenHeight * (isMobile ? 2.8 : isCompact ? 3.2 : 3.55);
  const balancedWidth = Math.max(textDrivenWidth, minimumSoftwareFrameWidth);

  return {
    width: roundToParityWithin(Math.min(balancedWidth, maxWidth), safeViewportWidth, maxWidth),
    height: roundToParityWithin(Math.min(textDrivenHeight, maxHeight), safeViewportHeight, maxHeight),
  };
}

function startupIntroCharacterWidthUnit(character: string): number {
  if (/^\s$/.test(character)) return 0.32;
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint <= 0x007f) return 0.56;
  if (isHalfwidthKatakana(codePoint)) return 0.58;
  if (isCjkPunctuation(codePoint)) return 0.82;
  return 1;
}

function isHalfwidthKatakana(codePoint: number): boolean {
  return codePoint >= 0xff61 && codePoint <= 0xff9f;
}

function isCjkPunctuation(codePoint: number): boolean {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundToParityWithin(value: number, paritySource: number, max: number): number {
  const rounded = Math.max(1, Math.round(value));
  if (sameParity(rounded, paritySource)) return rounded;
  if (rounded + 1 <= max) return rounded + 1;
  return Math.max(1, rounded - 1);
}

function sameParity(left: number, right: number): boolean {
  return Math.abs(left % 2) === Math.abs(right % 2);
}
