/**
 * 相册分行：每行 2–3 项，行数尽量少；项数不能整除时多出来的放在后面几行（3 张一行压在最后）。
 * 1 项单独一行；4 项排成 2 + 2 而不是 3 + 1
 */
export function albumRows(count: number): number[] {
  if (count <= 3) return [count]
  const rows = count === 4 ? 2 : Math.ceil(count / 3)
  const base = Math.floor(count / rows)
  const extra = count % rows
  return Array.from({ length: rows }, (_, i) => (i < rows - extra ? base : base + 1))
}
