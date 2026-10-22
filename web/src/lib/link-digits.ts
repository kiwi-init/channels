export function digitsLine(digits: string): string {
  return digits.length === 6 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits
}
