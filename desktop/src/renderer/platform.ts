export type Platform = 'electron' | 'android' | 'browser'

export function getPlatform(): Platform {
  return (window as any).__PLATFORM__ || 'electron'
}

export function isAndroid(): boolean {
  return getPlatform() === 'android'
}

export function isTouchDevice(): boolean {
  return getPlatform() === 'android' || getPlatform() === 'browser'
}
